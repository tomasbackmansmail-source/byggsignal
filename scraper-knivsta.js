require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://knivsta.se';

async function getBygglovLinks(page) {
  const year = new Date().getFullYear();
  const LISTING_URL = `${BASE_URL}/politik-och-organisation/anslag--kungorelser-och-sammantraden/kungorelser-${year}/`;

  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base, year) => {
    const pathFragment = `/kungorelser-${year}/`;
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href || !href.includes(pathFragment)) return;
      const url = href.startsWith('http') ? href : base + href;
      // Must be deeper than listing page (individual permit page)
      if (!url.includes(pathFragment + '2')) return;
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      results.push({ title: text || href, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL, year);

  return links.filter(l => /bygglov/i.test(l.title + l.url));
}

function parseKnivstaText(text) {
  // Diarienummer: "BMK YYYY-NNNNNN"
  const diarieMatch = text.match(/BMK\s+\d{4}-\d+/);
  const diarienummer = diarieMatch ? diarieMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Fastighet: ALL-CAPS + digit:digit
  const fastighetMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address
  const adressMatch = text.match(/^[Aa]dress:?\s+([^\n]+)/im);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd: from page title or content
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]+)/i)
    || text.match(/[Åå]tgärd:?\s+([^\n]+)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  return { fastighetsbeteckning, diarienummer, adress, atgard };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseKnivstaText(text);
}

async function scrapeKnivsta() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Knivsta kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Knivsta' });
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
    console.error(`Klart: ${saved}/${bygglov.length} Knivsta-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeKnivsta().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
