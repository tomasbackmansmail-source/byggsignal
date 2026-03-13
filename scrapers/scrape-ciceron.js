#!/usr/bin/env node
/**
 * scrape-ciceron.js
 *
 * Generic Ciceron anslagstavla scraper. Ciceron (Twoday) is an Angular SPA
 * used by several Swedish municipalities for their digital bulletin boards.
 * We call the JSON-RPC API directly (no Puppeteer needed).
 *
 * Usage:
 *   node scrapers/scrape-ciceron.js --config scrapers/configs/ciceron/kungsbacka.json
 *   node scrapers/scrape-ciceron.js --config scrapers/configs/ciceron/kungsbacka.json --save
 *
 * Config format:
 *   {
 *     "kommun": "Kungsbacka",
 *     "lan": "Hallands län",
 *     "baseUrl": "https://ciceronanslagstavla.kungsbacka.se",
 *     "sourceUrl": "https://ciceronanslagstavla.kungsbacka.se/"
 *   }
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { parsePermitType, parseStatus } = require('../scripts/parse-helpers');

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
    }
  }

  if (!config) {
    console.error('Usage: node scrapers/scrape-ciceron.js [--save] --config <file.json>');
    process.exit(1);
  }
  if (!config.kommun) { console.error('Config missing "kommun"'); process.exit(1); }
  if (!config.baseUrl) { console.error('Config missing "baseUrl"'); process.exit(1); }

  return { config, save };
}

// ── JSON-RPC client ──────────────────────────────────────────────────────────

function jsonRpc(baseUrl, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const url = new URL('/json', baseUrl);
    const body = { jsonrpc: '2.0', method, params };
    if (sessionId) body.session_id = sessionId;
    const data = JSON.stringify(body);

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'application/json',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          resolve(parsed);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(data);
    req.end();
  });
}

// ── Fetch items from Ciceron API ─────────────────────────────────────────────

async function fetchCiceronItems(baseUrl) {
  // Step 1: Init session
  const test = await jsonRpc(baseUrl, 'CiceronsokServer:Test', {});
  const sid = test.session_id;
  if (!sid) throw new Error('No session_id from CiceronsokServer:Test');

  // Step 2: Search for "Handlingar" (doctype 4) — this is where bygglov items live
  // The server requires specific search_id names matching the Angular app's billboard IDs
  const searchId = 'billboard_21';
  const search = await jsonRpc(baseUrl, 'CiceronsokServer:Search', {
    search_id: searchId,
    doctype: 4,
    text: '',
    param: JSON.stringify({ has_files: false, diary: '', is_post: true, is_council: false }),
  }, sid);

  const hitsRaw = search.result?.result;
  const hits = hitsRaw ? JSON.parse(hitsRaw).hits : 0;

  if (hits === 0) return [];

  // Step 3: Read all items (paginate if needed)
  const allItems = [];
  const pageSize = 50;
  for (let offset = 0; offset < hits; offset += pageSize) {
    const read = await jsonRpc(baseUrl, 'CiceronsokServer:ReadItems', {
      search_id: searchId,
      offset,
      limit: pageSize,
    }, sid);

    if (read.result?.results) {
      allItems.push(...read.result.results);
    }
  }

  return allItems;
}

// ── Text parsing helpers ─────────────────────────────────────────────────────

// Diarienummer patterns: "Diarienr: BN 2025-002614" or "BN 2025/123" etc.
const DIARIE_TITLE_RE = /Diarienr[:\s]+([A-ZÅÄÖa-zåäö]+\s+\d{4}[-/]\d+)/i;
const DIARIE_FIELD_RE = /\b(BN|SBN|MBN|BMN|BNS|SPN|BYGG|LOV|MSN)\s*(\d{4}[-/]\d+)/i;

// Fastighetsbeteckning: "VARLA 2:9" or "Malevik 1:145" etc.
// Match word(s) followed by number:number — also handles "Fastighet RIPAN 10" prefix
// Excludes known non-fastighet words via negative lookbehind-like prefix skip
const FASTIGHET_RE = /(?:Fastighet\s+|Kungörelse\s+|Beslut\s+)?(?!Kungörelse|Beslut|Diarienr|Publicering|Grannehörande|Grannhörande|Beslutet|SAMRÅD|GRANSKNING)([A-ZÅÄÖ][A-ZÅÄÖa-zåäö]+(?:[- ][A-ZÅÄÖa-zåäö]+)*\s+\d+:\d+)/m;
// Alternate: just uppercase word + plain number (e.g. "GJUTAREN 6", "RIPAN 10")
const FASTIGHET_SHORT_RE = /(?:Fastighet\s+|Kungörelse\s+)?(?!Kungörelse|Beslut|Diarienr|Publicering)([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\-]{2,20}\s+\d{1,4})(?=[,\s\-]|$)/m;

// Åtgärd: "Bygglov för nybyggnad av enbostadshus"
const ATGARD_RE = /(?:Bygglov|Rivningslov|Marklov|Förhandsbesked|Tidsbegränsat bygglov)\s+för\s+([^\n]{3,100})/i;
// Alternate: "Ansökan om förhandsbesked för nybyggnad av skidstuga"
const ATGARD_RE2 = /Ansökan om\s+\w+\s+för\s+([^\n]{3,100})/i;

// Decision date: "Beviljas: 2026-03-12" or "beviljats 2026-03-05" or "beviljas 2026-03-05"
const BESLUT_DATUM_RE = /(?:Beviljas|beviljats|beviljas|Beslut)[,:;\s]+(\d{4}-\d{2}-\d{2})/i;
// "har beviljats 2026-03-05 för" (Robertsfors pattern)
const BEVILJATS_DATUM_RE = /har beviljats\s+(\d{4}-\d{2}-\d{2})/i;
// Publishing date as fallback
const PUB_DATUM_RE = /Publiceringsdatum[:\s]+(\d{4}-\d{2}-\d{2})/i;

// Permit relevance filter
const PERMIT_RE = /bygglov|rivningslov|marklov|förhandsbesked|strandskyddsdispens|grannehörande|grannhörande/i;

function parseCiceronItem(item) {
  const title = (item.title || '').replace(/\r/g, '');
  const diaryName = item.diary_name || '';

  // Skip protocols and other non-permit items early
  if (/^(Protokoll|Anslag av protokoll|Överförmyndar|Meddelande om antagande|Öppettider)/i.test(title)) return null;
  // Skip detaljplan items (they're not individual permits)
  if (/detaljplan|SAMRÅD|GRANSKNING|antagande/i.test(title) && !/bygglov|rivningslov|marklov|förhandsbesked/i.test(title)) return null;
  // Skip items that don't look like permits
  // Accept: explicit permit keywords, BN diary, or "Kungörelse" + fastighetsbeteckning pattern
  const hasPermitKeyword = PERMIT_RE.test(title);
  const hasBNDiary = /^(BN|MBN|SBN|BMN|MSN)$/i.test(diaryName);
  const isKungorelseFastighet = /^Kungörelse\s+[A-ZÅÄÖ]/i.test(title) && (FASTIGHET_RE.test(title) || FASTIGHET_SHORT_RE.test(title));
  const isFastighetPermit = /^Fastighet\s+/i.test(title) && /bygglov|lov|förhandsbesked/i.test(title);
  if (!hasPermitKeyword && !hasBNDiary && !isKungorelseFastighet && !isFastighetPermit) return null;

  // Extract diarienummer
  const diarieMatch = title.match(DIARIE_TITLE_RE) || title.match(DIARIE_FIELD_RE);
  let diarienummer = null;
  if (diarieMatch) {
    diarienummer = diarieMatch[1]
      ? diarieMatch[1].replace(/\s+/g, ' ').trim()
      : (diarieMatch[1] + ' ' + diarieMatch[2]).trim();
  } else if (item.diarie && diaryName) {
    // Use diarie field from API if available
    diarienummer = diaryName + ' ' + item.diarie;
  }

  // Extract fastighetsbeteckning
  const fastMatch = title.match(FASTIGHET_RE) || title.match(FASTIGHET_SHORT_RE);
  const fastighetsbeteckning = fastMatch ? fastMatch[1].trim() : null;

  // Extract åtgärd
  const atgardMatch = title.match(ATGARD_RE) || title.match(ATGARD_RE2);
  let atgard = atgardMatch ? atgardMatch[1].trim() : null;
  // Clean up trailing boilerplate
  if (atgard) {
    atgard = atgard
      .replace(/\s*\n.*/s, '')
      .replace(/\s*Diarienr.*/i, '')
      .replace(/\s*Beslutet finns.*/i, '')
      .trim()
      .toLowerCase();
  }

  // Extract beslutsdatum
  const datumMatch = title.match(BESLUT_DATUM_RE) || title.match(BEVILJATS_DATUM_RE) || title.match(PUB_DATUM_RE);
  const beslutsdatum = datumMatch ? datumMatch[1] : null;

  // Determine status
  let status = null;
  if (/Grannehörande|Grannhörande/i.test(title)) {
    status = 'ansökt';
  } else if (/Beviljas|beviljats|beviljas/i.test(title)) {
    status = 'beviljat';
  } else if (/Avslag/i.test(title)) {
    status = 'avslag';
  } else {
    status = parseStatus(title, 'beviljat');
  }

  // Must have at least diarienummer or fastighetsbeteckning to be useful
  if (!diarienummer && !fastighetsbeteckning) return null;

  return { diarienummer, fastighetsbeteckning, atgard, beslutsdatum, status, rawTitle: title };
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

  // Build a key: prefer diarienummer, fallback to kommun+fastighet
  const key = parsed.diarienummer
    || (parsed.fastighetsbeteckning
      ? `${config.kommun.toUpperCase().replace(/\s/g, '-')}-${parsed.fastighetsbeteckning.replace(/\s+/g, '-')}`
      : null);

  if (!key) return null;

  return {
    diarienummer: key,
    fastighetsbeteckning: parsed.fastighetsbeteckning,
    adress: null,
    atgard: parsed.atgard,
    kommun: config.kommun,
    lan: config.lan || null,
    country: 'SE',
    sourceUrl: config.sourceUrl || config.baseUrl,
    status: parsed.status || 'beviljat',
    permit_type: parsePermitType(parsed.atgard || parsed.rawTitle || ''),
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
  console.error(`\n${config.kommun} (${mode}) — ${config.baseUrl}`);
  console.error('─'.repeat(60));

  const items = await fetchCiceronItems(config.baseUrl);
  console.error(`  Found ${items.length} Ciceron items (doctype 4)`);

  const permits = [];
  const skipped = [];

  for (const item of items) {
    const parsed = parseCiceronItem(item);
    if (!parsed) {
      skipped.push((item.title || '').slice(0, 60));
      continue;
    }

    const row = buildRow(parsed, config);
    if (!row) {
      skipped.push((item.title || '').slice(0, 60));
      continue;
    }

    permits.push(row);
  }

  console.error(`  Filtered to ${permits.length} permits (skipped ${skipped.length})`);
  if (skipped.length > 0) {
    console.error(`  Skipped items:`);
    skipped.forEach(s => console.error(`    - ${s}`));
  }

  let saved = 0;
  if (save) {
    const savePermit = getSavePermit();
    for (const row of permits) {
      try {
        await savePermit(row);
        saved++;
        console.error(`  ok ${row.diarienummer} — ${row.fastighetsbeteckning || '?'}`);
      } catch (err) {
        console.error(`  x  ${row.diarienummer}: ${err.message}`);
      }
    }
  } else {
    for (const row of permits) {
      console.log(`  ${row.diarienummer} | ${row.fastighetsbeteckning || '?'} | ${row.atgard || '—'} | ${row.beslutsdatum || '?'} | ${row.status} | ${row.permit_type}`);
    }
  }

  console.error(`\n${config.kommun}: ${items.length} total, ${permits.length} permits, ${save ? saved + ' saved' : 'dry-run'}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
