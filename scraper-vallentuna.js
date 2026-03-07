require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.vallentuna.se';
const LISTING_URL = `${BASE_URL}/kommun-och-politik/politik-och-demokrati/anslagstavla-officiell/anslag/`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href || !/bygglov/i.test(href)) return;
      const url = href.startsWith('http') ? href : base + href;
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      results.push({ title: text || href, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseVallentunaText(text) {
  // Diarienummer: "SHBG YYYY-NNNNNN"
  const diarieMatch = text.match(/SHBG\s+\d{4}-\d+/);
  const diarienummer = diarieMatch ? diarieMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Fastighet: ALL-CAPS name + digit:digit
  const fastighetMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: in parentheses after fastighet number
  const adressMatch = text.match(/\d+:\d+\s+\(([^)]+)\)/);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd
  const atgardMatch = text.match(/[Aa]nsökan om\s+(?:bygglov|rivningslov|marklov)\s+för\s+([^\n.]+)/i)
    || text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]+)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  return { fastighetsbeteckning, diarienummer, adress, atgard };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseVallentunaText(text);
}

async function scrapeVallentuna() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Vallentuna kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Vallentuna' });
        }
      } catch (err) {
        console.error(`  ✗ ${link.url}: ${err.message}`);
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
        console.error(`  ✓ ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Vallentuna-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeVallentuna().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
