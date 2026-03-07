require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.ekero.se';
const LISTING_URL = `${BASE_URL}/kommun-politik/moten-handlingar--protokoll/anslagstavla`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href || !href.includes('kungorelse-av-beviljad-atgard-pa-fastigheten')) return;
      const url = href.startsWith('http') ? href : base + href;
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      results.push({ title: text || href, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseEkeroText(text) {
  // Diarienummer: "BN 2025-000574"
  const diarieMatch = text.match(/BN\s+\d{4}-\d+/);
  const diarienummer = diarieMatch ? diarieMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Fastighetsbeteckning: ALL-CAPS + number:number
  const fastighetMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Adress
  const adressMatch = text.match(/[Aa]dress:?\s+([^\n]+)/);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]+)/i)
    || text.match(/[Åå]tg[äa]rd:?\s+([^\n]+)/i);
  let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseEkeroText(text);
}

async function scrapeEkero() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Ekero kungorelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} beviljade atgards-sidor.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Ekerö' });
          console.error(`  -> ${permit.diarienummer} | ${permit.atgard || '?'}`);
        }
      } catch (err) {
        console.error(`  x ${link.url}: ${err.message}`);
      }
    }

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
    console.error(`Klart: ${saved}/${bygglov.length} Ekero-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeEkero().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
