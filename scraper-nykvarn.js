require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType, parseStatus } = require('./scripts/parse-helpers');

const BASE_URL = 'https://nykvarn.se';
const LISTING_URL = `${BASE_URL}/kommun-och-politik/anslagstavla/`;

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseNykvarnPage(text) {
  const permits = [];

  // Anchor on Ärendenummer to avoid cross-block contamination
  for (const diarieMatch of text.matchAll(/Ärendenummer:\s+(BYGG\.\d{4}\.\d+)/g)) {
    const diarienummer = diarieMatch[1].trim();
    const pos = diarieMatch.index;

    // Look back up to 300 chars for the nearest Fastighet:
    const before = text.slice(Math.max(0, pos - 300), pos);
    const fastighetMatch = before.match(/Fastighet:\s+(.+)/);
    if (!fastighetMatch) continue;

    // Look ahead up to 250 chars for Ärendet avser:
    const after = text.slice(pos, pos + 250);
    const atgardMatch = after.match(/Ärendet avser:\s+([^\n]+)/i);
    const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

    const atgardText = atgard || '';
    permits.push({
      fastighetsbeteckning: fastighetMatch[1].trim(),
      diarienummer,
      adress: null,
      atgard,
      status: parseStatus(atgardText, 'beviljat'),
      permit_type: parsePermitType(atgardText),
      beslutsdatum: parseDatum(after),
    });
  }

  return permits;
}

async function scrapeNykvarn() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Nykvarn kungörelser...');
    await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));

    // Expand all accordion sections (Kungörelser, Tillkännagivanden)
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => { try { b.click(); } catch (_) {} });
    });
    await new Promise(r => setTimeout(r, 2000));

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseNykvarnPage(text);
    console.error(`Hittade ${permits.length} kungörelse-poster.`);

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit({ ...permit, sourceUrl: LISTING_URL, kommun: 'Nykvarn' });
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Nykvarn-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeNykvarn().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
