require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.botkyrka.se';
const LISTING_URL = `${BASE_URL}/kommun-och-politik/digital-anslagstavla`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      const text = el.innerText.trim();
      if (!href || !href.includes('anslagsarkiv')) return;
      if (!/kungorelse.*beslut.*bygglov|beslut.*om.*bygglov|frivilligt.*bygglov/i.test(text)) return;
      const url = href.startsWith('http') ? href : base + href;
      results.push({ title: text, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseBotkyrkaText(text) {
  // Diarienummer: "SBN 2025-000915"
  const diarieMatch = text.match(/SBN\s+\d{4}-\d+/);
  const diarienummer = diarieMatch ? diarieMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Fastighet: "SALVIAN 60 (SLAGSTA BACKE 154)" - extract fastighet and address separately
  const fastighetMatch = text.match(/Fastighet:\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s*(?:\(([^)]+)\))?/i);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;
  const adress = fastighetMatch && fastighetMatch[2] ? fastighetMatch[2].trim() : null;

  // Åtgärd: "Beslut om bygglov för [åtgärd]"
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n]+)/i);
  let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase().replace(/\.\s*$/, '') : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseBotkyrkaText(text);
}

async function scrapeBotkyrka() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Botkyrka kungorelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungorelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Botkyrka' });
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
    console.error(`Klart: ${saved}/${bygglov.length} Botkyrka-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeBotkyrka().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
