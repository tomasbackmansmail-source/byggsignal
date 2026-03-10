require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const BASE_URL = 'https://www.sundbyberg.se';
const LISTING_URL = `${BASE_URL}/kommun-och-politik/politik-och-demokrati/anslagstavla`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      const href = el.getAttribute('href');
      if (!href || !/kungorelse|kungörelse/i.test(href + text)) return;
      // Only plan- och bygglagen or bygglov related
      if (!/plan.*bygg|bygg.*plan|bygglov|bygglov/i.test(href + text)) return;
      const url = href.startsWith('http') ? href : base + href;
      results.push({ title: text, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseSundbybergText(text) {
  // "Ärendet avser: Bygglov för [åtgärd]" (decided permits)
  const arendetMatch = text.match(/Ärendet avser:\s+(.+?)(?:\n|Fastighet:|$)/i);
  // "Ansökan avser bygglov för [åtgärd]" (pending applications)
  const ansokanMatch = text.match(/[Aa]nsökan avser\s+(.+?)(?:\s+på fastighet|\n|$)/i);

  let atgard = null;
  if (arendetMatch) {
    atgard = arendetMatch[1].trim().toLowerCase();
  } else if (ansokanMatch) {
    atgard = ansokanMatch[1].trim().toLowerCase();
  }
  if (atgard) atgard = atgard.replace(/^bygglov för\s*/i, '').trim();

  // Fastighet: "Åkeriet 1, Humblegatan 5A, Sundbyberg"
  // Also handle "på fastighet Doktoranden 1, Adress" in ansökan pages
  const fastighetMatch = text.match(/(?:^Fastighet:|på fastighet)\s+(.+?)(?:,\s*\d{3}\s*\d{2}|,\s*Sundbyberg|\.?\s*\n|$)/im);
  let fastighetsbeteckning = null;
  let adress = null;
  if (fastighetMatch) {
    const parts = fastighetMatch[1].split(',').map(s => s.trim());
    fastighetsbeteckning = parts[0] || null;
    adress = parts.slice(1).join(', ').replace(/,?\s*Sundbyberg\s*$/i, '').trim() || null;
  }

  // Fallback fastighet from heading (CAPS + number)
  if (!fastighetsbeteckning) {
    const headMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s]+\d+),\s*([^,\n]+),\s*Sundbyberg/);
    if (headMatch) {
      fastighetsbeteckning = headMatch[1].trim();
      adress = headMatch[2].trim();
    }
  }

  // Diarienummer: "BYGG.2025.573" or "BYGG.2025.479"
  const diarieMatch = text.match(/[Ää]rendenummer[:\s]+(BYGG\.\d{4}\.\d+)/i);
  const diarienummer = diarieMatch ? diarieMatch[1].trim() : null;

  const status = arendetMatch ? 'beviljat' : (ansokanMatch ? 'ansökt' : null);
  return { atgard, fastighetsbeteckning, adress, diarienummer, status, beslutsdatum: parseDatum(text) };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });

  return parseSundbybergText(text);
}

async function scrapeSundbyberg() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Sundbyberg kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} kungörelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, permit_type: parsePermitType(permit.atgard), sourceUrl: link.url, kommun: 'Sundbyberg' });
        }
      } catch (err) {
        console.error(`  ✗ ${link.url}: ${err.message}`);
      }
    }

    console.error(`Hittade ${permits.length} poster.`);

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Sundbyberg-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeSundbyberg().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
