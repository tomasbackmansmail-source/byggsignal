require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const JARFALLA_URL = 'https://www.netpublicator.com/bulletinboard/public/ab6e8af7-5b02-4dde-9a2a-4152032b7afa';
const SOURCE_URL = 'https://www.jarfalla.se/kommunochpolitik/politikochnamnder/anslagstavla.4.3cbad1981604650ddf392cc7.html';

function parseJarfallaText(text) {
  const permits = [];
  // Format: "Bygglov beviljas ... på fastigheten FASTIGHET (ADRESS) för [åtgärd] i ärende med diarienummer: BYGG YYYY-XXXXXX"
  const pattern = /(Bygglov|Marklov|Rivningslov|Förhandsbesked)(?:\s+inkl\.\s+startbesked)?\s+beviljas.*?på\s+fastigheten\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)(?:\s*\(([^)]+)\))?\s+för\s+(.+?)\s+i\s+ärende\s+med\s+diarienummer:\s+(BYGG\s+\d{4}-\d+)/gi;

  for (const m of text.matchAll(pattern)) {
    const [, typ, fastighet, adress, atgard, diarienummer] = m;
    permits.push({
      diarienummer: diarienummer.replace(/\s+/g, ' ').trim(),
      fastighetsbeteckning: fastighet.trim(),
      adress: adress ? adress.trim() : null,
      atgard: atgard.trim().toLowerCase().replace(/^bygglov\s+för\s+/i, ''),
      kommun: 'Järfälla',
      sourceUrl: SOURCE_URL,
    });
  }

  return permits;
}

async function scrapeJarfalla() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Jarfalla kungorelser...');
    await page.goto(JARFALLA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseJarfallaText(text);

    const bygglov = permits.filter(p =>
      p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard)
    );

    console.error(`Hittade ${permits.length} poster varav ${bygglov.length} nybyggnad/tillbyggnad.`);

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
    console.error(`Klart: ${saved}/${bygglov.length} Jarfalla-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeJarfalla().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
