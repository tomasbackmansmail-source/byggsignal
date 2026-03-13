#!/usr/bin/env node
/**
 * scrape-sitevision.js
 *
 * Configurable SiteVision scraper. Takes a JSON config (inline or file)
 * describing a municipality's anslagstavla, then:
 *   1. Fetches listing (HTML links or AppRegistry)
 *   2. Filters for bygglov-related entries
 *   3. Parses each detail page
 *   4. Upserts to Supabase permits table
 *
 * Usage:
 *   # Dry-run (default) — show what would be saved
 *   node scrapers/scrape-sitevision.js '{"kommun":"Borås","url":"https://www.boras.se/anslagstavla","type":"listing","linkSelector":"a[href*=\"kungorelsebygglov\"]"}'
 *
 *   # From config file
 *   node scrapers/scrape-sitevision.js --config scrapers/configs/boras.json
 *
 *   # Actually save to database
 *   node scrapers/scrape-sitevision.js --save '{"kommun":"Borås",...}'
 *
 * Config format:
 *   {
 *     "kommun": "Borås",
 *     "lan": "Västra Götalands län",
 *     "url": "https://www.boras.se/anslagstavla",
 *     "type": "listing",                    // "listing" or "appregistry"
 *     "linkSelector": "a[href*='bygglov']", // for type=listing
 *     "appRegistryType": "announcements",   // for type=appregistry
 *     "skipFilter": false                   // skip keyword filtering on links
 *   }
 */

const path = require('path');
const fs = require('fs');
const { parseSitevisionListing, parseSitevisionAppRegistry, filterBygglovItems } = require('./lib/listing-parsers');
const { parseDetailPage, fetchHtml } = require('./lib/detail-page-parser');
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
      if (!filePath) { console.error('--config kräver en sökväg'); process.exit(1); }
      const resolved = path.resolve(filePath);
      config = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } else if (args[i] === '--dry-run') {
      save = false;
    } else if (args[i].startsWith('{')) {
      config = JSON.parse(args[i]);
    }
  }

  if (!config) {
    console.error('Användning: node scrapers/scrape-sitevision.js [--save] [--config fil.json | \'{"kommun":"..."}\']\n');
    console.error('  --dry-run   Visa vad som skulle sparas (default)');
    console.error('  --save      Spara till Supabase');
    console.error('  --config    Läs config från JSON-fil');
    process.exit(1);
  }

  // Validate required fields
  if (!config.kommun) { console.error('Config saknar "kommun"'); process.exit(1); }
  if (!config.url) { console.error('Config saknar "url"'); process.exit(1); }
  if (!config.type) config.type = 'listing';

  return { config, save };
}

// ── Listing flow ─────────────────────────────────────────────────────────────

async function getDetailUrlsFromListing(config) {
  const options = {};
  if (config.linkSelector) options.linkSelector = config.linkSelector;
  if (config.skipFilter) options.skipFilter = true;

  return parseSitevisionListing(config.url, options);
}

// ── AppRegistry flow ─────────────────────────────────────────────────────────

async function getDetailUrlsFromAppRegistry(config) {
  const html = await fetchHtml(config.url);
  const result = parseSitevisionAppRegistry(html, config.appRegistryType || null);

  if (!result) {
    console.error(`  Ingen AppRegistry-data hittad på ${config.url}`);
    return { urls: [], appItems: [] };
  }

  console.error(`  AppRegistry: nyckel='${result.key}', typ=${result.type}, ${result.items.length} poster totalt`);

  const filtered = filterBygglovItems(result.items);
  console.error(`  Filtrerat: ${filtered.length} bygglov-relaterade poster`);

  // Build absolute URLs for items that have a url/uri field
  const parsed = new URL(config.url);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;

  const urls = filtered
    .map(item => {
      if (!item.url) return null;
      return item.url.startsWith('/') ? baseUrl + item.url : item.url;
    })
    .filter(Boolean);

  return { urls, appItems: filtered };
}

// ── Build permit row ─────────────────────────────────────────────────────────

function buildPermitRow(parsed, config) {
  const bd = parsed.beslutsdatum || null;
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
    adress: parsed.adress || null,
    atgard: parsed.atgard || null,
    kommun: config.kommun,
    lan: config.lan || null,
    country: config.country || 'SE',
    source_url: parsed.sourceUrl || null,
    status: parsed.status || 'beviljat',
    permit_type: parsePermitType(parsed.atgard || parsed.title || ''),
    beslutsdatum: validBd,
    scraped_at: scrapedAt,
  };
}

// ── Database ─────────────────────────────────────────────────────────────────

let _savePermit = null;
function getSavePermit() {
  if (!_savePermit) {
    // Only require db.js when actually saving — avoids needing .env for dry-run
    const { savePermit } = require('../db');
    _savePermit = savePermit;
  }
  return _savePermit;
}

async function upsertPermit(row) {
  const save = getSavePermit();
  // savePermit expects a slightly different shape — adapt
  await save({
    diarienummer: row.diarienummer,
    fastighetsbeteckning: row.fastighetsbeteckning,
    adress: row.adress,
    atgard: row.atgard,
    kommun: row.kommun,
    lan: row.lan,
    country: row.country,
    sourceUrl: row.source_url,
    status: row.status,
    permit_type: row.permit_type,
    beslutsdatum: row.beslutsdatum,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { config, save } = parseArgs();

  const mode = save ? 'SPARA' : 'DRY-RUN';
  console.error(`\n${config.kommun} (${mode}) — ${config.url}`);
  console.error(`${'─'.repeat(60)}`);

  // Step 1: Get detail page URLs
  let detailUrls = [];
  let appItems = [];

  if (config.type === 'appregistry') {
    const result = await getDetailUrlsFromAppRegistry(config);
    detailUrls = result.urls;
    appItems = result.appItems;
  } else {
    detailUrls = await getDetailUrlsFromListing(config);
  }

  console.error(`  Listning: ${detailUrls.length} ärenden hittade`);

  if (detailUrls.length === 0 && appItems.length === 0) {
    console.error('  Inga ärenden att bearbeta.');
    return;
  }

  // Step 2: Parse each detail page
  const permits = [];
  const errors = [];

  for (const url of detailUrls) {
    try {
      const parsed = await parseDetailPage(url);
      if (!parsed.diarienummer) {
        errors.push({ url, reason: 'saknar diarienummer' });
        continue;
      }
      permits.push(buildPermitRow(parsed, config));
    } catch (err) {
      errors.push({ url, reason: err.message });
    }
  }

  // Step 3: Save or dry-run
  let saved = 0;
  let updated = 0;

  if (save) {
    for (const row of permits) {
      try {
        await upsertPermit(row);
        saved++;
        console.error(`  ✓ ${row.diarienummer} — ${row.fastighetsbeteckning || '?'}${row.adress ? ' (' + row.adress + ')' : ''}`);
      } catch (err) {
        if (/duplicate|conflict/i.test(err.message)) {
          updated++;
          console.error(`  ↻ ${row.diarienummer} (uppdaterad)`);
        } else {
          console.error(`  ✗ ${row.diarienummer}: ${err.message}`);
        }
      }
    }
  } else {
    // Dry-run: print what would be saved
    console.error('');
    for (const row of permits) {
      console.log(`  ${row.diarienummer} | ${row.fastighetsbeteckning || '?'} | ${row.adress || '—'} | ${row.status || '?'} | ${row.beslutsdatum || '?'} | ${row.permit_type}`);
    }
    console.error('');
  }

  // Step 4: Summary
  if (errors.length > 0) {
    console.error(`  Fel (${errors.length}):`);
    for (const e of errors) {
      const short = e.url.split('/').pop().slice(0, 60);
      console.error(`    ✗ ${short}: ${e.reason}`);
    }
  }

  if (save) {
    console.error(`\n${config.kommun}: ${detailUrls.length} ärenden, ${saved} nya, ${updated} uppdaterade`);
  } else {
    console.error(`${config.kommun}: ${detailUrls.length} ärenden, ${permits.length} lyckades parsas (dry-run)`);
  }
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
