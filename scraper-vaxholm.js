require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.vaxholm.se';
const LISTING_URL = `${BASE_URL}/bygga-bo--miljo/bygga-nytt-andra-eller-riva/kungorelser-pbl`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href || !href.includes('/kungorelser-pbl/kungorelser-pbl/')) return;
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

function parseVaxholmText(text) {
  // Fastighet: ALL-CAPS + digit:digit
  const fastighetMatch = text.match(/^Fastighet[:\s]+([A-ZÅÄÖ][^\n]+\d+:\d+)/im)
    || text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address
  const adressMatch = text.match(/^[Aa]dress:?\s+([^\n]+)/im);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Ärendenummer: "BYGG.YYYY.N"
  const diarieMatch = text.match(/BYGG\.\d{4}\.\d+/);
  const diarienummer = diarieMatch ? diarieMatch[0].trim() : null;

  // Åtgärd
  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+(?:och\s+\w+\s+)?f[öo]r\s+([^\n.]+)/i)
    || text.match(/[Åå]tgärd:?\s+([^\n]+)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  return { fastighetsbeteckning, diarienummer, adress, atgard, beslutsdatum: parseDatum(text) };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  return parseVaxholmText(text);
}

async function scrapeVaxholm() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Vaxholm kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Vaxholm' });
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
    console.error(`Klart: ${saved}/${bygglov.length} Vaxholm-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeVaxholm().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
