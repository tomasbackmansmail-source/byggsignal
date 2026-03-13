#!/usr/bin/env node
/**
 * scrape-meetingsplus.js
 *
 * Generic MeetingsPlus (Formpipe) scraper. Municipalities use MeetingsPlus
 * for digital bulletin boards at <subdomain>/digital-bulletin-board.
 *
 * Usage:
 *   node scrapers/scrape-meetingsplus.js --config scrapers/configs/meetingsplus/danderyd.json
 *   node scrapers/scrape-meetingsplus.js --config scrapers/configs/meetingsplus/danderyd.json --save
 *
 * Config format:
 *   {
 *     "kommun": "Danderyd",
 *     "lan": "Stockholms län",
 *     "boardUrl": "https://meetingsplus.danderyd.se/digital-bulletin-board",
 *     "sourceUrl": "https://www.danderyd.se/anslagstavla/",
 *     "waitMs": 3000
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
    console.error('Usage: node scrapers/scrape-meetingsplus.js [--save] --config <file.json>');
    process.exit(1);
  }
  if (!config.kommun) { console.error('Config missing "kommun"'); process.exit(1); }
  if (!config.boardUrl) { console.error('Config missing "boardUrl"'); process.exit(1); }
  if (!config.waitMs) config.waitMs = 3000;

  return { config, save };
}

// ── Text parsing helpers ─────────────────────────────────────────────────────

// Diarienummer: "Diarienr: B 2026-000102" or "ärende BoM 2026-000508" or bare "BN 2025-1234"
const DIARIE_RE = /(?:Diarienr(?:ummer)?[:\s]+|ärende\s+)((?:[A-ZÅÄÖa-zåäö]{1,5}\s+)?\d{4}[-/]\d+)/i;
const DIARIE_RE2 = /\b(B|BoM|BN|SBN|MBN|BMN|BNS|SPN|BYGG|LOV)\s+(\d{4}[-/]\d+)/i;

// Fastighetsbeteckning: UPPERCASE word(s) + number:number
const FASTIGHET_RE = /([A-ZÅÄÖ][A-ZÅÄÖ\s\-]{1,30}\d+:\d+)/;

// Fastighet from "inom FASTIGHET" pattern (Norrtälje-style titles)
const FASTIGHET_INOM_RE = /inom\s+(?:fastigheten\s+)?([A-ZÅÄÖ][A-Za-zåäöÅÄÖ0-9\s\-]+\d+(?::\d+)?)/i;

// Address in parentheses — e.g. (STORGATAN 12)
const ADDR_PAREN_RE = /\(([A-ZÅÄÖ][^)]{3,60})\)/i;

// Åtgärd: after "lov för" / "avser"
const ATGARD_RE = /(?:bygglov|lov|beslut)\s+(?:om\s+)?f[öo]r\s+([^\n,.]{3,100})/i;
const ATGARD_RE2 = /(?:avser|gäller|ansökan om)\s+(?:bygglov\s+för\s+)?([^\n,.]{3,100})/i;

// Decision date
const DATUM_RE = /(?:besluts?datum|registreringsdatum|datum|anslaget|publicerad)[:\s]+(\d{4}-\d{2}-\d{2})/i;
const DATUM_RE2 = /(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i;

function parseDetailText(title, bodyText) {
  const full = (title + '\n' + bodyText).replace(/\r/g, '');

  let diarienummer = null;
  const diarieMatch = full.match(DIARIE_RE);
  if (diarieMatch) {
    diarienummer = diarieMatch[1].replace(/\s+/g, ' ').trim();
  } else {
    const diarieMatch2 = full.match(DIARIE_RE2);
    if (diarieMatch2) {
      diarienummer = (diarieMatch2[1] + ' ' + diarieMatch2[2]).trim();
    }
  }

  const fastighetMatch = full.match(FASTIGHET_INOM_RE) || full.match(FASTIGHET_RE);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  const adressMatch = full.match(ADDR_PAREN_RE);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  const atgardMatch = full.match(ATGARD_RE) || full.match(ATGARD_RE2);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  const datumMatch = full.match(DATUM_RE) || full.match(DATUM_RE2);
  const beslutsdatum = datumMatch ? datumMatch[1] : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum };
}

// ── Filtering ────────────────────────────────────────────────────────────────

// Row text (across all columns) that indicates a building permit announcement
const INCLUDE_RE = /lov\s+(MSN|BoM|BN|SBN)|plan-\s*och\s*bygg|bygglov|förhandsbesked|strandskydd|rivningslov|marklov/i;
// Exclude non-permit rows even if they match broadly
const EXCLUDE_RE = /flytt av fordon|protokoll|sammanträde|kallelse/i;

function inferStatus(rowText) {
  if (/inför beslut|ansök/i.test(rowText)) return 'ansökt';
  if (/beviljad/i.test(rowText)) return 'beviljat';
  return 'beviljat';
}

// ── DOM extraction (listing page) ────────────────────────────────────────────

async function extractListingEntries(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    return rows.map(row => {
      const link = row.querySelector('a[href*="/announcements/"]');
      return {
        rowText: row.innerText.trim(),
        title: link ? link.innerText.trim() : '',
        href: link ? link.href : '',
      };
    }).filter(e => e.href);
  });
}

// ── Build permit row ─────────────────────────────────────────────────────────

function buildRow(parsed, status, config) {
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
    status: status || 'beviljat',
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
    console.error('  Loading bulletin board...');

    // Paginate through listing pages
    const relevantLinks = [];
    let pageIndex = 1;
    let hasMore = true;

    while (hasMore) {
      const url = pageIndex === 1
        ? config.boardUrl
        : `${config.boardUrl}?pageIndex=${pageIndex}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, config.waitMs));

      const entries = await extractListingEntries(page);

      if (entries.length === 0) {
        hasMore = false;
      } else {
        for (const e of entries) {
          if (EXCLUDE_RE.test(e.rowText)) continue;
          if (INCLUDE_RE.test(e.rowText)) {
            relevantLinks.push({
              href: e.href,
              title: e.title,
              rowText: e.rowText,
              status: inferStatus(e.rowText),
            });
          }
        }

        const hasNext = await page.evaluate(p => {
          return Array.from(document.querySelectorAll('a')).some(
            a => a.textContent.trim() === String(p + 1)
          );
        }, pageIndex);
        if (!hasNext) hasMore = false;
        else pageIndex++;
      }
    }

    console.error(`  Found ${relevantLinks.length} relevant announcements (${pageIndex} pages)`);

    // Visit each detail page
    const permits = [];
    const skipped = [];

    for (const entry of relevantLinks) {
      try {
        await page.goto(entry.href, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 1000));
        const bodyText = await page.evaluate(() => document.body.innerText);

        const parsed = parseDetailText(entry.title, bodyText);

        if (!parsed.diarienummer) {
          skipped.push(entry.title.slice(0, 60));
          continue;
        }

        const row = buildRow(parsed, entry.status, config);
        permits.push(row);
      } catch (err) {
        console.error(`    x ${entry.title.slice(0, 50)}: ${err.message}`);
      }
    }

    if (skipped.length > 0) {
      console.error(`  Skipped ${skipped.length} items (no diarienummer):`);
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

    console.error(`\n${config.kommun}: ${relevantLinks.length} relevant, ${permits.length} parsed, ${save ? saved + ' saved' : 'dry-run'}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
