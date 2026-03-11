#!/usr/bin/env node
/**
 * identify-platform.js
 *
 * Identifies the underlying platform for Swedish municipality bulletin boards.
 * Uses plain fetch (no Puppeteer) to grab HTML and matches fingerprints.
 *
 * For SiteVision sites, also probes AppRegistry data to check if the
 * Knivsta-style scraper approach works (announcements JSON in page HTML).
 *
 * Usage:
 *   node scrapers/identify-platform.js               # run all groups
 *   node scrapers/identify-platform.js --uppsala      # only Uppsala län
 *   node scrapers/identify-platform.js --stockholm    # only Stockholm län
 */

// ── URL lists by group ──────────────────────────────────────────────────────

const STOCKHOLM = [
  { kommun: 'Knivsta',       url: 'https://www.knivsta.se/politik-och-organisation/anslagstavla' },
  { kommun: 'Salem',         url: 'https://salem.se/anslagstavla.4.5f17fb541901008a8bd67abc.html' },
  { kommun: 'Danderyd',      url: 'https://meetingsplus.danderyd.se/digital-bulletin-board' },
  { kommun: 'Norrtälje',     url: 'https://forum.norrtalje.se/digital-bulletin-board' },
  { kommun: 'Sollentuna',    url: 'https://www.sollentuna.se/kommun--politik/offentlighet-och-sekretess/anslagstavla-officiell/' },
  { kommun: 'Järfälla',      url: 'https://www.jarfalla.se/kommunochpolitik/politikochnamnder/anslagstavla.4.3cbad1981604650ddf392cc7.html' },
  { kommun: 'Nacka',         url: 'https://www.nacka.se/kommun--politik/delta-och-paverka/anslagstavla-officiell/kungorelser/' },
  { kommun: 'Botkyrka',      url: 'https://www.botkyrka.se/kommun-och-politik/digital-anslagstavla' },
  { kommun: 'Södertälje',    url: 'https://www.sodertalje.se/kommun-och-politik/anslagstavla/' },
  { kommun: 'Huddinge',      url: 'https://www.huddinge.se/organisation-och-styrning/huddinge-kommuns-anslagstavla/' },
];

const UPPSALA = [
  {
    kommun: 'Knivsta',
    urls: ['https://www.knivsta.se/politik-och-organisation/anslagstavla'],
  },
  {
    kommun: 'Uppsala',
    urls: [
      'https://www.uppsala.se/kommun-och-politik/anslagstavla/',
      'https://www.uppsala.se/kommun-och-politik/anslagstavla',
    ],
  },
  {
    kommun: 'Enköping',
    urls: [
      'https://enkoping.se/kommun-och-politik/anslagstavla.html',
      'https://www.enkoping.se/kommun-och-politik/anslagstavla.html',
    ],
  },
  {
    kommun: 'Tierp',
    urls: [
      'https://www.tierp.se/tierp.se/kommun-och-politik/politik-och-beslut/anslagstavlan.html',
      'https://www.tierp.se/kommun-och-politik/politik-och-beslut/anslagstavlan.html',
    ],
  },
  {
    kommun: 'Östhammar',
    urls: [
      'https://www.osthammar.se/sv/kommunpolitik/kommunen/kommunens-anslagstavla/',
      'https://www.osthammar.se/anslagstavla',
    ],
  },
  {
    kommun: 'Älvkarleby',
    urls: [
      'https://www.alvkarleby.se/anslagstavla',
      'https://www.alvkarleby.se/kommun-och-politik/anslagstavla',
    ],
  },
  {
    kommun: 'Heby',
    urls: [
      'https://www.heby.se/organisation-plats-och-politik/sammantraden-handlingar-och-styrande-dokument/digital-anslagstavla',
      'https://www.heby.se/organisation-plats-och-politik/moten-handlingar-och-styrande-dokument/digital-anslagstavla',
    ],
  },
];

// ── Fingerprints ────────────────────────────────────────────────────────────

const FINGERPRINTS = [
  {
    platform: 'sitevision',
    test: (_url, html) =>
      /AppRegistry\.registerInitialState/i.test(html) ||
      /sv-channel-item/i.test(html) ||
      /sv-portlet/i.test(html),
  },
  {
    platform: 'meetingsplus',
    test: (url, _html) => /digital-bulletin-board/i.test(url),
  },
  {
    platform: 'netpublicator',
    test: (_url, html) =>
      /netpublicator\.com/i.test(html) ||
      /data-npid/i.test(html),
  },
  {
    platform: 'digitaltutskick',
    test: (url, _html) => /digitaltutskick/i.test(url),
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
      'Accept': 'text/html',
      'Accept-Language': 'sv-SE,sv;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function identify(url, html) {
  const matches = [];
  for (const fp of FINGERPRINTS) {
    if (fp.test(url, html)) matches.push(fp.platform);
  }
  return matches.length > 0 ? matches.join(', ') : 'okänd';
}

/**
 * Try multiple URL variants for a kommun, return first successful hit.
 */
async function fetchWithFallback(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      return { url, html };
    } catch (err) {
      errors.push(`${url} → ${err.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

// ── SiteVision AppRegistry probe ────────────────────────────────────────────

function stripTags(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find all AppRegistry keys in HTML and return the one that contains
 * anslagstavla data. Supports multiple SiteVision portlet types:
 *   - "announcements" array (Knivsta/Salem-style)
 *   - "articles" array (Salem alt)
 *   - "initialNotices" array (Enköping-style)
 */
function findAnnouncementsKey(html) {
  const re = /AppRegistry\.registerInitialState\('([^']+)',\s*([\s\S]+?)\);\s*(?:AppRegistry|<\/script)/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[2]);
      if (Array.isArray(json.announcements)) {
        return { key: match[1], items: json.announcements, type: 'announcements' };
      }
      if (Array.isArray(json.articles)) {
        return { key: match[1], items: json.articles, type: 'articles' };
      }
      if (Array.isArray(json.initialNotices)) {
        return { key: match[1], items: json.initialNotices, type: 'initialNotices' };
      }
    } catch (_) {
      // JSON parse failed — skip this key
    }
  }
  return null;
}

/**
 * Extract searchable text from an item, regardless of portlet type.
 * - announcements/articles: title, freeText, organ, type, instance
 * - initialNotices: header, htmlContent (stripped), authority, type
 */
function getItemText(a) {
  // announcements/articles style
  if (a.title !== undefined) {
    return (a.title || '') + ' ' + (a.freeText || '') + ' ' + (a.type || '') + ' ' + (a.organ || '') + ' ' + (a.instance || '');
  }
  // initialNotices style
  const content = a.htmlContent ? stripTags(a.htmlContent) : '';
  return (a.header || '') + ' ' + content + ' ' + (a.authority || '') + ' ' + (a.type || '');
}

function getItemTitle(a) {
  return a.title || a.header || '';
}

/**
 * For a SiteVision site, extract announcements and log a summary.
 * Mirrors the Knivsta scraper logic but without DB writes.
 */
function probeSiteVision(kommun, html) {
  const result = findAnnouncementsKey(html);
  if (!result) {
    console.log(`  ⚠  ${kommun}: SiteVision men ingen AppRegistry med announcements/articles/initialNotices hittad`);
    return;
  }

  const { key, items, type } = result;
  console.log(`  ✓  AppRegistry-nyckel: '${key}' (typ: ${type})`);
  console.log(`     Totalt ${items.length} kungörelser`);

  // Filter for bygglov-related
  const bygglov = items.filter(a => {
    const text = getItemText(a);
    return /bygglov|rivningslov|marklov|förhandsbesked|tidsbegränsat|nybyggnad|tillbyggnad/i.test(text);
  });
  console.log(`     Varav ${bygglov.length} bygglov-relaterade`);

  // Extract diarienummer from first 3
  const sample = bygglov.slice(0, 3);
  for (const a of sample) {
    const searchText = getItemText(a);
    // Try common diarienummer patterns: "BYGG 2025-801", "BMK 2025-000517", etc.
    const dnrMatch = searchText.match(/\b([A-ZÅÄÖ]{2,5})\s+(\d{4}-\d+)/);
    const dnr = dnrMatch ? `${dnrMatch[1]} ${dnrMatch[2]}` : '(inget dnr)';
    const title = getItemTitle(a).slice(0, 70);
    console.log(`     → ${dnr}  ${title}`);
  }

  // Show available fields on first item for debugging
  if (items.length > 0) {
    const fields = Object.keys(items[0]).join(', ');
    console.log(`     Fält: ${fields}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function scanStockholm() {
  console.log('═══ Stockholm län ═══\n');
  console.log(`${'Kommun'.padEnd(14)} ${'Plattform'.padEnd(16)} URL`);
  console.log(`${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(50)}`);

  for (const { kommun, url } of STOCKHOLM) {
    try {
      const html = await fetchHtml(url);
      const platform = identify(url, html);
      console.log(`${kommun.padEnd(14)} ${platform.padEnd(16)} ${url}`);
    } catch (err) {
      console.log(`${kommun.padEnd(14)} ${'FEL'.padEnd(16)} ${url}  (${err.message})`);
    }
  }
}

async function scanUppsala() {
  console.log('═══ Uppsala län ═══\n');
  console.log(`${'Kommun'.padEnd(14)} ${'Plattform'.padEnd(16)} URL`);
  console.log(`${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(50)}`);

  for (const entry of UPPSALA) {
    const { kommun, urls } = entry;
    try {
      const { url, html } = await fetchWithFallback(urls);
      const platform = identify(url, html);
      console.log(`${kommun.padEnd(14)} ${platform.padEnd(16)} ${url}`);

      // Probe SiteVision sites for Knivsta-style scraping
      if (platform.includes('sitevision')) {
        probeSiteVision(kommun, html);
      }
    } catch (err) {
      console.log(`${kommun.padEnd(14)} ${'FEL'.padEnd(16)} (alla varianter misslyckades)`);
      console.log(`  ${err.message}`);
    }
  }
}

async function main() {
  console.log('Platform-identifiering av anslagstavlor\n');

  const args = process.argv.slice(2);
  const runUppsala = args.includes('--uppsala') || args.length === 0;
  const runStockholm = args.includes('--stockholm') || args.length === 0;

  if (runStockholm) {
    await scanStockholm();
    console.log('');
  }
  if (runUppsala) {
    await scanUppsala();
  }
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
