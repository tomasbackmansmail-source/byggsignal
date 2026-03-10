require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const ANSLAGSTAVLA_URL = 'https://www.sollentuna.se/kommun--politik/offentlighet-och-sekretess/anslagstavla-officiell/';

// NetPublicator board ID and relevant type
const NP_API    = 'https://www.netpublicator.com/bulletinboard/public';
const NP_ID     = '803df1e4-0d18-426a-97df-af5afb9bef5a';
// Type: "Kungörelse om beslut om lov eller förhandsbesked"
const NP_TYPE   = 'f6391920-fabf-4414-b77b-aae138148d1b';

function parseDatum(text) {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

function parseNoticeText(title, body) {
  // Combine title + body for parsing
  const full = `${title}\n${body}`;

  // Diarienummer: "BN 2025-001234" or "SBN 2026-000123"
  const diarieMatch = full.match(/\b(BN|SBN|MBN|BMN|BYGG)\s+(\d{4}[-]\d+)/i);
  const diarienummer = diarieMatch
    ? `${diarieMatch[1].toUpperCase()} ${diarieMatch[2]}`
    : null;

  // Fastighetsbeteckning: ALL-CAPS word(s) + digit:digit pattern
  const fastighetMatch = full.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: in parentheses or after specific keywords
  const adressMatch = full.match(/\(([A-ZÅÄÖ][^)]{5,60})\)/i)
    || full.match(/(?:adress|gatan|vägen|stigen|torget)[:\s]+([^\n,]+)/i);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd: after "bygglov för" or "lov för"
  const atgardMatch = full.match(/(?:bygglov|lov)\s+f[öo]r\s+([^\n,.]+)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Date: only match explicitly labelled decision dates or "Beviljas, YYYY-MM-DD"
  const datumMatch = full.match(/(?:besluts?datum|registreringsdatum|datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || full.match(/Beviljas,?\s*(\d{4}-\d{2}-\d{2})/i);
  const beslutsdatum = datumMatch ? datumMatch[1] : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum };
}

async function fetchNoticesViaPuppeteer() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  const notices = [];

  try {
    console.error('Laddar Sollentuna anslagstavla (NetPublicator)...');
    await page.goto(ANSLAGSTAVLA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for NetPublicator JS to fetch and render items
    await new Promise(r => setTimeout(r, 6000));

    // Extract all bulletin items using li[data-npid] (NetPublicator renders these)
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('li[data-npid]').forEach(el => {
        const titleEl = el.querySelector('.c-bulletin-item__heading span, .c-bulletin-item__link span');
        const title = titleEl ? titleEl.innerText.trim()
          : (el.dataset.title || '').split('>')[0].trim();
        const text  = (el.querySelector('.c-bulletin-item__text') || {}).innerText || '';
        const cat   = (el.querySelector('.c-bulletin-item__category') || {}).innerText || '';
        const pub   = el.dataset.published || el.querySelector('time')?.getAttribute('datetime') || '';
        results.push({ title: title.trim(), text: text.trim(), category: cat.trim(), published: pub });
      });
      return results;
    });

    console.error(`Hittade ${items.length} poster på anslagstavlan.`);

    // Filter for building permit decisions
    for (const item of items) {
      const combined = `${item.title} ${item.category}`;
      if (!/lov|förhandsbesked|bygglov/i.test(combined)) continue;
      if (/sammanträde|protokoll|kallelse/i.test(combined)) continue;
      notices.push(item);
    }

    console.error(`Varav ${notices.length} relevanta lov/förhandsbesked-poster.`);
  } finally {
    await browser.close();
  }

  return notices;
}

async function scrapeSollentuna() {
  const items = await fetchNoticesViaPuppeteer();

  if (items.length === 0) {
    console.error('Inga kungörelser om bygglov hittades för Sollentuna.');
    return;
  }

  let saved = 0;
  for (const item of items) {
    const { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum } = parseNoticeText(item.title, item.text);

    // Only use a date we parsed from actual permit text — never bulletin publish date
    const datum = beslutsdatum || null;

    const key = diarienummer
      || (fastighetsbeteckning ? `SOLLENTUNA-${fastighetsbeteckning.replace(/\s+/g, '-')}` : null);

    if (!key) {
      console.error(`  skip (no key): ${item.title.slice(0, 60)}`);
      continue;
    }

    try {
      await savePermit({
        diarienummer: key,
        fastighetsbeteckning,
        adress,
        atgard,
        status: 'beviljat',
        permit_type: parsePermitType(atgard),
        beslutsdatum: datum,
        kommun: 'Sollentuna',
        sourceUrl: ANSLAGSTAVLA_URL,
      });
      saved++;
      console.error(`  ok ${key} — ${adress || fastighetsbeteckning || item.title.slice(0, 40)}`);
    } catch (err) {
      console.error(`  x ${key}: ${err.message}`);
    }
  }
  console.error(`Klart: ${saved}/${items.length} Sollentuna-poster sparade.`);
}

scrapeSollentuna().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
