const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = 'https://abnlmxkgdkyyvbagewgf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFibmxteGtnZGt5eXZiYWdld2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTA0MjIsImV4cCI6MjA4ODM2NjQyMn0.WZX-_07Ky1jR4oz3ICPXPgwuSge-jUACfI4DWWQ3es8';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchWindow(from, to) {
  return new Promise((resolve, reject) => {
    const params = `ExtendedAddress=false&Description=&CaseStartDateFrom=${from}&CaseStartDateTo=${to}&Page=1`;
    const url = `https://etjanster.stockholm.se/byggochplantjansten/arendeochhandlingar?${params}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(/var CaseSearchResultsViewModel = ({[\s\S]*?});\s/);
        if (!m) return resolve(null);
        try { resolve(JSON.parse(m[1])); } catch(e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

// Hämta senaste 3 månaderna med ett anrop per månad för att undvika api-taket (~1200 poster/anrop)
async function fetchAll(fromDate) {
  const allCases = [];
  const seen = new Set();
  const start = new Date(fromDate);
  const end = new Date();

  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const lastD = new Date(y, cur.getMonth() + 1, 0).getDate();
    const from = `${y}-${m}-01`;
    const to   = `${y}-${m}-${String(lastD).padStart(2, '0')}`;

    const vm = await fetchWindow(from, to);
    if (vm) {
      for (const c of vm.BuildCases.CaseSearchDetails) {
        if (c.Name && !seen.has(c.Name)) { seen.add(c.Name); allCases.push(c); }
      }
    }
    await sleep(800);
    cur.setMonth(cur.getMonth() + 1);
  }
  return allCases;
}

// API:et har inget statusfält — härleds från beskrivningen.
// StartDate = datum ärendet registrerades i Stockholm stad, inte beslutsdatum.
// Fallback null: beskrivningen är en åtgärdstyp ("Nybyggnad av altan"),
// inte ett statusbesked — ärendet är bara registrerat = status okänd.
function inferStatus(description) {
  if (!description) return null;
  const d = description.toLowerCase();
  if (d.includes('startbesked')) return 'startbesked';
  if (d.includes('kungörelse')) return 'beviljat';
  if (d.includes('ansökan') || d.includes('inkommit') || d.includes('underrättelse')) return 'ansökt';
  return null;
}

const { parsePermitType } = require('./scripts/parse-helpers');

const RELEVANT_KEYWORDS = [
  'nybyggnad', 'tillbyggnad', 'rivningslov', 'rivning',
  'attefalls', 'komplementbyggnad', 'fasadändring',
  'marklov', 'förhandsbesked', 'startbesked', 'eldstad',
];

function isRelevant(description) {
  if (!description) return false;
  const d = description.toLowerCase();
  return RELEVANT_KEYWORDS.some(kw => d.includes(kw));
}

async function scrape() {
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 3);
  const dateStr = fromDate.toISOString().split('T')[0];
  console.log(`Scraping Stockholm stad från ${dateStr} (3 månader, per månad)...\n`);

  const cases = await fetchAll(dateStr);
  if (!cases.length) {
    console.log('Kunde inte hämta data från Stockholm stad.');
    return;
  }

  const relevant = cases.filter(c => isRelevant(c.Description));
  console.log(`Hittade ${cases.length} ärenden totalt, ${relevant.length} relevanta\n`);

  // Breakdown by keyword
  const byKw = {};
  for (const kw of RELEVANT_KEYWORDS) {
    const n = relevant.filter(c => c.Description && c.Description.toLowerCase().includes(kw)).length;
    if (n > 0) byKw[kw] = n;
  }
  console.log('Fördelning:', JSON.stringify(byKw));

  // Pre-fetch existing beslutsdatum values to avoid overwriting them
  const allDiarienummer = relevant.map(c => c.Name).filter(Boolean);
  const { data: existing } = await sb.from('permits')
    .select('diarienummer, beslutsdatum')
    .in('diarienummer', allDiarienummer);
  const existingBd = new Map((existing || []).map(r => [r.diarienummer, r.beslutsdatum]));

  let saved = 0;
  let skipped = 0;

  for (const c of relevant) {
    const status = inferStatus(c.Description);
    const apiBd = c.StartDate ? new Date(c.StartDate).toISOString().split('T')[0] : null;
    // Keep existing beslutsdatum if already set; use API date otherwise
    const beslutsdatum = existingBd.get(c.Name) || apiBd;
    const { error } = await sb.from('permits').upsert({
      kommun: 'Stockholm stad',
      adress: c.RealEstateAddress || null,
      fastighetsbeteckning: c.RealEstateName || null,
      atgard: c.Description || null,
      diarienummer: c.Name || null,
      beslutsdatum,
      scraped_at: beslutsdatum ? new Date(beslutsdatum).toISOString() : new Date().toISOString(),
      status,
      permit_type: parsePermitType(c.Description),
      source_url: 'etjanster.stockholm.se'
    }, { onConflict: 'diarienummer', ignoreDuplicates: false });

    if (error) { console.log(`  x ${c.Name}: ${error.message}`); skipped++; }
    else { saved++; }
  }

  console.log(`\nSparade: ${saved}`);
  console.log(`Hoppade över (fel): ${skipped}`);
  console.log('\nKlart!');
}

scrape().catch(console.error);
