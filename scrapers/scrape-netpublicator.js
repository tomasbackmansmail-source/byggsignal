#!/usr/bin/env node
/**
 * scrape-netpublicator.js
 *
 * Generic Netpublicator scraper. Municipalities embed a Netpublicator
 * bulletin board widget (via iframe or JS). We go directly to the NP
 * board URL to avoid cookie-consent blockers, then extract items from
 * the bbl-item DOM structure.
 *
 * Usage:
 *   node scrapers/scrape-netpublicator.js --config scrapers/configs/netpublicator/karlshamn.json
 *   node scrapers/scrape-netpublicator.js --config scrapers/configs/netpublicator/karlshamn.json --save
 *
 * Config format:
 *   {
 *     "kommun": "Karlshamn",
 *     "lan": "Blekinge län",
 *     "boardUrl": "https://www.netpublicator.com/bulletinboard/public/<BOARD-ID>",
 *     "sourceUrl": "https://www.karlshamn.se/kommun-och-politik/anslagstavla/",
 *     "waitMs": 5000
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
  if (!config.boardUrl) { console.error('Config missing "boardUrl"'); process.exit(1); }
  if (!config.waitMs) config.waitMs = 5000;

  return { config, save };
}

// ── Text parsing helpers ─────────────────────────────────────────────────────

// Diarienummer: BN, SBN, MBN, BMN, BYGG, LOV, BNS, SPN, MBN etc.
const DIARIE_RE = /\b(BN|SBN|MBN|BMN|BNS|SPN|BYGG|LOV)\s+(\d{4}[-/]\d+)/i;

// Fastighetsbeteckning: UPPERCASE word(s) + number:number
const FASTIGHET_RE = /([A-ZÅÄÖ][A-ZÅÄÖ\s\-]{1,30}\d+:\d+)/;

// Address in parentheses — e.g. (STORGATAN 12)
const ADDR_PAREN_RE = /\(([A-ZÅÄÖ][^)]{5,60})\)/i;

// Address from keywords
const ADDR_KW_RE = /(?:adress|gatan|vägen|stigen|torget|allén)[:\s]+([^\n,]{3,60})/i;

// Åtgärd: after "lov för" / "avser"
const ATGARD_RE = /(?:bygglov|lov|beslut)\s+(?:om\s+)?f[öo]r\s+([^\n,.]{3,100})/i;
const ATGARD_RE2 = /(?:avser|gäller)\s+([^\n,.]{3,100})/i;

// Decision date
const DATUM_RE = /(?:besluts?datum|registreringsdatum|datum|anslaget)[:\s]+(\d{4}-\d{2}-\d{2})/i;
const DATUM_RE2 = /\bbeviljas[,\s]+(\d{4}-\d{2}-\d{2})/i;

function parseNoticeText(title, body, linkTexts) {
  const full = (title + '\n' + body + '\n' + linkTexts.join('\n')).replace(/\r/g, '');

  const diarieMatch = full.match(DIARIE_RE);
  const diarienummer = diarieMatch
    ? (diarieMatch[1].toUpperCase() + ' ' + diarieMatch[2]).trim()
    : null;

  // Try to get fastighetsbeteckning from text, then from link texts
  let fastighetMatch = full.match(FASTIGHET_RE);
  let fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // If no colon-style fastighet, check link texts for property names like "FLASKAN 7" or "Färjestad 2:19"
  if (!fastighetsbeteckning && linkTexts.length > 0) {
    for (const lt of linkTexts) {
      if (/^(Visa|Kungörelse|Protokoll|Dokument|Stadsbygg)/i.test(lt)) continue;
      // Accept link texts that look like property names (letter + number pattern)
      if (/^[A-ZÅÄÖ]/i.test(lt) && /\d/.test(lt) && lt.length >= 3 && lt.length <= 50) {
        fastighetsbeteckning = lt.trim();
        break;
      }
    }
  }

  const adressMatch = full.match(ADDR_PAREN_RE) || full.match(ADDR_KW_RE);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  const atgardMatch = full.match(ATGARD_RE) || full.match(ATGARD_RE2);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  const datumMatch = full.match(DATUM_RE) || full.match(DATUM_RE2);
  const beslutsdatum = datumMatch ? datumMatch[1] : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum };
}

// ── DOM extraction ──────────────────────────────────────────────────────────

async function extractItems(page) {
  return page.evaluate(() => {
    const results = [];
    document.querySelectorAll('li[data-npid]').forEach(el => {
      const title = el.dataset.title || '';
      const published = el.dataset.published || '';
      const subtitle = (el.querySelector('.bbl-item-title-small') || {}).innerText || '';
      // Get full text (includes expandable "Visa mer" content)
      const fullText = el.innerText || '';
      // Get link texts (often fastighetsbeteckning or document names)
      const links = Array.from(el.querySelectorAll('a')).map(a => a.innerText.trim());
      results.push({ title, subtitle, text: fullText, published, linkTexts: links });
    });
    return results;
  });
}

// ── Filtering ────────────────────────────────────────────────────────────────

const INCLUDE_RE = /lov|förhandsbesked|bygglov|strandskydd|rivning|marklov|kungörelse/i;
// Only exclude based on title — subtitle often contains "nämnd" (committee name)
const EXCLUDE_RE = /^(Meddelande om justerat protokoll|Kallelse till|Sammanträde|Protokolljustering)/i;

function filterRelevant(items) {
  return items.filter(item => {
    if (EXCLUDE_RE.test(item.title)) return false;
    const combined = item.title + ' ' + item.text.slice(0, 300);
    return INCLUDE_RE.test(combined);
  });
}

// ── Build permit row ─────────────────────────────────────────────────────────

function buildRow(parsed, config) {
  const bd = parsed.beslutsdatum;
  const bdYear = bd ? parseInt(bd.slice(0, 4), 10) : null;
  const currentYear = new Date().getFullYear();
  const validBd = bd && bdYear >= 2020 && bdYear <= currentYear ? bd : null;
  const now = new Date();
  const nowIso = now.toISOString();
  let scrapedAt = nowIso;
  if (validBd) {
    const bdDate = new Date(validBd);
    scrapedAt = bdDate <= now ? bdDate.toISOString() : nowIso;
  }

  return {
    diarienummer: parsed.diarienummer,
    fastighetsbeteckning: parsed.fastighetsbeteckning,
    adress: parsed.adress,
    atgard: parsed.atgard,
    kommun: config.kommun,
    lan: config.lan || null,
    country: 'SE',
    sourceUrl: config.sourceUrl || config.boardUrl,
    status: 'beviljat',
    permit_type: parsePermitType(parsed.atgard || ''),
    beslutsdatum: validBd,
    scraped_at: scrapedAt,
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
  console.error(`\n${config.kommun} (${mode}) — ${config.boardUrl}`);
  console.error('─'.repeat(60));

  const launchOpts = { headless: 'new' };
  if (process.env.CI) {
    launchOpts.args = ['--no-sandbox', '--disable-setuid-sandbox'];
  }
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error(`  Loading NP board...`);
    await page.goto(config.boardUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, config.waitMs));

    const items = await extractItems(page);
    console.error(`  Found ${items.length} bulletin items`);

    const relevant = filterRelevant(items);
    console.error(`  Filtered to ${relevant.length} relevant items`);

    const permits = [];
    const skipped = [];

    for (const item of relevant) {
      const parsed = parseNoticeText(item.title, item.text, item.linkTexts || []);

      // Key: prefer diarienummer, fallback to kommun+fastighet
      const key = parsed.diarienummer
        || (parsed.fastighetsbeteckning
          ? `${config.kommun.toUpperCase().replace(/\s/g, '-')}-${parsed.fastighetsbeteckning.replace(/\s+/g, '-')}`
          : null);

      if (!key) {
        skipped.push(item.title.slice(0, 60));
        continue;
      }

      const row = buildRow({ ...parsed, diarienummer: key }, config);
      permits.push(row);
    }

    if (skipped.length > 0) {
      console.error(`  Skipped ${skipped.length} items (no key):`);
      skipped.forEach(s => console.error(`    - ${s}`));
    }

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
