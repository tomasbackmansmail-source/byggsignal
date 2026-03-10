require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const LISTING_URL = 'https://meetingsplus.danderyd.se/digital-bulletin-board';
const SOURCE_URL = 'https://www.danderyd.se/kommun-och-politik/beslut-och-protokoll/anslagstavla/';

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseDetailText(text) {
  // "NYA SVALNÄS 5, Diarienr: B 2026-000102, Bygglov för tillbyggnad av flerbostadshus inglasning av balkong"
  const diarieMatch = text.match(/Diarienr:\s*(B\s+\d{4}-\d+)/i);
  if (!diarieMatch) return null;
  const diarienummer = diarieMatch[1].replace(/\s+/g, ' ').trim();

  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+(.+?)(?:\n|$)/);
  let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Fastighet: "NYA SVALNÄS 5" - from title heading
  const fastighetMatch = text.match(/^\s*([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s*\nTitel/m);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  return { diarienummer, atgard, fastighetsbeteckning, beslutsdatum: parseDatum(text) };
}

async function scrapeDanderyd() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Danderyd kungorelser...');

    const lovLinks = [];
    let pageIndex = 1;
    let hasMore = true;

    while (hasMore) {
      const url = pageIndex === 1
        ? LISTING_URL
        : `${LISTING_URL}?pageIndex=${pageIndex}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      const entries = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'));
        return rows.map(row => {
          const cols = row.innerText.trim().split('\n');
          const link = row.querySelector('a[href*="/announcements/"]');
          return {
            type: cols[1] || '',
            href: link ? link.href : ''
          };
        }).filter(e => e.href);
      });

      if (entries.length === 0) {
        hasMore = false;
      } else {
        for (const e of entries) {
          if (/Kungörelse lov MSN/i.test(e.type)) {
            lovLinks.push(e.href);
          }
        }
        const hasNext = await page.evaluate(p => {
          return Array.from(document.querySelectorAll('a')).some(a => a.textContent.trim() === String(p + 1));
        }, pageIndex);
        if (!hasNext) hasMore = false;
        else pageIndex++;
      }
    }

    console.error(`Hittade ${lovLinks.length} lov-kungorelser.`);

    const permits = [];
    for (const href of lovLinks) {
      await page.goto(href, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1000));
      const text = await page.evaluate(() => document.body.innerText);
      const detail = parseDetailText(text);
      if (!detail || !detail.atgard) continue;
      if (!/nybyggnad|tillbyggnad/i.test(detail.atgard)) continue;

      permits.push({
        diarienummer: detail.diarienummer,
        fastighetsbeteckning: detail.fastighetsbeteckning,
        adress: null,
        atgard: detail.atgard,
        beslutsdatum: detail.beslutsdatum,
        status: 'beviljat',
        permit_type: parsePermitType(detail.atgard),
        kommun: 'Danderyd',
        sourceUrl: SOURCE_URL,
      });
    }

    console.error(`Hittade ${permits.length} nybyggnad/tillbyggnad-poster.`);
    permits.forEach(p => console.error(`  -> ${p.diarienummer} | ${p.atgard}`));

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ok ${permit.diarienummer} -- ${permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Danderyd-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeDanderyd().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
