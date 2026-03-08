require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.osteraker.se';
// Österåker uses Sitevision CMS — navigate via the official notice board section
const LISTING_URL = `${BASE_URL}/kommunpolitik/arendenochhandlingar/officiellaanslagstavlan/officiellaanslagstavlan/`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href || !href.includes('anslagsbeviskungorelse')) return;
      const url = href.startsWith('http') ? href : base + href;
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      results.push({ title: text || href, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links.filter(l => /bygglov/i.test(l.title + l.url));
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseOsterakerText(text) {
  // Fastighet: ALL-CAPS + digit:digit
  const fastighetMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: explicit field or in parentheses
  const adressMatch = text.match(/\(([^)]{5,60})\)/)
    || text.match(/^[Aa]dress:?\s+([^\n]+)/im);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Diarienummer: Österåker might use BN, MHN or similar prefix
  const diarieMatch = text.match(/\b(?:BN|MHN|SBN|BMN)\s+\d{4}-\d+/i);
  // Synthetic key using fastighet if no diarienummer found
  const diarienummer = diarieMatch
    ? diarieMatch[0].replace(/\s+/g, ' ').trim()
    : (fastighetsbeteckning ? `OSTERAKER-${fastighetsbeteckning.replace(/\s+/g, '-')}` : null);

  // Åtgärd
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+(?:avseende\s+)?(?:f[öo]r\s+)?([^\n.]+)/i)
    || text.match(/[Nn]ybyggnad|[Tt]illbyggnad/i);
  const atgard = atgardMatch
    ? (atgardMatch[1] || atgardMatch[0]).trim().toLowerCase()
    : null;

  return { fastighetsbeteckning, diarienummer, adress, atgard, beslutsdatum: parseDatum(text) };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseOsterakerText(text);
}

async function scrapeOsteraker() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Österåker kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Österåker' });
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
    console.error(`Klart: ${saved}/${bygglov.length} Österåker-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeOsteraker().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
