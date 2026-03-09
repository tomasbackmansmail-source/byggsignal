require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

// Upplands-Bro: officiell anslagstavla
// OBS: URL är bästa gissning baserad på kommunens webbstruktur —
// verifiera i webbläsaren och justera om nödvändigt.
const BASE_URL = 'https://www.upplands-bro.se';
const LISTING_URL = `${BASE_URL}/kommunpolitik/demokrati/officiell-anslagstavla`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href) return;
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      const combined = href + ' ' + text;
      if (!/bygglov/i.test(combined)) return;
      const url = href.startsWith('http') ? href : base + href;
      results.push({ title: text || href, url });
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

function parseUpplandsbroText(text) {
  // Diarienummer: common patterns — BN, SBN, BYGG prefixes
  const diarieMatch = text.match(/\b(?:BN|SBN|BYGG)\s+\d{4}[-\/]\d+/i)
    || text.match(/\b(?:BN|SBN|BYGG)\.\d{4}\.\d+/i);
  const diarienummer = diarieMatch ? diarieMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Fastighet: ALL-CAPS name + digit:digit
  const fastighetMatch = text.match(/Fastighet:?\s*([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/i)
    || text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: in parentheses after fastighet, or on "Adress:" row
  const adressMatch = text.match(/\d+:\d+\s*\(([^)]+)\)/)
    || text.match(/^[Aa]dress:?\s+([^\n]+)/im);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+(?:för\s+)?([^\n.]+)/i)
    || text.match(/[Åå]tgärd:?\s+([^\n]+)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum: parseDatum(text) };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseUpplandsbroText(text);
}

async function scrapeUpplandsro() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Upplands-Bro kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelser.`);

    if (links.length === 0) {
      console.error('Inga bygglov-kungörelser hittades. Kontrollera LISTING_URL.');
      return;
    }

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Upplands-Bro' });
          console.error(`  -> ${permit.diarienummer} | ${permit.atgard || '?'}`);
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
    console.error(`Klart: ${saved}/${bygglov.length} Upplands-Bro-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeUpplandsro().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
