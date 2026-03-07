require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const LIDINGO_URL = 'https://lidingo.se/toppmeny/ovrigasidor/stadensanslagstavla.4.7a7e170815fc29ac5e455a5.html';

function parseLidingText(text) {
  const permits = [];
  const sections = text.split(/(?=\n?.*?\nPUBLICERAT:)/);

  for (const section of sections) {
    if (!/nybyggnad|tillbyggnad/i.test(section)) continue;

    const diarieMatch = section.match(/MSN\s*-?\s*B\s+(\d{3,4}-\d+)/i);
    if (!diarieMatch) continue;
    const diarienummer = `MSN-B ${diarieMatch[1]}`;

    // Extract body: text between "bygglov för" and "MSN"
    const bodyMatch = section.match(/[Bb]yggl[ou]v\s+f[öo]r\s+(.+?)(?=\s+MSN[\s-])/s);
    if (!bodyMatch) continue;
    const body = bodyMatch[1].trim();

    let fastighetsbeteckning = null;
    let adress = null;
    let atgard = null;

    // Pattern A: "... Fastighet: FASTBET (ADRESS)"
    const patA = body.match(/^(.+?)\s+Fastighet:\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9:\s\-]+?\d+(?::\d+)?)\s*\(([^)]+)\)\s*$/s);
    // Pattern B: "... inom FASTBET ADRESS" (mixed case fastighet)
    const patB = !patA && body.match(/^(.+?)\s+inom\s+([A-ZÅÄÖa-zåäö0-9:\-]+(?:\s+\d[\d:\-]*[A-Za-z]?)?)\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s]+?\d+[A-Za-z]?)\s*$/s);
    // Pattern C: "... FASTBET ADRESS" (CapWord+number CapWord+number suffix)
    const patC = !patA && !patB && body.match(/^(.+?)\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö:0-9\-]+(?:\s+\d[\d:\-]*[A-Za-z]?)?)\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö]+(?:\s+[A-ZÅÄÖa-zåäö]+)*\s+\d+[A-Za-z]?)\s*$/s);

    if (patA) {
      atgard = patA[1].trim().toLowerCase();
      fastighetsbeteckning = patA[2].trim();
      adress = patA[3].trim();
    } else if (patB) {
      atgard = patB[1].trim().toLowerCase();
      fastighetsbeteckning = patB[2].trim();
      adress = patB[3].trim();
    } else if (patC) {
      atgard = patC[1].trim().toLowerCase();
      fastighetsbeteckning = patC[2].trim();
      adress = patC[3].trim();
    } else {
      atgard = body.toLowerCase();
    }

    // Strip "Grannhörande för " / "Ansökan om " prefix from atgard
    if (atgard) atgard = atgard.replace(/^(?:grannhörande för |ansökan om )/i, '').trim();

    if (atgard) {
      permits.push({ diarienummer, fastighetsbeteckning, adress, atgard, kommun: 'Lidingö', sourceUrl: LIDINGO_URL });
    }
  }

  return permits;
}

async function scrapeLidingo() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Lidingo kungorelser...');
    await page.goto(LIDINGO_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseLidingText(text);

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
    console.error(`Klart: ${saved}/${bygglov.length} Lidingo-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeLidingo().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
