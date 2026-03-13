#!/usr/bin/env node
/**
 * scrape-wordpress.js
 *
 * Generic WordPress scraper for Swedish municipality anslagstavlor.
 * Supports two strategies:
 *   1. WP REST API — fetches posts from a custom post type (e.g. "bygglov", "anslag")
 *   2. HTML fallback — scrapes the anslagstavla page directly with Cheerio
 *
 * Usage:
 *   node scrapers/scrape-wordpress.js --config scrapers/configs/wordpress/trelleborg.json
 *   node scrapers/scrape-wordpress.js --save --config scrapers/configs/wordpress/eslov.json
 *   node scrapers/scrape-wordpress.js --dry-run '{"kommun":"Trelleborg",...}'
 *
 * Config format:
 *   {
 *     "kommun": "Trelleborg",
 *     "lan": "Skåne län",
 *     "baseUrl": "https://www.trelleborg.se",
 *     "strategy": "rest-api",              // "rest-api" or "html"
 *     "restBase": "bygglov",               // WP REST API route (strategy=rest-api)
 *     "anslagstavlaUrl": "https://...",     // page URL (strategy=html, or for source_url)
 *     "filterBygglov": true                 // filter out non-bygglov posts (for "anslag" CPT)
 *   }
 */

const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
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
    console.error('Användning: node scrapers/scrape-wordpress.js [--save] [--config fil.json | \'{"kommun":"..."}\']\n');
    console.error('  --dry-run   Visa vad som skulle sparas (default)');
    console.error('  --save      Spara till Supabase');
    console.error('  --config    Läs config från JSON-fil');
    process.exit(1);
  }

  if (!config.kommun) { console.error('Config saknar "kommun"'); process.exit(1); }
  if (!config.baseUrl && !config.anslagstavlaUrl) {
    console.error('Config saknar "baseUrl" eller "anslagstavlaUrl"');
    process.exit(1);
  }
  if (!config.strategy) config.strategy = 'rest-api';

  return { config, save };
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ByggSignal/1.0 (+https://byggsignal.se)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
  const total = parseInt(res.headers.get('x-wp-total') || '0', 10);
  const data = await res.json();
  return { data, totalPages, total };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ByggSignal/1.0 (+https://byggsignal.se)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ── Strategy 1: WP REST API ─────────────────────────────────────────────────

const BYGGLOV_KEYWORDS = /bygglov|rivningslov|marklov|förhandsbesked|strandskydd|anmälan|bygga|riva|rivning|tillbygg|nybygg|fasad|inglasning|plank|mur|carport|garage|altan|balkong|komplementbyggnad|attefall|solcell/i;

async function scrapeViaRestApi(config) {
  const base = config.baseUrl.replace(/\/$/, '');
  const restBase = config.restBase || 'bygglov';
  const perPage = 100;
  let page = 1;
  let allPosts = [];

  // Paginate through all posts
  while (true) {
    const url = `${base}/wp-json/wp/v2/${restBase}?per_page=${perPage}&page=${page}`;
    try {
      const { data, totalPages } = await fetchJson(url);
      if (!Array.isArray(data) || data.length === 0) break;
      allPosts = allPosts.concat(data);
      if (page >= totalPages) break;
      page++;
    } catch (err) {
      if (page === 1) throw err;
      break; // Last page exceeded
    }
  }

  console.error(`  REST API /${restBase}: ${allPosts.length} poster hämtade`);

  // Filter for bygglov-related posts if needed
  if (config.filterBygglov) {
    allPosts = allPosts.filter(post => {
      const title = stripHtml(post.title?.rendered || '');
      const content = stripHtml(post.content?.rendered || '');
      const text = title + ' ' + content;
      return BYGGLOV_KEYWORDS.test(text);
    });
    console.error(`  Filtrerat: ${allPosts.length} bygglov-relaterade`);
  }

  // Parse each post into permit data
  const permits = [];
  const errors = [];

  for (const post of allPosts) {
    try {
      const parsed = parseRestApiPost(post, config);
      if (!parsed.diarienummer) {
        errors.push({ id: post.id, reason: 'saknar diarienummer' });
        continue;
      }
      permits.push(parsed);
    } catch (err) {
      errors.push({ id: post.id, reason: err.message });
    }
  }

  return { permits, errors };
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseRestApiPost(post, config) {
  const title = stripHtml(post.title?.rendered || '');
  const contentHtml = post.content?.rendered || '';
  const contentText = stripHtml(contentHtml);
  const fullText = title + ' ' + contentText;
  const link = post.link || '';

  // Extract diarienummer
  const diarieMatch = fullText.match(/(?:diarienr|diarienummer|dnr)[:\s]*([A-ZÅÄÖa-zåäö]{2,}[\s-]*\d{4}[\s-]*\d+)/i)
    || fullText.match(/(BYG[G]?[\s-]*\d{4}[\s-]*\d+)/i)
    || fullText.match(/(SBN[\s-]*\d{4}[\s-]*\d+)/i)
    || fullText.match(/(MBN[\s-]*\d{4}[\s-]*\d+)/i)
    || fullText.match(/(LOV[\s-]*\d{4}[\s-]*\d+)/i)
    || fullText.match(/(BMN[\s-]*\d{4}[\s-]*\d+)/i);
  const diarienummer = diarieMatch ? diarieMatch[1].replace(/\s+/g, ' ').trim() : null;

  // Extract fastighetsbeteckning from title or content
  // Pattern: CAPS WORD(S) followed by numbers like "STORA BEDDINGE 7:3"
  const fastMatch = title.match(/(?:fastigheten|fastighet)\s+([A-ZÅÄÖ][A-ZÅÄÖ\s]+\d+:\d+)/i)
    || fullText.match(/(?:fastighetsbeteckning|fastighet)[:\s]*([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s]+\d+:\d+)/i)
    || title.match(/([A-ZÅÄÖ][A-ZÅÄÖ\s]+\d+:\d+)/);
  const fastighetsbeteckning = fastMatch ? fastMatch[1].trim() : null;

  // Extract beslutsdatum
  const datumMatch = fullText.match(/(?:beslutsdatum|beslutat|beslut)[:\s]*(\d{4}-\d{2}-\d{2})/i)
    || fullText.match(/(?:beviljas|beviljat|avslås)[,\s]*(\d{4}-\d{2}-\d{2})/i);
  let beslutsdatum = datumMatch ? datumMatch[1] : null;

  // Fallback: use post date if no explicit beslutsdatum
  if (!beslutsdatum && post.date) {
    beslutsdatum = post.date.slice(0, 10);
  }

  // Extract åtgärd — the "Beslutet avser" line or similar
  const atgardMatch = fullText.match(/(?:beslutet avser|åtgärd)[:\s]*(.+?)(?:\n|diarienr|beslutsdatum|$)/i)
    || fullText.match(/(?:bygglov|rivningslov|marklov|förhandsbesked)\s+(?:för\s+)?(.+?)(?:\n|diarienr|$)/i);
  const atgard = atgardMatch
    ? atgardMatch[0].replace(/diarienr.*/i, '').replace(/beslutsdatum.*/i, '').trim().slice(0, 200)
    : title.slice(0, 200);

  // Parse status
  const status = parseStatus(fullText, 'beviljat');

  // Validate beslutsdatum
  const bdYear = beslutsdatum ? parseInt(beslutsdatum.slice(0, 4), 10) : null;
  const currentYear = new Date().getFullYear();
  const validBd = beslutsdatum && bdYear >= 2020 && bdYear <= currentYear ? beslutsdatum : null;
  const now = new Date().toISOString();

  return {
    diarienummer,
    fastighetsbeteckning,
    adress: null,
    atgard,
    kommun: config.kommun,
    lan: config.lan || null,
    country: 'SE',
    source_url: link || config.anslagstavlaUrl || null,
    status,
    permit_type: parsePermitType(atgard || title),
    beslutsdatum: validBd,
    scraped_at: validBd ? new Date(validBd).toISOString() : now,
  };
}

// ── Strategy 2: HTML scraping ────────────────────────────────────────────────

async function scrapeViaHtml(config) {
  const url = config.anslagstavlaUrl;
  if (!url) throw new Error('Config saknar "anslagstavlaUrl" för HTML-strategi');

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const permits = [];
  const errors = [];

  // Strategy: find all text blocks that look like building permit announcements.
  // WordPress anslagstavla pages use various structures: accordion blocks,
  // wp-block-group, plain <p> sections, <details> elements, or <div> groups.

  // Collect all text sections that mention bygglov keywords
  const sections = [];

  // Try accordion/details elements first
  $('details, .wp-block-coblocks-accordion__content, .accordion-content, [class*="accordion"]').each((_, el) => {
    sections.push($(el).text());
  });

  // Try wp-block-group sections
  if (sections.length === 0) {
    $('.wp-block-group, .entry-content > div, article').each((_, el) => {
      const text = $(el).text();
      if (BYGGLOV_KEYWORDS.test(text) && text.length > 50 && text.length < 5000) {
        sections.push(text);
      }
    });
  }

  // Fallback: split by headings (h2, h3, h4)
  if (sections.length === 0) {
    const content = $('.entry-content, .main-content, main, article, .post-content').first();
    if (content.length) {
      let currentSection = '';
      content.children().each((_, el) => {
        const tag = $(el).prop('tagName')?.toLowerCase();
        if (['h2', 'h3', 'h4'].includes(tag)) {
          if (currentSection && BYGGLOV_KEYWORDS.test(currentSection)) {
            sections.push(currentSection);
          }
          currentSection = $(el).text() + '\n';
        } else {
          currentSection += $(el).text() + '\n';
        }
      });
      if (currentSection && BYGGLOV_KEYWORDS.test(currentSection)) {
        sections.push(currentSection);
      }
    }
  }

  // Last resort: get all text and split by diarienummer pattern
  if (sections.length === 0) {
    const allText = $('body').text();
    const parts = allText.split(/(?=(?:diarienr|diarienummer|dnr)[:\s])/i);
    for (const part of parts) {
      if (BYGGLOV_KEYWORDS.test(part) && part.length > 30) {
        sections.push(part);
      }
    }
  }

  console.error(`  HTML: ${sections.length} sektioner hittade`);

  for (const sectionText of sections) {
    try {
      const parsed = parseHtmlSection(sectionText, config);
      if (!parsed.diarienummer) continue;
      // Deduplicate
      if (!permits.some(p => p.diarienummer === parsed.diarienummer)) {
        permits.push(parsed);
      }
    } catch (err) {
      errors.push({ section: sectionText.slice(0, 60), reason: err.message });
    }
  }

  return { permits, errors };
}

function parseHtmlSection(text, config) {
  // Reuse the same parsing logic as REST API
  const fakePost = {
    title: { rendered: text.split('\n')[0] || '' },
    content: { rendered: text },
    link: config.anslagstavlaUrl,
    date: new Date().toISOString(),
  };
  return parseRestApiPost(fakePost, config);
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

async function upsertPermit(row) {
  const save = getSavePermit();
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
  console.error(`\n${config.kommun} (${mode}) — ${config.baseUrl || config.anslagstavlaUrl}`);
  console.error(`${'─'.repeat(60)}`);

  let permits, errors;

  if (config.strategy === 'rest-api') {
    ({ permits, errors } = await scrapeViaRestApi(config));
  } else if (config.strategy === 'html') {
    ({ permits, errors } = await scrapeViaHtml(config));
  } else {
    console.error(`Okänd strategi: ${config.strategy}`);
    process.exit(1);
  }

  console.error(`  Parsade: ${permits.length} ärenden`);

  if (permits.length === 0) {
    console.error('  Inga ärenden att bearbeta.');
    return;
  }

  // Save or dry-run
  let saved = 0;

  if (save) {
    for (const row of permits) {
      try {
        await upsertPermit(row);
        saved++;
        console.error(`  ✓ ${row.diarienummer} — ${row.fastighetsbeteckning || '?'}${row.adress ? ' (' + row.adress + ')' : ''}`);
      } catch (err) {
        if (/duplicate|conflict/i.test(err.message)) {
          console.error(`  ↻ ${row.diarienummer} (uppdaterad)`);
        } else {
          console.error(`  ✗ ${row.diarienummer}: ${err.message}`);
        }
      }
    }
  } else {
    console.error('');
    for (const row of permits) {
      console.log(`  ${row.diarienummer} | ${row.fastighetsbeteckning || '?'} | ${row.adress || '—'} | ${row.status || '?'} | ${row.beslutsdatum || '?'} | ${row.permit_type}`);
    }
    console.error('');
  }

  if (errors.length > 0) {
    console.error(`  Fel (${errors.length}):`);
    for (const e of errors) {
      console.error(`    ✗ ${e.id || e.section || '?'}: ${e.reason}`);
    }
  }

  if (save) {
    console.error(`\n${config.kommun}: ${permits.length} ärenden, ${saved} sparade`);
  } else {
    console.error(`${config.kommun}: ${permits.length} ärenden (dry-run)`);
  }
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
