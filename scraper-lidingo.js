require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const LIDINGO_URL = 'https://lidingo.se/toppmeny/ovrigasidor/stadensanslagstavla.4.7a7e170815fc29ac5e455a5.html';

function parseLidingText(text) {
  const permits = [];
  // Split into entries by "PUBLICERAT:" lines
  const sections = text.split(/(?=\n?.*?\nPUBLICERAT:)/);

  for (const section of sections) {
    // Only process sections with bygglov content
    if (!/nybyggnad|tillbyggnad/i.test(section)) continue;

    // Diarienummer: "MSN-B YYYY-NNN" or "MSN -B YYYY-NNN"
    const diarieMatch = section.match(/MSN\s*-?\s*B\s+(\d{4}-\d+)/i);
    if (!diarieMatch) continue;
    const diarienummer = `MSN-B ${diarieMatch[1]}`;

    // Fastighet: ALL-CAPS word(s) + number:number (if present)
    const fastighetMatch = section.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
    let fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

    // Address: try to find a street address pattern (word + number)
    const adressMatch = section.match(/(?:Fastighet:.*?\)\s*|inom\s+[A-ZÅÄÖ].*?\s+)([A-ZÅÄÖ][a-zåäö]+(?:[\s\-][A-Za-zåäö]+)*\s+\d+[A-Za-z]?)/);
    const adress = adressMatch ? adressMatch[1].trim() : null;

    // Åtgärd: text between "bygglov för" and the fastighet/end
    const atgardMatch = section.match(/(?:[Bb]yggl[ou]v\s+f[öo]r\s+)([^\n]+?)(?:\s+(?:inom\s+|Fastighet:|[A-ZÅÄÖ]{3,}\s+\d)|MSN|\s*$)/);
    let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

    if (atgard && diarienummer) {
      permits.push({
        diarienummer,
        fastighetsbeteckning,
        adress,
        atgard,
        kommun: 'Lidingö',
        sourceUrl: LIDINGO_URL,
      });
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
