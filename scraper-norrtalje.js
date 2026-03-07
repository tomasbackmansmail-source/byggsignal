require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const LISTING_URL = 'https://forum.norrtalje.se/digital-bulletin-board';
const SOURCE_URL = 'https://forum.norrtalje.se/digital-bulletin-board';

function parseTitleForAtgardAndFastighet(title) {
  const atgardMatch = title.match(/f[öo]r\s+(.+?)\s+inom\s+/i);
  const fastighetMatch = title.match(/inom\s+([A-ZÅÄÖ][A-Za-zåäöÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s*$/i);
  return {
    atgard: atgardMatch ? atgardMatch[1].trim().toLowerCase() : null,
    fastighetsbeteckning: fastighetMatch ? fastighetMatch[1].trim() : null,
  };
}

function parseDetailText(text) {
  const diarieMatch = text.match(/Diarienummer:\s*(BoM\s+\d{4}-\d+)/i);
  if (!diarieMatch) return null;
  const diarienummer = diarieMatch[1].replace(/\s+/g, ' ').trim();
  const adressMatch = text.match(/\(([^)]+)\)/);
  const adress = adressMatch ? adressMatch[1].trim() : null;
  return { diarienummer, adress };
}

async function scrapeNorrtalje() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Norrtalje kungorelser...');

    const relevantLinks = [];
    let pageIndex = 1;
    let hasMore = true;

    while (hasMore) {
      const url = pageIndex === 1
        ? LISTING_URL
        : `${LISTING_URL}?pageIndex=${pageIndex}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const entries = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'));
        return rows.map(row => {
          const link = row.querySelector('a[href*="/announcements/"]');
          return {
            type: row.innerText.split('\n')[0].trim(),
            title: link ? link.innerText.trim() : '',
            href: link ? link.href : ''
          };
        }).filter(e => e.href);
      });

      if (entries.length === 0) {
        hasMore = false;
      } else {
        for (const e of entries) {
          if (/Beviljade beslut/i.test(e.type) && /nybyggnad|tillbyggnad/i.test(e.title)) {
            relevantLinks.push({ href: e.href, title: e.title });
          }
        }
        const hasNext = await page.evaluate(p => {
          return Array.from(document.querySelectorAll('a')).some(a => a.textContent.trim() === String(p + 1));
        }, pageIndex);
        if (!hasNext) hasMore = false;
        else pageIndex++;
      }
    }

    console.error(`Hittade ${relevantLinks.length} relevanta kungorelser.`);

    const permits = [];
    for (const entry of relevantLinks) {
      await page.goto(entry.href, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1000));
      const text = await page.evaluate(() => document.body.innerText);
      const detail = parseDetailText(text);
      if (!detail) continue;
      const { atgard, fastighetsbeteckning } = parseTitleForAtgardAndFastighet(entry.title);
      permits.push({
        diarienummer: detail.diarienummer,
        fastighetsbeteckning,
        adress: detail.adress,
        atgard,
        kommun: 'Norrtälje',
        sourceUrl: SOURCE_URL,
      });
    }

    console.error(`Parsade ${permits.length} poster.`);
    permits.forEach(p => console.error(`  -> ${p.diarienummer} | ${p.atgard}`));

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ok ${permit.diarienummer} -- ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Norrtalje-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeNorrtalje().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
