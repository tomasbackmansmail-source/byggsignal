require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const VARMDO_URL = 'https://digitaltutskick.varmdo.se/kungorelse';

function parseVarmdoText(text) {
  const permits = [];
  // Format: "2026-03-02 Bygglov FÅGELBRO 1:77, Vikstens backe 2, Värmdö"
  const linePattern = /(\d{4}-\d{2}-\d{2})\s+(Bygglov|Marklov|Förhandsbesked|Rivningslov)\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s]+\d+:\d+),\s*([^,\n]*),?\s*([^\n]*)/g;

  for (const m of text.matchAll(linePattern)) {
    const [, datum, typ, fastighet, adress, ort] = m;
    // Synthetic unique key since Värmdö has no diarienummer
    const diarienummer = `VARMDO-${datum}-${fastighet.trim().replace(/\s+/g, '-')}`;

    permits.push({
      diarienummer,
      fastighetsbeteckning: fastighet.trim(),
      adress: adress.trim() || null,
      atgard: typ.toLowerCase(),
      kommun: 'Värmdö',
      sourceUrl: VARMDO_URL,
    });
  }

  return permits;
}

async function scrapeVarmdo() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Värmdö kungörelser...');
    await page.goto(VARMDO_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for JS-rendered list
    await new Promise(r => setTimeout(r, 4000));

    // Click "Visa fler" until it disappears to get all permits
    let more = true;
    while (more) {
      try {
        const btn = await page.$('button:not([disabled])');
        if (!btn) break;
        const txt = await page.evaluate(el => el.innerText, btn);
        if (!/visa fler/i.test(txt)) break;
        await btn.click();
        await new Promise(r => setTimeout(r, 1500));
      } catch {
        more = false;
      }
    }

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseVarmdoText(text);
    const bygglov = permits.filter(p => p.atgard === 'bygglov');

    console.error(`Hittade ${permits.length} poster varav ${bygglov.length} bygglov.`);

    let saved = 0;
    for (const permit of bygglov) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Värmdö-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeVarmdo().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
