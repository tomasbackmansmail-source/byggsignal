/**
 * POC: Hämta upphandlingar från KommersAnnons + e-Avrop
 * Fem kommuner: Nacka, Värmdö, Stockholm stad, Norrtälje, Lidingö
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// --- Byggord för filtrering (med ordgräns \b) ---
const BYGG_WORDS = [
  'bygg', 'anläggning', 'entreprenad', 'måleri', 'elinstallation',
  'vvs', 'renovering', 'markarbete', 'markentreprenad', 'fasad',
  'takarbete', 'tak(?:läggning|byte)', 'rörarbete', 'ventilation',
  'golv', 'betong', 'stålkonstruktion', 'rivning', 'ombyggnad',
  'nybyggnad', 'plåt', 'isolering', 'stomme', 'puts',
  'kakel', 'klinker', 'snickeri', 'tätskikt', 'dränering',
  'schakt', 'sprängning', 'hiss', 'brandskydd', 'stambyte',
  'cirkulationsplats', 'va-arbete', 'ledningsarbete',
  'anläggningsarbete', 'ombyggnadsarbete', 'elarbete'
];

const BYGG_REGEX = new RegExp('\\b(?:' + BYGG_WORDS.join('|') + ')', 'i');

const CUTOFF_DATE = new Date('2026-01-20');
const MAX_VALUE_SEK = 5_000_000;

// --- Datakällor ---
const SOURCES = [
  {
    municipality: 'Nacka',
    url: 'https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=285',
    baseUrl: 'https://www.kommersannons.se/eLite/Notice/',
    parser: 'elite',
  },
  {
    municipality: 'Värmdö',
    url: 'https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=317',
    baseUrl: 'https://www.kommersannons.se/eLite/Notice/',
    parser: 'elite',
  },
  {
    municipality: 'Stockholm stad',
    url: 'https://www.kommersannons.se/stockholm/Notice/NoticeList.aspx?NoticeStatus=1',
    baseUrl: 'https://www.kommersannons.se/stockholm/Notice/',
    parser: 'stockholm',
  },
  {
    municipality: 'Norrtälje',
    url: 'https://www.e-avrop.com/norrtalje/e-upphandling/Default.aspx',
    baseUrl: 'https://www.e-avrop.com',
    parser: 'eavrop',
    slug: 'norrtalje',
  },
  {
    municipality: 'Lidingö',
    url: 'https://www.e-avrop.com/Lidingostad/e-Upphandling/Default.aspx',
    baseUrl: 'https://www.e-avrop.com',
    parser: 'eavrop',
    slug: 'Lidingostad',
  },
];

// --- Parsers ---

function parseElite(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  $('.Notice').each((_, el) => {
    const title = $(el).find('.NoticeTitle h3').text().trim();
    const dateText = $(el).find('.NoticeDate').text().trim();
    const description = $(el).find('.NoticeDescription').text().trim();
    const link = $(el).find('.NoticeContent a').attr('href');

    const deadline = extractDate(dateText, /sista\s+(?:anbudsdag|dag\s+för\s+ansökan)\s+(?:är\s+)?(\d{4}-\d{2}-\d{2})/i);
    const published = extractDate(dateText, /visas\s+mellan\s+(\d{4}-\d{2}-\d{2})/i);
    const location = extractLocation(dateText);

    items.push({
      municipality: source.municipality,
      title,
      description: description || null,
      deadline: deadline || null,
      published_date: published || null,
      location: location || null,
      estimated_value_sek: null, // Inte tillgängligt i listvy
      category: null,
      source_url: link ? source.baseUrl + link : source.url,
      source: 'kommersannons',
    });
  });

  return items;
}

function parseStockholm(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  // Stockholm: Bootstrap rows with col-md-8 containing p.h4 with procurement link
  // Only select rows that contain a procurement link (NoticeOverview)
  $('div.container div.row.mt-4').each((_, el) => {
    const col8 = $(el).find('.col-md-8');
    if (!col8.length) return;

    const h4 = col8.find('p.h4');
    if (!h4.length) return;

    const procLink = h4.find('a[href*="ProcurementId"]');
    if (!procLink.length) return;

    // Title: ref code in <a><span> then " - actual title" then <small> type
    const refCode = procLink.find('span').text().trim();
    const fullText = h4.clone().children('a, small, div').remove().end().text().trim();
    const titlePart = fullText.replace(/^-\s*/, '').trim();
    const title = titlePart || refCode;

    // Date <small> is a direct child of col-md-8, NOT inside the <p>
    const dateText = col8.children('small').first().text().trim();
    const descriptionDiv = col8.children('div').first().text().trim();
    const link = procLink.attr('href');

    const deadline = extractDate(dateText, /sista\s+(?:anbudsdag(?:en)?|dag\s+för\s+ansökan)\s+(?:är\s+)?(\d{4}-\d{2}-\d{2})/i);
    const published = extractDate(dateText, /visas\s+mellan\s+(\d{4}-\d{2}-\d{2})/i);
    const location = extractLocation(dateText);

    items.push({
      municipality: source.municipality,
      title,
      description: descriptionDiv || null,
      deadline: deadline || null,
      published_date: published || null,
      location: location || null,
      estimated_value_sek: null,
      category: null,
      source_url: link ? source.baseUrl + link : source.url,
      source: 'kommersannons',
    });
  });

  return items;
}

// --- e-Avrop: kräver ASP.NET postback för att ladda listan ---

async function fetchEavrop(source) {
  // Steg 1: GET för att hämta VIEWSTATE etc
  const initResp = await axios.get(source.url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Byggsignal-POC/1.0' },
  });
  const init$ = cheerio.load(initResp.data);
  const viewState = init$('#__VIEWSTATE').val();
  const eventValidation = init$('#__EVENTVALIDATION').val();
  const viewStateGen = init$('#__VIEWSTATEGENERATOR').val();

  // Steg 2: POST med RadioButtonListScope=tender för att trigga listan
  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$navigationContent$NoticeLists$RadioButtonListScope$2');
  params.append('__EVENTARGUMENT', '');
  params.append('__VIEWSTATE', viewState);
  params.append('__VIEWSTATEGENERATOR', viewStateGen);
  params.append('__EVENTVALIDATION', eventValidation);
  params.append('ctl00$navigationContent$NoticeLists$RadioButtonListScope', 'tender');

  const resp = await axios.post(source.url, params.toString(), {
    timeout: 15000,
    headers: {
      'User-Agent': 'Byggsignal-POC/1.0',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return resp.data;
}

function parseEavrop(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  $('#mainContent_tenderGridView tr.rowline').each((_, el) => {
    const tds = $(el).find('td');
    if (tds.length < 4) return;

    const titleLink = $(tds[0]).find('a');
    const title = titleLink.text().trim();
    const link = titleLink.attr('href');
    const published = $(tds[1]).text().trim() || null;
    const category = $(tds[2]).text().replace(/\s+/g, ' ').trim() || null;
    const deadlineText = $(tds[3]).text().trim();

    // Deadline: "2026-04-02\n13 dagar kvar" eller "anbud kan lämnas löpande"
    const deadlineMatch = deadlineText.match(/(\d{4}-\d{2}-\d{2})/);
    const deadline = deadlineMatch ? deadlineMatch[1] : null;

    items.push({
      municipality: source.municipality,
      title,
      description: category, // CPV-kategorier som beskrivning
      deadline: deadline || null,
      published_date: published || null,
      location: 'Stockholms län',
      estimated_value_sek: null,
      category: category,
      source_url: link ? source.baseUrl + link : source.url,
      source: 'eavrop',
    });
  });

  return items;
}

// --- Helpers ---

function extractDate(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : null;
}

function extractLocation(text) {
  const m = text.match(/utförandeort\s+(.+?)\.?\s*$/i);
  return m ? m[1].trim().replace(/\.$/, '') : null;
}

function isAfterCutoff(item) {
  if (!item.deadline) return false;
  return new Date(item.deadline) > CUTOFF_DATE;
}

function isUnderMaxValue(item) {
  if (item.estimated_value_sek === null) return true; // Inget belopp = inkludera
  return item.estimated_value_sek < MAX_VALUE_SEK;
}

function isByggRelevant(item) {
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  return BYGG_REGEX.test(text);
}

// --- Main ---

async function createTable() {
  const { error } = await supabase.rpc('exec_sql', {
    query: `
      CREATE TABLE IF NOT EXISTS procurements (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        municipality text NOT NULL,
        title text NOT NULL,
        description text,
        deadline date,
        published_date date,
        location text,
        estimated_value_sek numeric,
        category text,
        source_url text,
        source text DEFAULT 'kommersannons',
        created_at timestamptz DEFAULT now(),
        UNIQUE(municipality, title, deadline)
      );
    `
  });

  if (error) {
    // rpc might not exist - try direct SQL via REST or just upsert and let it fail
    console.log('⚠  Kunde inte skapa tabell via RPC (kör SQL manuellt om tabellen saknas):', error.message);
    // Try creating via raw query alternative
    const { error: err2 } = await supabase.from('procurements').select('id').limit(1);
    if (err2 && err2.code === '42P01') {
      console.error('❌ Tabellen "procurements" finns inte. Kör SQL:et manuellt i Supabase Dashboard.');
      process.exit(1);
    }
  }
}

async function run() {
  console.log('=== POC: Upphandlingar från KommersAnnons ===\n');

  await createTable();

  const report = {};

  for (const source of SOURCES) {
    console.log(`\n--- ${source.municipality} ---`);
    console.log(`Hämtar: ${source.url}`);

    let html;
    try {
      if (source.parser === 'eavrop') {
        html = await fetchEavrop(source);
      } else {
        const resp = await axios.get(source.url, {
          timeout: 15000,
          headers: { 'User-Agent': 'Byggsignal-POC/1.0' },
        });
        html = resp.data;
      }
    } catch (err) {
      console.error(`  ❌ Fetch misslyckades: ${err.message}`);
      continue;
    }

    const parsers = { elite: parseElite, stockholm: parseStockholm, eavrop: parseEavrop };
    const allItems = parsers[source.parser](html, source);
    console.log(`  Totalt hittade: ${allItems.length}`);

    // Filtrera
    const afterCutoff = allItems.filter(isAfterCutoff);
    console.log(`  Efter deadline-filter (>${CUTOFF_DATE.toISOString().slice(0, 10)}): ${afterCutoff.length}`);

    const underMax = afterCutoff.filter(isUnderMaxValue);
    console.log(`  Efter beloppsfilter (<${MAX_VALUE_SEK / 1e6}M): ${underMax.length}`);

    const byggRelevant = underMax.filter(isByggRelevant);
    console.log(`  Bygg-relevanta: ${byggRelevant.length}`);

    report[source.municipality] = {
      total: allItems.length,
      afterCutoff: afterCutoff.length,
      underMax: underMax.length,
      byggRelevant: byggRelevant.length,
      items: byggRelevant,
    };

    // Upsert bygg-relevanta till Supabase
    if (byggRelevant.length > 0) {
      const { error } = await supabase
        .from('procurements')
        .upsert(byggRelevant, {
          onConflict: 'municipality,title,deadline',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`  ❌ Upsert-fel: ${error.message}`);
      } else {
        console.log(`  ✅ ${byggRelevant.length} upsertade till Supabase`);
      }
    }
  }

  // --- Rapport ---
  console.log('\n\n========================================');
  console.log('           SAMMANFATTNING');
  console.log('========================================\n');

  console.log('Kommun            | Totalt | Aktuella | <5M | Bygg');
  console.log('------------------|--------|----------|-----|-----');
  for (const [muni, r] of Object.entries(report)) {
    console.log(
      `${muni.padEnd(18)}| ${String(r.total).padEnd(7)}| ${String(r.afterCutoff).padEnd(9)}| ${String(r.underMax).padEnd(4)}| ${r.byggRelevant}`
    );
  }

  // Belopp-observation
  console.log('\n📋 Belopp i listdata?');
  console.log('   NEJ - uppskattat värde finns INTE i listvy-HTML:en.');
  console.log('   Belopp finns troligen bara på detaljsidan (NoticeOverview).');
  console.log('   Alla poster passerar därför belopps-filtret (antas <5M).\n');

  // Top 3 för Chair6
  const allBygg = Object.values(report).flatMap(r => r.items);
  console.log('🏗  Topp 3 mest relevanta för Chair6 (byggfirma, 3 anställda, Sthlm län):');
  console.log('   (Prioriterar: entreprenad, renovering, måleri, mark, anläggning)\n');

  const scored = allBygg.map(item => {
    const text = `${item.title} ${item.description || ''}`.toLowerCase();
    let score = 0;
    // Högre poäng för småföretagsvänliga ord
    if (/entreprenad/.test(text)) score += 3;
    if (/renovering|ombyggnad/.test(text)) score += 3;
    if (/måleri/.test(text)) score += 3;
    if (/\b(?:markarbete|anläggning)\b/.test(text)) score += 2;
    if (/\b(?:fasad|tak|golv)\b/.test(text)) score += 2;
    if (/\b(?:elinstallation|vvs|rörarbete|ventilation)\b/.test(text)) score += 1;
    if (/\bbygg/.test(text)) score += 1;
    // Direktupphandling = bra för småföretag
    if (/direktupphandling/.test(text)) score += 2;
    // Ramavtal = ofta för större
    if (/ramavtal/.test(text)) score -= 1;
    return { ...item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3);

  top3.forEach((item, i) => {
    console.log(`   ${i + 1}. ${item.title}`);
    console.log(`      Kommun: ${item.municipality} | Deadline: ${item.deadline}`);
    console.log(`      ${item.source_url}`);
    if (item.description) {
      console.log(`      ${item.description.slice(0, 120)}...`);
    }
    console.log();
  });

  if (top3.length === 0) {
    console.log('   Inga bygg-relevanta upphandlingar hittades.\n');
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
