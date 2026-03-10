require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const BASE_URL = 'https://www.solna.se';
const LISTING_URL = `${BASE_URL}/om-solna-stad/arenden-beslut-och-protokoll/anslagstavla`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href) return;
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      const combined = href + ' ' + text;
      if (!href.includes('beviljade-bygg--mark--och-rivningslov') &&
          !/ansökan.*bygglov|bygglov.*ansökan|pbl.*kungörelse|kungorelse.*pbl/i.test(combined)) {
        if (!href.includes('beviljade-bygg--mark--och-rivningslov')) return;
      }
      const url = href.startsWith('http') ? href : base + href;
      const status = href.includes('beviljade-bygg--mark--och-rivningslov') ? 'beviljat' : 'ansökt';
      results.push({ title: text || href, url, status });
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

function parseSolnaText(text) {
  // Diarienummer: "BYGG 2026-000099"
  const diarieMatch = text.match(/BYGG\s+\d{4}-\d+/);
  const diarienummer = diarieMatch ? diarieMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Fastighetsbeteckning: often ALL-CAPS word(s) + number:number
  const fastighetMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Adress: from page title or labeled field
  const adressMatch = text.match(/[Aa]dress:?\s+([^\n]+)/);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd: what the permit is for
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]+)/i);
  let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum: parseDatum(text) };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseSolnaText(text);
}

async function scrapeSolna() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Solna kungorelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} beviljade bygglov-sidor.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permit.status = link.status || 'beviljat';
          permit.permit_type = parsePermitType(permit.atgard);
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Solna' });
          console.error(`  -> ${permit.diarienummer} | ${permit.atgard || '?'}`);
        }
      } catch (err) {
        console.error(`  x ${link.url}: ${err.message}`);
      }
    }

    console.error(`Hittade ${permits.length} poster.`);

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ok ${permit.diarienummer} -- ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Solna-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeSolna().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
