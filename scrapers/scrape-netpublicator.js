#!/usr/bin/env node
/**
 * scrape-netpublicator.js
 *
 * Generic Netpublicator scraper. Municipality anslagstavla pages embed
 * a Netpublicator JS widget that renders bulletin items client-side.
 * We use Puppeteer to render, then extract and parse items.
 *
 * Two extraction strategies:
 *   1. "dom"  — Structured DOM: li[data-npid] items with heading/text elements
 *   2. "text" — Plain text: document.body.innerText split by section patterns
 *
 * Usage:
 *   node scrapers/scrape-netpublicator.js --config scrapers/configs/netpublicator/karlshamn.json
 *   node scrapers/scrape-netpublicator.js --config scrapers/configs/netpublicator/karlshamn.json --save
 *
 * Config format:
 *   {
 *     "kommun": "Karlshamn",
 *     "lan": "Blekinge län",
 *     "url": "https://www.karlshamn.se/kommun-och-politik/anslagstavla/",
 *     "strategy": "dom",          // "dom" (default) or "text"
 *     "waitMs": 6000,             // ms to wait after page load (default 6000)
 *     "diariePrefix": "BN",       // prefix for diarienummer matching (optional)
 *     "sectionSplit": "Kungörelse" // regex for text strategy section splitting (optional)
 *   }
 */

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { parsePermitType } = require('../scripts/parse-helpers');

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let config = null;
  let save = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save') {
      save = true;
    } else if (args[i] === '--config') {
      const filePath = args[++i];
      if (!filePath) { console.error('--config requires a path'); process.exit(1); }
      config = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'));
    } else if (args[i] === '--dry-run') {
      save = false;
    } else if (args[i].startsWith('{')) {
      config = JSON.parse(args[i]);
    }
  }

  if (!config) {
    console.error('Usage: node scrapers/scrape-netpublicator.js [--save] --config <file.json>');
    process.exit(1);
  }
  if (!config.kommun) { console.error('Config missing "kommun"'); process.exit(1); }
  if (!config.url) { console.error('Config missing "url"'); process.exit(1); }
  if (!config.strategy) config.strategy = 'dom';
  if (!config.waitMs) config.waitMs = 6000;

  return { config, save };
}

// ── Text parsing helpers ─────────────────────────────────────────────────────

// Broad diarienummer pattern: BN, SBN, MBN, BMN, BYGG, LOV, BNS, SPN etc.
const DIARIE_RE = /\b(BN|SBN|MBN|BMN|BNS|SPN|BYGG|LOV)\s+(\d{4}[-/]\d+)/i;

// Fastighetsbeteckning: UPPERCASE word(s) + number:number
const FASTIGHET_RE = /([A-ZÅÄÖ][A-ZÅÄÖ\s\-]{1,30}\d+:\d+)/;

// Address in parentheses
const ADDR_PAREN_RE = /\(([A-ZÅÄÖ][^)]{5,60})\)/i;

// Address from keywords
const ADDR_KW_RE = /(?:adress|gatan|vägen|stigen|torget|allén)[:\s]+([^\n,]{3,60})/i;

// Åtgärd after "lov för" / "avser"
const ATGARD_RE = /(?:bygglov|lov|beslut)\s+(?:om\s+)?f[öo]r\s+([^\n,.]{3,100})/i;
const ATGARD_RE2 = /(?:avser|gäller)\s+([^\n,.]{3,100})/i;

// Decision date
const DATUM_RE = /(?:besluts?datum|registreringsdatum|datum|anslaget)[:\s]+(\d{4}-\d{2}-\d{2})/i;
const DATUM_RE2 = /\bBeviljas,?\s*(\d{4}-\d{2}-\d{2})/i;
const DATUM_GENERIC = /\b(\d{4}-\d{2}-\d{2})\b/;

function parseNoticeText(title, body) {
  const full = (title + '\n' + body).replace(/\r/g, '');

  const diarieMatch = full.match(DIARIE_RE);
  const diarienummer = diarieMatch
    ? (diarieMatch[1].toUpperCase() + ' ' + diarieMatch[2]).trim()
    : null;

  const fastighetMatch = full.match(FASTIGHET_RE);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  const adressMatch = full.match(ADDR_PAREN_RE) || full.match(ADDR_KW_RE);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  const atgardMatch = full.match(ATGARD_RE) || full.match(ATGARD_RE2);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  const datumMatch = full.match(DATUM_RE) || full.match(DATUM_RE2) || full.match(DATUM_GENERIC);
  const beslutsdatum = datumMatch ? datumMatch[1] : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum };
}

// ── Strategy: DOM extraction ─────────────────────────────────────────────────

async function extractDom(page) {
  return page.evaluate(() => {
    const results = [];
    document.querySelectorAll('li[data-npid]').forEach(el => {
      const titleEl = el.querySelector(
        '.c-bulletin-item__heading span, .c-bulletin-item__link span, .c-bulletin-item__heading, h3, h4'
      );
      const title = titleEl ? titleEl.innerText.trim()
        : (el.dataset.title || '').split('>')[0].trim();
      const text = (el.querySelector('.c-bulletin-item__text, .c-bulletin-item__body, p') || {}).innerText || '';
      const cat = (el.querySelector('.c-bulletin-item__category, .category') || {}).innerText || '';
      const pub = el.dataset.published
        || (el.querySelector('time') || {}).getAttribute?.('datetime') || '';
      results.push({ title, text, category: cat, published: pub });
    });
    return results;
  });
}

// ── Strategy: plain text extraction ──────────────────────────────────────────

async function extractText(page, config) {
  const body = await page.evaluate(() => document.body.innerText);
  const splitPattern = config.sectionSplit
    ? new RegExp('(?=' + config.sectionSplit + ')', 'gi')
    : /(?=Kungörelse\s+om\s+(?:beslut|bygglov|lov))/gi;

  const sections = body.split(splitPattern).filter(s => DIARIE_RE.test(s) || FASTIGHET_RE.test(s));

  return sections.map(s => {
    const lines = s.split('\n');
    return {
      title: lines[0] || '',
      text: lines.slice(1).join('\n'),
      category: '',
      published: '',
    };
  });
}

// ── Filtering ────────────────────────────────────────────────────────────────

const INCLUDE_RE = /lov|förhandsbesked|bygglov|strandskydd|rivning|marklov|kungörelse/i;
const EXCLUDE_RE = /sammanträde|protokoll|kallelse|nämnd|budget|taxa|motion/i;

function filterRelevant(items) {
  return items.filter(item => {
    const combined = item.title + ' ' + item.category + ' ' + item.text.slice(0, 200);
    if (EXCLUDE_RE.test(combined)) return false;
    return INCLUDE_RE.test(combined);
  });
}

// ── Build permit row ─────────────────────────────────────────────────────────

function buildRow(parsed, config, sourceUrl) {
  const bd = parsed.beslutsdatum;
  const bdYear = bd ? parseInt(bd.slice(0, 4), 10) : null;
  const currentYear = new Date().getFullYear();
  const validBd = bd && bdYear >= 2020 && bdYear <= currentYear ? bd : null;
  const now = new Date().toISOString();

  return {
    diarienummer: parsed.diarienummer,
    fastighetsbeteckning: parsed.fastighetsbeteckning,
    adress: parsed.adress,
    atgard: parsed.atgard,
    kommun: config.kommun,
    lan: config.lan || null,
    country: 'SE',
    sourceUrl: sourceUrl,
    status: 'beviljat',
    permit_type: parsePermitType(parsed.atgard || ''),
    beslutsdatum: validBd,
    scraped_at: validBd ? new Date(validBd).toISOString() : now,
  };
}

// ── Database ─────────────────────────────────────────────────────────────────

let _savePermit = null;
function getSavePermit() {
  if (!_savePermit) {
    const { savePermit } = require('../db');
    _savePermit = savePermit;
  }
  return _savePermit;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { config, save } = parseArgs();
  const mode = save ? 'SAVE' : 'DRY-RUN';
  console.error(`\n${config.kommun} (${mode}) — ${config.url}`);
  console.error('─'.repeat(60));

  // Launch Puppeteer
  const launchOpts = { headless: 'new' };
  if (process.env.CI) {
    launchOpts.args = ['--no-sandbox', '--disable-setuid-sandbox'];
  }
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error(`  Loading page...`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, config.waitMs));

    // Extract items
    let items;
    if (config.strategy === 'text') {
      items = await extractText(page, config);
    } else {
      items = await extractDom(page);
      // Fallback to text strategy if DOM yielded nothing
      if (items.length === 0) {
        console.error('  DOM strategy found 0 items, falling back to text...');
        items = await extractText(page, config);
      }
    }

    console.error(`  Found ${items.length} bulletin items`);

    // Filter for building permits
    const relevant = filterRelevant(items);
    console.error(`  Filtered to ${relevant.length} relevant items`);

    // Parse each item
    const permits = [];
    const skipped = [];

    for (const item of relevant) {
      const parsed = parseNoticeText(item.title, item.text);

      // Generate a key — prefer diarienummer, fallback to kommun+fastighet
      const key = parsed.diarienummer
        || (parsed.fastighetsbeteckning
          ? `${config.kommun.toUpperCase().replace(/\s/g,'-')}-${parsed.fastighetsbeteckning.replace(/\s+/g, '-')}`
          : null);

      if (!key) {
        skipped.push(item.title.slice(0, 60));
        continue;
      }

      const row = buildRow({ ...parsed, diarienummer: key }, config, config.url);
      permits.push(row);
    }

    if (skipped.length > 0) {
      console.error(`  Skipped ${skipped.length} items (no key):`);
      skipped.forEach(s => console.error(`    - ${s}`));
    }

    // Save or dry-run
    let saved = 0;
    if (save) {
      const savePermit = getSavePermit();
      for (const row of permits) {
        try {
          await savePermit(row);
          saved++;
          console.error(`  ok ${row.diarienummer} — ${row.adress || row.fastighetsbeteckning || '?'}`);
        } catch (err) {
          console.error(`  x  ${row.diarienummer}: ${err.message}`);
        }
      }
    } else {
      for (const row of permits) {
        console.log(`  ${row.diarienummer} | ${row.fastighetsbeteckning || '?'} | ${row.adress || '—'} | ${row.beslutsdatum || '?'} | ${row.permit_type}`);
      }
    }

    console.error(`\n${config.kommun}: ${relevant.length} relevant, ${permits.length} parsed, ${save ? saved + ' saved' : 'dry-run'}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
