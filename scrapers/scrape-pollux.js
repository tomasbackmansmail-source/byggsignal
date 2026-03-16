#!/usr/bin/env node
/**
 * scrape-pollux.js
 *
 * Scraper for the Pollux platform (Blazor Server-Side Rendered).
 * Municipalities host bygglov kungörelser at pollux.<kommun>.se/kungorelse.
 * Requires Puppeteer since all content is rendered via SignalR.
 *
 * Usage:
 *   node scrapers/scrape-pollux.js --config scrapers/configs/pollux/mark.json
 *   node scrapers/scrape-pollux.js --config scrapers/configs/pollux/mark.json --save
 *
 * Config format:
 *   {
 *     "kommun": "Mark",
 *     "lan": "Västra Götalands län",
 *     "polluxUrl": "https://pollux.mark.se/kungorelse",
 *     "sourceUrl": "https://www.mark.se/anslagstavla",
 *     "weeksBack": 4
 *   }
 */

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
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
    } else if (args[i].startsWith('{')) {
      config = JSON.parse(args[i]);
    }
  }

  if (!config) {
    console.error('Usage: node scrapers/scrape-pollux.js [--save] --config <file.json>');
    process.exit(1);
  }
  if (!config.kommun) { console.error('Config missing "kommun"'); process.exit(1); }
  if (!config.polluxUrl) { console.error('Config missing "polluxUrl"'); process.exit(1); }
  if (!config.weeksBack) config.weeksBack = 4;

  return { config, save };
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parse Pollux fastighet string like "KARLSHED 1:1, Karlshed 2, Örby"
 * into { fastighetsbeteckning, adress }
 */
function parseFastighet(raw) {
  if (!raw) return { fastighetsbeteckning: null, adress: null };
  const parts = raw.split(',').map(p => p.trim());
  const fastighetsbeteckning = parts[0] || null;
  const adress = parts.slice(1).filter(Boolean).join(', ') || null;
  return { fastighetsbeteckning, adress };
}

/**
 * Map Pollux "Utfall" text to our status
 */
function mapStatus(utfall, type) {
  if (!utfall && type) {
    if (/grannehörande/i.test(type)) return 'ansökt';
  }
  return parseStatus(utfall, 'beviljat');
}

/**
 * Extract åtgärd from "Ärendemening" text
 * e.g. "Bygglov för nybyggnad av transformatorstation" → "nybyggnad av transformatorstation"
 */
function parseAtgard(mening) {
  if (!mening) return null;
  const m = mening.match(/(?:lov|besked|dispens)\s+(?:om\s+)?för\s+(.+)/i)
         || mening.match(/(?:lov|besked|dispens)\s+för\s+(.+)/i);
  return m ? m[1].trim().toLowerCase() : mening.toLowerCase();
}

// ── Puppeteer extraction ─────────────────────────────────────────────────────

async function extractListItems(page) {
  return page.evaluate(() => {
    const items = [];
    const lis = document.querySelectorAll('ul.pollux-list li');
    for (const li of lis) {
      const time = li.querySelector('time');
      const typeEl = li.querySelector('h3 span:first-child');
      const addrEl = li.querySelector('small[translate="no"]');
      items.push({
        date: time ? time.getAttribute('datetime') : null,
        type: typeEl ? typeEl.textContent.trim() : null,
        address: addrEl ? addrEl.textContent.trim() : null,
      });
    }
    return items;
  });
}

async function extractDetail(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const data = {};
    for (let i = 0; i < lines.length; i++) {
      const key = lines[i];
      const val = lines[i + 1] || '';
      if (key === 'Ärendenummer') data.dnr = val;
      if (key === 'Fastighet') data.fastighet = val;
      if (key === 'Utfall') data.utfall = val;
      if (key === 'Beslutsdatum') data.beslutsdatum = val;
      if (key === 'Ärendemening') data.mening = val;
      if (key === 'Publicerat') data.publicerat = val;
    }
    return data;
  });
}

async function clickBack(page) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent.trim().includes('Tillbaka')) { b.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
}

async function clickPrevWeek(page) {
  await page.evaluate(() => {
    const btn = document.querySelector("button[title='Visa föregående vecka']");
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));
}

// ── Build permit row ─────────────────────────────────────────────────────────

function buildRow(detail, listItem, config) {
  const { fastighetsbeteckning, adress } = parseFastighet(detail.fastighet || listItem.address);
  const status = mapStatus(detail.utfall, listItem.type);
  const atgard = parseAtgard(detail.mening);
  const beslutsdatum = detail.beslutsdatum && /^\d{4}-\d{2}-\d{2}$/.test(detail.beslutsdatum)
    ? detail.beslutsdatum : null;

  const bd = beslutsdatum;
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
    diarienummer: detail.dnr || null,
    fastighetsbeteckning,
    adress,
    atgard,
    kommun: config.kommun,
    lan: config.lan || null,
    country: 'SE',
    sourceUrl: config.sourceUrl || config.polluxUrl,
    status,
    permit_type: parsePermitType(atgard || detail.mening || listItem.type || ''),
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
  console.error(`\n${config.kommun} (${mode}) — ${config.polluxUrl}`);
  console.error('─'.repeat(60));

  const launchOpts = { headless: 'new' };
  if (process.env.CI) {
    launchOpts.args = ['--no-sandbox', '--disable-setuid-sandbox'];
  }
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();

  try {
    await page.goto(config.polluxUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    const allPermits = [];
    const seen = new Set();

    for (let week = 0; week < config.weeksBack; week++) {
      const weekLabel = await page.evaluate(() => {
        const el = document.getElementById('current-week');
        return el ? el.textContent.trim() : '?';
      });

      const listItems = await extractListItems(page);
      const noResults = await page.evaluate(() =>
        document.body.innerText.includes('Inga sökresultat')
      );

      if (noResults || listItems.length === 0) {
        console.error(`  ${weekLabel}: 0 items`);
        await clickPrevWeek(page);
        continue;
      }

      console.error(`  ${weekLabel}: ${listItems.length} items`);

      // Click each item to get details
      for (let i = 0; i < listItems.length; i++) {
        const btns = await page.$$('ul.pollux-list li button');
        if (!btns[i]) continue;

        await btns[i].click();
        await new Promise(r => setTimeout(r, 2000));

        const detail = await extractDetail(page);

        if (detail.dnr && !seen.has(detail.dnr)) {
          seen.add(detail.dnr);
          const row = buildRow(detail, listItems[i], config);
          allPermits.push(row);
        }

        await clickBack(page);
      }

      await clickPrevWeek(page);
    }

    // Output results
    const skipped = allPermits.filter(p => !p.diarienummer);
    const valid = allPermits.filter(p => p.diarienummer);

    if (save) {
      const savePermit = getSavePermit();
      let saved = 0;
      for (const row of valid) {
        try {
          await savePermit(row);
          saved++;
          console.error(`  ok ${row.diarienummer} — ${row.fastighetsbeteckning || '?'}`);
        } catch (err) {
          console.error(`  x  ${row.diarienummer}: ${err.message}`);
        }
      }
      console.error(`\n${config.kommun}: ${valid.length} permits, ${saved} saved`);
    } else {
      for (const row of valid) {
        console.log(`  ${row.diarienummer} | ${row.fastighetsbeteckning || '?'} | ${row.adress || '—'} | ${row.status} | ${row.beslutsdatum || '?'} | ${row.permit_type}`);
      }
      console.error(`\n${config.kommun}: ${valid.length} permits (dry-run)`);
    }

    if (skipped.length > 0) {
      console.error(`  Skipped ${skipped.length} items (no diarienummer)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
