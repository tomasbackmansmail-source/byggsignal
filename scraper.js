const puppeteer = require('puppeteer');
const fs = require('fs');
const { savePermit } = require('./db');

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
      rawChunk: chunk.slice(0, 500),
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

async function scrape() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar lista med kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} bygglov-kungörelse(r).`);

    const results = [];
    for (const link of links) {
      console.error(`  → ${link.title}: ${link.url}`);
      try {
        const permits = await scrapePermitPage(page, link.url);
        results.push({ source: link, permits });
      } catch (err) {
        results.push({ source: link, error: err.message });
      }
    }

    const allPermits = results.flatMap(r => (r.permits || []).map(p => ({ ...p, sourceUrl: r.source.url, sourceTitle: r.source.title })));
    const filtered = allPermits.filter(p => p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard));

    const output = { scrapedAt: new Date().toISOString(), total: allPermits.length, filtered: filtered.length, permits: filtered };
    fs.writeFileSync('permits.json', JSON.stringify(output, null, 2));
    console.error(`Sparade ${filtered.length} av ${allPermits.length} poster till permits.json`);

    console.error('Sparar till Supabase...');
    let saved = 0;
    for (const permit of filtered) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${filtered.length} poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrape().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
