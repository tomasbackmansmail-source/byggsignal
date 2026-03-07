require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const NP_URL = 'https://www.netpublicator.com/bulletinboard/public/1cc812d3-3640-44d8-a973-9d6fadc21948';
const SOURCE_URL = 'https://www.upplandsvasby.se/kommun-och-politik/overklaga-beslut-rattssakerhet/anslagstavla-officiell';

function parseUpplandsVasbyText(text) {
  const permits = [];
  // Split on "Kungörelse om bygglov" sections
  const sections = text.split(/(?=Kungörelse om bygglov\n)/g).filter(s => /Diarienummer/.test(s));

  for (const section of sections) {
    // Diarienummer: "BMN 2026-000038"
    const diarieMatch = section.match(/Diarienummer\s+(BMN\s+\d{4}-\d+)/);
    if (!diarieMatch) continue;
    const diarienummer = diarieMatch[1].replace(/\s+/g, ' ').trim();

    // Åtgärd: "Bygglov avser\n[åtgärd]"
    const atgardMatch = section.match(/Bygglov avser\s+(.+)/);
    let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;
    if (atgard) atgard = atgard.replace(/^(?:ansökan\s+om\s+)?(?:förlängning\s+av\s+)?(?:tidsbegränsat\s+)?bygglov\s+f[öo]r\s+/i, '').trim();

    // Fastighet: in "Hänvisning" field
    const hantMatch = section.match(/Hänvisning\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)(?:\s*\(([^)]+)\))?/);
    const fastighetsbeteckning = hantMatch ? hantMatch[1].trim() : null;
    const adress = hantMatch && hantMatch[2] ? hantMatch[2].trim() : null;

    permits.push({ diarienummer, fastighetsbeteckning, adress, atgard, kommun: 'Upplands Väsby', sourceUrl: SOURCE_URL });
  }

  return permits;
}

async function scrapeUpplandsVasby() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Upplands Vasby kungorelser...');
    await page.goto(NP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseUpplandsVasbyText(text);

    const bygglov = permits.filter(p =>
      p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard)
    );

    console.error(`Hittade ${permits.length} poster varav ${bygglov.length} nybyggnad/tillbyggnad.`);
    permits.forEach(p => console.error(`  -> ${p.diarienummer} | ${p.atgard}`));

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
    console.error(`Klart: ${saved}/${bygglov.length} Upplands Vasby-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeUpplandsVasby().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
