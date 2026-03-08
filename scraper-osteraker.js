require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.osteraker.se';
// Primary listing page for building permit notices
const LISTING_URL = `${BASE_URL}/kommunpolitik/arendenochhandlingar/officiellaanslagstavlan/officiellaanslagstavlan/`;
// Secondary: kungörelser page in the building section
const SECONDARY_URL = `${BASE_URL}/byggabomiljo/bygganyttandraellerriva/kungorelserochdelgivning.4.367d658917909e8fc2bb5a.html`;

async function getBygglovLinks(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.error(`  ! Kunde inte ladda ${url}: ${e.message}`);
    return [];
  }

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href) return;
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      const url = href.startsWith('http') ? href : base + href;
      // Accept any link with bygglov in URL or text
      if (!/bygglov/i.test(url + text)) return;
      // Must be a detail page (contains anslagsbeviskungorelse or kungorelse)
      if (!/kungorelse|anslagsbev/i.test(url)) return;
      results.push({ title: text, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum|Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseOsterakerText(text) {
  // Fastighet: ALL-CAPS + digit pattern
  const fastighetMatch = text.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: in parentheses or "Adress:" field
  const adressMatch = text.match(/\(([^)]{5,60})\)/)
    || text.match(/^[Aa]dress:?\s+([^\n]+)/im);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Diarienummer: BN, MHN, SBN, BMN prefixes
  const diarieMatch = text.match(/\b(?:BN|MHN|SBN|BMN|BYGG)\s+\d{4}[-\/]\d+/i);
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

    let links = await getBygglovLinks(page, LISTING_URL);
    if (links.length === 0) {
      console.error('  (inga träffar på primär sida, provar sekundär)');
      links = await getBygglovLinks(page, SECONDARY_URL);
    }
    console.error(`Hittade ${links.length} bygglov-kungörelser.`);

    if (links.length === 0) {
      console.error('Inga aktiva bygglov-kungörelser hittades på Österåkers webbplats.');
      console.error('Österåker publicerar via Post- och Inrikes Tidningar — inga poster sparade.');
      return;
    }

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Österåker' });
          console.error(`  -> ${permit.diarienummer} | ${permit.atgard || '?'}`);
        }
      } catch (err) {
        console.error(`  x ${link.url}: ${err.message}`);
      }
    }

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ok ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Österåker-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeOsteraker().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
