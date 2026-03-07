require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const HANINGE_URL = 'https://utskick.haninge.se/kungorelse';

function parseHaningeText(text) {
  const permits = [];
  // Format: "2026-03-03\n\nBygglov \n\nALBY 2:13, ALBYVÄGEN 7, ÖSTERHANINGE"
  const linePattern = /(\d{4}-\d{2}-\d{2})\s+(Bygglov|Marklov|Förhandsbesked|Rivningslov)\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?),\s*([^,\n]*),?\s*([^\n]*)/g;

  for (const m of text.matchAll(linePattern)) {
    const [, datum, typ, fastighet, adress, ort] = m;
    const diarienummer = `HANINGE-${datum}-${fastighet.trim().replace(/\s+/g, '-')}`;

    permits.push({
      diarienummer,
      fastighetsbeteckning: fastighet.trim(),
      adress: adress.trim() || null,
      atgard: typ.toLowerCase(),
      kommun: 'Haninge',
      sourceUrl: HANINGE_URL,
    });
  }

  return permits;
}

async function scrapeHaninge() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Haninge kungorelser...');
    await page.goto(HANINGE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 6000));

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseHaningeText(text);
    const bygglov = permits.filter(p => p.atgard === 'bygglov');

    console.error(`Hittade ${permits.length} poster varav ${bygglov.length} bygglov.`);

    let saved = 0;
    for (const permit of bygglov) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ok ${permit.diarienummer} -- ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Haninge-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeHaninge().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
