#!/usr/bin/env node
/**
 * scrape-limepark.js
 *
 * Scraper for Limepark SiteVision webapps. Handles two widget types:
 *
 *   1. notice-board  — accordion list (limepark-notice-board__item)
 *      Used by: Arvidsjaur, Vingåker, Vännäs, Kristianstad
 *
 *   2. app-evolution — document link lists (limepark-app-evolution)
 *      Used by: Ystad (PDF links with fastighet + åtgärd in title)
 *
 * Both require Puppeteer since content is JS-rendered via SiteVision AppRegistry.
 *
 * Usage:
 *   node scrapers/scrape-limepark.js --config scrapers/configs/limepark/arvidsjaur.json
 *   node scrapers/scrape-limepark.js --config scrapers/configs/limepark/arvidsjaur.json --save
 *
 * Config format:
 *   {
 *     "kommun": "Arvidsjaur",
 *     "lan": "Norrbottens län",
 *     "url": "https://www.arvidsjaur.se/kommunpolitik/anslagstavla",
 *     "sourceUrl": "https://www.arvidsjaur.se/kommunpolitik/anslagstavla",
 *     "type": "notice-board"       // or "app-evolution"
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
    console.error('Usage: node scrapers/scrape-limepark.js [--save] --config <file.json>');
    process.exit(1);
  }
  if (!config.kommun) { console.error('Config missing "kommun"'); process.exit(1); }
  if (!config.url) { console.error('Config missing "url"'); process.exit(1); }
  if (!config.type) config.type = 'notice-board';

  return { config, save };
}

// ── Text parsing helpers ─────────────────────────────────────────────────────

const BYGGLOV_RE = /bygglov|marklov|rivning|förhandsbesked|strandskydd|grannehörande|grannhörande|\bBN\b|\bBYGG\b|\bBMN\b/i;

const DNR_RE = /((?:VGS-BYGG|MBN-B|BN|SBN|BMN|MBN|BYGG|BoM|SBF|MHN|SBFV|GRMB|BY|BM|MBE|B|D)\s*[-./]?\s*\d{4}[-.\s/:]*\d+)/i;

function inferStatus(text) {
  if (/beviljats|beviljat|beviljas|beviljar|bifall/i.test(text)) return 'beviljat';
  if (/avslag|avslås/i.test(text)) return 'avslag';
  if (/startbesked/i.test(text)) return 'startbesked';
  if (/grannehörande|grannhörande|grannar|yttra|synpunkter/i.test(text)) return 'ansökt';
  if (/ansökan\s+om/i.test(text)) return 'ansökt';
  return 'beviljat';
}

function extractAtgard(text) {
  const m = text.match(/(?:bygglov|rivningslov|marklov|förhandsbesked|lov)\s+för\s+(.+?)(?:\s+(?:på|har|,\s*[A-ZÅÄÖ])|\s*$)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

/**
 * Parse a notice-board item's name + description into permit fields.
 */
function parseNoticeItem(name, topic, desc) {
  const full = (name + '\n' + topic + '\n' + desc).replace(/\r/g, '');

  // Diarienummer: labeled patterns
  let diarienummer = null;
  const dnrLabeled = full.match(/(?:diarienummer|diarienr|diarenummer|ärende)\s*(?:är)?[:\s]+([A-Za-zÅÄÖåäö.]*\s*\d{4}[-.\s/:]*\d+)/i);
  if (dnrLabeled) {
    diarienummer = dnrLabeled[1].replace(/\s+/g, ' ').trim();
  }
  if (!diarienummer) {
    const dnrFallback = full.match(DNR_RE);
    if (dnrFallback) diarienummer = dnrFallback[1].replace(/\s+/g, ' ').trim();
  }

  // Fastighetsbeteckning: labeled or from name
  let fastighetsbeteckning = null;
  const fastLabeled = full.match(/fastighet(?:en)?[:\s]+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s-]+\d+:\d+)/i);
  if (fastLabeled) {
    fastighetsbeteckning = fastLabeled[1].trim();
  }
  if (!fastighetsbeteckning) {
    // From name: "Bygglov, Idträsk 1:2" or "Grannehörande, Arvidsjaur 6:1"
    const nameMatch = name.match(/,\s*([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s-]+\d+:\d+)/);
    if (nameMatch) fastighetsbeteckning = nameMatch[1].trim();
  }
  if (!fastighetsbeteckning) {
    // Unlabeled: "ARVIDSJAUR 6:1" in all caps
    const capsMatch = full.match(/([A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d+:\d+)/);
    if (capsMatch) fastighetsbeteckning = capsMatch[1].trim();
  }
  if (!fastighetsbeteckning) {
    // Without colon: "fastigheten PROFESSORN 5"
    const simpleMatch = full.match(/fastigheten\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s-]+\d+)/i);
    if (simpleMatch) fastighetsbeteckning = simpleMatch[1].trim();
  }

  // Adress from description: "Lyttersta gård" or "Marengången 9" after fastighet
  let adress = null;
  if (fastighetsbeteckning) {
    const afterFast = full.split(fastighetsbeteckning)[1] || '';
    const addrMatch = afterFast.match(/^,?\s+([A-ZÅÄÖa-zåäö][a-zåäö]+(?:\s+[a-zåäö]+)*\s+\d+)/);
    if (addrMatch && !/diarienummer|diarienr|ärende|beslut|instans/i.test(addrMatch[1])) {
      adress = addrMatch[1].trim();
    }
  }

  // Åtgärd
  const atgard = extractAtgard(full);

  // Beslutsdatum
  let beslutsdatum = null;
  const datumLabeled = full.match(/(?:beslutsdatum|besluts?datum)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  if (datumLabeled) {
    beslutsdatum = datumLabeled[1];
  }
  if (!beslutsdatum) {
    const datumInline = full.match(/(?:beviljat?s?|bifall)[,:\s]+(\d{4}-\d{2}-\d{2})/i);
    if (datumInline) beslutsdatum = datumInline[1];
  }

  // Status
  const status = inferStatus(full);

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum, status };
}

/**
 * Parse a Ystad app-evolution link title into permit fields.
 * Title format: "Baldringetorp 1:1 - Bygglov för nybyggnad av transformatorstation"
 */
function parseAppEvoLink(title, sectionType) {
  // Split on first " - " to get fastighet and description
  const parts = title.split(/\s+-\s+/);
  const fastighetPart = parts[0] || '';
  const descPart = parts.slice(1).join(' - ') || '';

  // Fastighetsbeteckning from first part
  let fastighetsbeteckning = null;
  const fastMatch = fastighetPart.match(/([A-ZÅÄÖa-zåäö][\wåäöÅÄÖ\s-]+\d+[:\s]\d+)/);
  if (fastMatch) {
    fastighetsbeteckning = fastMatch[1].trim();
  } else if (/^[A-ZÅÄÖ]/.test(fastighetPart) && fastighetPart.length < 60) {
    fastighetsbeteckning = fastighetPart.trim();
  }

  // Åtgärd from description
  const atgard = extractAtgard(descPart) || descPart.toLowerCase().trim() || null;

  // Status from section type
  const status = sectionType === 'synpunkter' ? 'ansökt' : 'beviljat';

  return {
    diarienummer: null,
    fastighetsbeteckning,
    adress: null,
    atgard,
    beslutsdatum: null,
    status,
  };
}

// ── DOM extraction ───────────────────────────────────────────────────────────

async function extractNoticeBoard(page) {
  return page.evaluate((reStr) => {
    const re = new RegExp(reStr, 'i');
    const results = [];
    document.querySelectorAll('li.limepark-notice-board__item').forEach(li => {
      const name = li.querySelector('.limepark-notice-board__item__name')?.textContent?.trim() || '';
      const topic = li.querySelector('.limepark-notice-board__item__topic')?.textContent?.trim() || '';

      if (!re.test(name) && !re.test(topic)) return;

      const content = li.querySelector('.limepark-notice-board__item__content');
      const descEl = content?.querySelector('.limepark-notice-board__item__description');
      const desc = descEl ? descEl.textContent.trim() : '';

      results.push({ name, topic, desc });
    });
    return results;
  }, BYGGLOV_RE.source);
}

async function extractBulletinBoard(page) {
  return page.evaluate((reStr) => {
    const re = new RegExp(reStr, 'i');
    const results = [];
    document.querySelectorAll('li.lp-bulletin-board__list-item').forEach(li => {
      const heading = li.querySelector('.lp-bulletin-board__list-item__heading')?.textContent?.trim() || '';
      const descHtml = li.querySelector('.lp-bulletin-board__list-item__description')?.innerHTML || '';
      const descText = descHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const full = heading + ' ' + descText;
      if (!re.test(full)) return;
      results.push({ name: heading, topic: '', desc: descText });
    });
    return results;
  }, BYGGLOV_RE.source);
}

async function extractAppEvolution(page) {
  return page.evaluate((reStr) => {
    const re = new RegExp(reStr, 'i');
    const results = [];
    const containers = document.querySelectorAll('.sv-limepark-app-evolution');

    containers.forEach(c => {
      // Get section heading from preceding element
      const heading = c.previousElementSibling;
      const sectionTitle = heading ? heading.textContent.trim() : '';

      // Determine section type
      let sectionType = 'beviljat';
      if (/synpunkt|möjlighet/i.test(sectionTitle)) sectionType = 'synpunkter';

      const links = [...c.querySelectorAll('a')];
      for (const a of links) {
        const text = a.textContent.trim();
        if (re.test(text) || re.test(sectionTitle)) {
          results.push({ title: text, sectionTitle, sectionType });
        }
      }
    });
    return results;
  }, BYGGLOV_RE.source);
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
    adress: parsed.adress || null,
    atgard: parsed.atgard || null,
    kommun: config.kommun,
    lan: config.lan || null,
    country: 'SE',
    sourceUrl: config.sourceUrl || config.url,
    status: parsed.status || 'beviljat',
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
  console.error(`\n${config.kommun} (${mode}) — ${config.url}`);
  console.error('─'.repeat(60));

  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  const browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; ByggSignal/1.0)');
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 25000 });

    let rawItems = [];

    if (config.type === 'app-evolution') {
      // Wait for app-evolution containers
      await page.waitForSelector('.sv-limepark-app-evolution', { timeout: 10000 }).catch(() => {});
      rawItems = await extractAppEvolution(page);
      console.error(`  App-evolution: ${rawItems.length} bygglov-relaterade länkar`);
    } else if (config.type === 'bulletin-board') {
      // Older lp-bulletin-board widget (Vindeln)
      await page.waitForSelector('li.lp-bulletin-board__list-item', { timeout: 10000 }).catch(() => {});
      rawItems = await extractBulletinBoard(page);
      console.error(`  Bulletin-board: ${rawItems.length} bygglov-relaterade poster`);
    } else {
      // notice-board: wait for items, click all to expand descriptions
      await page.waitForSelector('li.limepark-notice-board__item', { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => {
        document.querySelectorAll('button.limepark-notice-board__item__header').forEach(b => b.click());
      });
      await new Promise(r => setTimeout(r, 1500));
      rawItems = await extractNoticeBoard(page);
      console.error(`  Notice-board: ${rawItems.length} bygglov-relaterade poster`);
    }

    if (rawItems.length === 0) {
      console.error('  Inga ärenden att bearbeta.');
      return;
    }

    // Parse items
    const permits = [];
    const skipped = [];

    for (const item of rawItems) {
      let parsed;
      if (config.type === 'app-evolution') {
        parsed = parseAppEvoLink(item.title, item.sectionType);
      } else {
        parsed = parseNoticeItem(item.name, item.topic, item.desc);
      }

      // Key: prefer diarienummer, fallback to kommun+fastighet
      const key = parsed.diarienummer
        || (parsed.fastighetsbeteckning
          ? `${config.kommun.toUpperCase().replace(/\s/g, '-')}-${parsed.fastighetsbeteckning.replace(/\s+/g, '-')}`
          : null);

      if (!key) {
        skipped.push((item.name || item.title || '').slice(0, 60));
        continue;
      }

      const row = buildRow({ ...parsed, diarienummer: key }, config);
      permits.push(row);
    }

    if (skipped.length > 0) {
      console.error(`  Skippad ${skipped.length} poster (ingen nyckel):`);
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
          console.error(`  ok ${row.diarienummer} — ${row.fastighetsbeteckning || '?'}`);
        } catch (err) {
          console.error(`  x  ${row.diarienummer}: ${err.message}`);
        }
      }
    } else {
      for (const row of permits) {
        console.log(`  ${row.diarienummer} | ${row.fastighetsbeteckning || '?'} | ${row.adress || '—'} | ${row.status} | ${row.beslutsdatum || '?'} | ${row.permit_type}`);
      }
    }

    console.error(`\n${config.kommun}: ${rawItems.length} relevant, ${permits.length} parsed, ${save ? saved + ' saved' : 'dry-run'}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
