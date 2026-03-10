require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType, parseStatus } = require('./scripts/parse-helpers');

const BASE_URL = 'https://www.upplands-bro.se';
const LISTING_URL = `${BASE_URL}/anslagstavla.html`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseUpplandsbroText(text) {
  const permits = [];

  // Split on "Bygglovsärenden" section and parse each entry
  // Format:
  // 2026-03-10
  // Grannhörande, BACKABO 2:2
  // Ärendenummer: BYGG.2025.285
  // Ärendet avser: Bygglov för tillbyggnad av bostadshus
  // Fastighet: BACKABO 2:2
  // Adress: Kyrkbyvägen 50
  // ...
  // Beslutsdatum: 2026-03-06

  // "Bygglovsärenden" appears twice: once in TOC, once as section heading.
  // Use the last occurrence.
  const parts = text.split(/Bygglovsärenden/i);
  const bygglovSection = parts[parts.length - 1];
  if (!bygglovSection) return permits;

  // Cut at "Övriga anslag" or "Överklaga" to get just the bygglov section
  const section = bygglovSection.split(/Övriga anslag|Överklaga ett beslut/i)[0];

  // Split entries by "Läs mer" which ends each announcement
  const entries = section.split(/Läs mer/i);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Ärendenummer
    const diarieMatch = trimmed.match(/Ärendenummer:\s*(BYGG\.\d{4}\.\d+)/i);
    if (!diarieMatch) continue;
    const diarienummer = diarieMatch[1];

    // Fastighet
    const fastighetMatch = trimmed.match(/Fastighet:\s*([^\n]+)/i);
    const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

    // Adress (filter out false matches like "Beslutsdatum:" or "Uppgift saknas")
    const adressMatch = trimmed.match(/Adress:\s*([^\n]+)/i);
    let adress = adressMatch ? adressMatch[1].trim() : null;
    if (adress && (/^Beslutsdatum/i.test(adress) || /^Sätts upp/i.test(adress) || /^Uppgift saknas/i.test(adress))) {
      adress = null;
    }

    // Ärendet avser / Åtgärd
    const atgardMatch = trimmed.match(/Ärendet avser:\s*([^\n]+)/i);
    const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

    // Beslutsdatum (may be on same line or next line)
    const bdMatch = trimmed.match(/Beslutsdatum:\s*(\d{4}-\d{2}-\d{2})/i)
      || trimmed.match(/Beslutsdatum:\s*\n\s*(\d{4}-\d{2}-\d{2})/i);
    const beslutsdatum = bdMatch ? bdMatch[1] : null;

    // Status: detect from heading or content
    const status = parseStatus(trimmed, beslutsdatum ? 'beviljat' : 'ansökt');

    permits.push({
      diarienummer,
      fastighetsbeteckning,
      adress,
      atgard,
      status,
      permit_type: parsePermitType(atgard),
      beslutsdatum,
      sourceUrl: LISTING_URL,
      kommun: 'Upplands-Bro',
    });
  }

  return permits;
}

async function scrapeUpplandsro() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Upplands-Bro kungörelser...');
    await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const text = await page.evaluate(() => {
      const el = document.querySelector('main') || document.body;
      return el.innerText;
    });

    const permits = parseUpplandsbroText(text);
    console.error(`Hittade ${permits.length} bygglovsärenden.`);

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
    console.error(`Klart: ${saved}/${permits.length} Upplands-Bro-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeUpplandsro().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
