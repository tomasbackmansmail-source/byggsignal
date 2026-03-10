require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const BASE_URL = 'https://www.nacka.se';
const LISTING_URL = `${BASE_URL}/kommun--politik/delta-och-paverka/anslagstavla-officiell/kungorelser/`;

async function acceptCookies(page) {
  try {
    await page.click('button[name="cookie_consent"][value="essential"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 });
  } catch (_) {
    // Cookie banner may not be present on every page
  }
}

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2' });
  await acceptCookies(page);

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const text = el.innerText.trim();
      const href = el.getAttribute('href');
      if (!href || !/bygglov/i.test(text)) return;
      // Exclude generic /bygga-nytt links – keep only kungörelse pages
      if (!href.includes('kungorelse')) return;
      const url = href.startsWith('http') ? href : base + href;
      results.push({ title: text, url });
    });
    // Deduplicate by URL
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

// Extract YYYY-MM-01 from URL pattern like /2026/02/
function dateFromUrl(url) {
  const m = url.match(/\/(\d{4})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

function parsePermitsFromText(text) {
  // Nacka diarienummer format: "B 2025-001490"
  const diariePattern = /\bB\s+\d{4}-\d+/g;
  const matches = [...text.matchAll(diariePattern)];

  if (matches.length === 0) {
    return [{
      diarienummer: null,
      fastighetsbeteckning: null,
      adress: null,
      atgard: null,
      rawChunk: text.slice(0, 800).replace(/\s+/g, ' ').trim(),
    }];
  }

  return matches.map(match => {
    const dEnd = match.index + match[0].length;
    // Look back up to 600 chars to find the start of this entry (last lov/anmälan keyword)
    const lookback = text.slice(Math.max(0, match.index - 600), match.index);
    const entryStarts = [...lookback.matchAll(/(?:Frivilligt\s+)?(?:Bygglov|Marklov|Rivningslov|Anmälan)\s+för/gi)];
    const lastEntryStart = entryStarts.length > 0 ? entryStarts[entryStarts.length - 1] : null;
    const chunkStart = lastEntryStart
      ? Math.max(0, match.index - 600) + lastEntryStart.index
      : Math.max(0, match.index - 400);

    const chunk = text.slice(chunkStart, dEnd).replace(/\s+/g, ' ').trim();

    // Fastighetsbeteckning: ALL-CAPS word(s) + number:number, e.g. "BJÖRKNÄS 1:615"
    const fastighetMatch = chunk.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9]*(?:\s[A-ZÅÄÖ0-9]+)*\s+\d+:\d+)/);
    // Adress is always in parentheses
    const adressMatch = chunk.match(/\(([^)]+)\)/);
    // Åtgärd: text between "för" and the fastighet/parenthesis
    const atgardMatch = chunk.match(/\bför\s+(.+?)(?:\s+(?:på|av)\s+[A-ZÅÄÖ]{2}|,\s*[A-ZÅÄÖ]{2,}\s+\d+:|,\s*installation|,\s*rivning\b)/i);

    return {
      diarienummer: match[0].replace(/\s+/g, ' ').trim(),
      fastighetsbeteckning: fastighetMatch ? fastighetMatch[1].trim() : null,
      adress: adressMatch ? adressMatch[1].trim() : null,
      atgard: atgardMatch ? atgardMatch[1].trim().toLowerCase() : null,
      beslutsdatum: parseDatum(chunk),
    };
  });
}

async function scrapePermitPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2' });
  await acceptCookies(page);

  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });

  return parsePermitsFromText(text);
}

async function scrapeNacka() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Nacka kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelse(r).`);

    let saved = 0;
    let skipped = 0;

    for (const link of links) {
      console.error(`  → ${link.title}: ${link.url}`);
      const urlDate = dateFromUrl(link.url);

      try {
        const permits = await scrapePermitPage(page, link.url);

        for (const permit of permits) {
          if (!permit.diarienummer) { skipped++; continue; }
          try {
            await savePermit({
              ...permit,
              // Use URL-derived date as fallback when page text has no parseable date
              beslutsdatum: permit.beslutsdatum || urlDate,
              status: 'beviljat',
              permit_type: parsePermitType(permit.atgard),
              sourceUrl: link.url,
              kommun: 'Nacka',
            });
            saved++;
            console.error(`    ok ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning || '?'}`);
          } catch (err) {
            console.error(`    x ${permit.diarienummer}: ${err.message}`);
            skipped++;
          }
        }
      } catch (err) {
        console.error(`  x ${link.url.slice(-60)}: ${err.message}`);
        skipped++;
      }
    }

    console.error(`Klart: ${saved} Nacka-poster sparade till Supabase (${skipped} hoppade över).`);
  } finally {
    await browser.close();
  }
}

scrapeNacka().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
