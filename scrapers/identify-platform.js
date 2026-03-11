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
 *   node scrapers/identify-platform.js --vg           # only Västra Götaland
 */

const fs = require('fs');
const path = require('path');

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
  { kommun: 'Knivsta',     urls: ['https://www.knivsta.se/politik-och-organisation/anslagstavla'] },
  { kommun: 'Uppsala',     urls: ['https://www.uppsala.se/kommun-och-politik/anslagstavla/', 'https://www.uppsala.se/kommun-och-politik/anslagstavla'] },
  { kommun: 'Enköping',    urls: ['https://enkoping.se/kommun-och-politik/anslagstavla.html', 'https://www.enkoping.se/kommun-och-politik/anslagstavla.html'] },
  { kommun: 'Tierp',       urls: ['https://www.tierp.se/tierp.se/kommun-och-politik/politik-och-beslut/anslagstavlan.html', 'https://www.tierp.se/kommun-och-politik/politik-och-beslut/anslagstavlan.html'] },
  { kommun: 'Östhammar',   urls: ['https://www.osthammar.se/sv/kommunpolitik/kommunen/kommunens-anslagstavla/', 'https://www.osthammar.se/anslagstavla'] },
  { kommun: 'Älvkarleby',  urls: ['https://www.alvkarleby.se/anslagstavla', 'https://www.alvkarleby.se/kommun-och-politik/anslagstavla'] },
  { kommun: 'Heby',        urls: ['https://www.heby.se/organisation-plats-och-politik/sammantraden-handlingar-och-styrande-dokument/digital-anslagstavla', 'https://www.heby.se/organisation-plats-och-politik/moten-handlingar-och-styrande-dokument/digital-anslagstavla'] },
];

/**
 * Generate URL variants to try for a given domain.
 * Common patterns: /kommun-och-politik/anslagstavla, /anslagstavla, etc.
 */
function anslagstavlaVarianter(domain) {
  return [
    `https://${domain}/kommun-och-politik/anslagstavla`,
    `https://${domain}/anslagstavla`,
    `https://${domain}/kommun-och-politik/digital-anslagstavla`,
    `https://${domain}/digital-anslagstavla`,
    `https://${domain}/kommun-och-politik/anslagstavla.html`,
    `https://${domain}/kommunpolitik/anslagstavla`,
  ];
}

const VASTRA_GOTALAND = [
  { kommun: 'Ale',          urls: ['https://ale.se/anslagstavla-officiell.html', ...anslagstavlaVarianter('www.ale.se')] },
  { kommun: 'Alingsås',     urls: ['https://www.alingsas.se/kommun-och-politik/politik-och-beslut/digital-anslagstavla/', ...anslagstavlaVarianter('www.alingsas.se')] },
  { kommun: 'Bengtsfors',   urls: anslagstavlaVarianter('www.bengtsfors.se') },
  { kommun: 'Bollebygd',    urls: anslagstavlaVarianter('www.bollebygd.se') },
  { kommun: 'Borås',        urls: anslagstavlaVarianter('www.boras.se') },
  { kommun: 'Dals-Ed',      urls: anslagstavlaVarianter('www.dalsed.se') },
  { kommun: 'Essunga',      urls: ['https://www.essunga.se/kommun--politik/politik-och-demokrati/anslagstavla.html', ...anslagstavlaVarianter('www.essunga.se')] },
  { kommun: 'Falköping',    urls: ['https://anslagstavlan.falkoping.se/', ...anslagstavlaVarianter('www.falkoping.se')] },
  { kommun: 'Färgelanda',   urls: anslagstavlaVarianter('fargelanda.se') },
  { kommun: 'Grästorp',     urls: anslagstavlaVarianter('www.grastorp.se') },
  { kommun: 'Gullspång',    urls: anslagstavlaVarianter('gullspang.se') },
  { kommun: 'Göteborg',     urls: ['https://goteborg.se/wps/portal/start/kommun-och-politik/anslagstavla-officiell/goteborgs-stads-anslagstavla', ...anslagstavlaVarianter('goteborg.se')] },
  { kommun: 'Götene',       urls: anslagstavlaVarianter('www.gotene.se') },
  { kommun: 'Herrljunga',   urls: anslagstavlaVarianter('herrljunga.se') },
  { kommun: 'Hjo',          urls: ['https://hjo.se/kommun--politik/politik-och-organisation/anslagstavla2/', ...anslagstavlaVarianter('www.hjo.se')] },
  { kommun: 'Härryda',      urls: anslagstavlaVarianter('www.harryda.se') },
  { kommun: 'Karlsborg',    urls: ['https://karlsborg.se/kommun--politik/sa-styrs-karlsborgs-kommun/politik/anslagstavla-for-protokoll/', ...anslagstavlaVarianter('www.karlsborg.se')] },
  { kommun: 'Kungälv',      urls: anslagstavlaVarianter('www.kungalv.se') },
  { kommun: 'Lerum',        urls: anslagstavlaVarianter('www.lerum.se') },
  { kommun: 'Lidköping',    urls: ['https://lidkoping.se/kommun-och-politik/politik-och-demokrati/anslagstavla', ...anslagstavlaVarianter('www.lidkoping.se')] },
  { kommun: 'Lilla Edet',   urls: anslagstavlaVarianter('lillaedet.se') },
  { kommun: 'Lysekil',      urls: ['https://www.lysekil.se/organisation-plats-och-politik/moten-handlingar-och-protokoll/kommunal-anslagstavla.html', ...anslagstavlaVarianter('www.lysekil.se')] },
  { kommun: 'Mariestad',    urls: anslagstavlaVarianter('www.mariestad.se') },
  { kommun: 'Mark',         urls: anslagstavlaVarianter('www.mark.se') },
  { kommun: 'Mellerud',     urls: anslagstavlaVarianter('mellerud.se') },
  { kommun: 'Munkedal',     urls: ['https://www.munkedal.se/kommun-och-politik/officiell-anslagstavla', ...anslagstavlaVarianter('www.munkedal.se')] },
  { kommun: 'Mölndal',      urls: anslagstavlaVarianter('www.molndal.se') },
  { kommun: 'Orust',        urls: ['https://www.orust.se/kommun-och-politik/beslut-insyn-och-rattssakerhet/anslagstavla', ...anslagstavlaVarianter('www.orust.se')] },
  { kommun: 'Partille',     urls: anslagstavlaVarianter('www.partille.se') },
  { kommun: 'Skara',        urls: ['https://www.skara.se/kommunochpolitik/overklagabeslutrattssakerhet/anslagstavla.740.html', ...anslagstavlaVarianter('www.skara.se')] },
  { kommun: 'Skövde',       urls: anslagstavlaVarianter('www.skovde.se') },
  { kommun: 'Sotenäs',      urls: anslagstavlaVarianter('www.sotenas.se') },
  { kommun: 'Stenungsund',  urls: anslagstavlaVarianter('www.stenungsund.se') },
  { kommun: 'Strömstad',    urls: anslagstavlaVarianter('www.stromstad.se') },
  { kommun: 'Svenljunga',   urls: anslagstavlaVarianter('www.svenljunga.se') },
  { kommun: 'Tanum',        urls: anslagstavlaVarianter('www.tanum.se') },
  { kommun: 'Tibro',        urls: anslagstavlaVarianter('www.tibro.se') },
  { kommun: 'Tidaholm',     urls: anslagstavlaVarianter('www.tidaholm.se') },
  { kommun: 'Tjörn',        urls: anslagstavlaVarianter('www.tjorn.se') },
  { kommun: 'Tranemo',      urls: ['https://tranemo.se/kommun-och-politik/digital-anslagstavla/', ...anslagstavlaVarianter('www.tranemo.se')] },
  { kommun: 'Trollhättan',  urls: anslagstavlaVarianter('www.trollhattan.se') },
  { kommun: 'Töreboda',     urls: anslagstavlaVarianter('toreboda.se') },
  { kommun: 'Uddevalla',    urls: ['https://www.uddevalla.se/kommun-och-politik/anslagstavla.html', ...anslagstavlaVarianter('www.uddevalla.se')] },
  { kommun: 'Ulricehamn',   urls: ['https://www.ulricehamn.se/kommun-och-politik/overklaga-beslut-rattssakerhet/anslagstavla', ...anslagstavlaVarianter('www.ulricehamn.se')] },
  { kommun: 'Vara',         urls: anslagstavlaVarianter('www.vara.se') },
  { kommun: 'Vårgårda',     urls: ['https://www.vargarda.se/kommun-och-demokrati/anslagstavla.html', ...anslagstavlaVarianter('www.vargarda.se')] },
  { kommun: 'Vänersborg',   urls: anslagstavlaVarianter('vanersborg.se') },
  { kommun: 'Åmål',         urls: ['https://anslagstavla.amal.se/', ...anslagstavlaVarianter('amal.se')] },
  { kommun: 'Öckerö',       urls: anslagstavlaVarianter('www.ockero.se') },
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
    test: (url, html) =>
      /digital-bulletin-board/i.test(url) ||
      /meetingsplus/i.test(html),
  },
  {
    platform: 'netpublicator',
    test: (_url, html) =>
      /netpublicator\.com/i.test(html) ||
      /data-npid/i.test(html),
  },
  {
    platform: 'digitaltutskick',
    test: (url, html) =>
      /digitaltutskick/i.test(url) ||
      /digitaltutskick/i.test(html),
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timeout);
  }
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
 */
function getItemText(a) {
  if (a.title !== undefined) {
    return (a.title || '') + ' ' + (a.freeText || '') + ' ' + (a.type || '') + ' ' + (a.organ || '') + ' ' + (a.instance || '');
  }
  const content = a.htmlContent ? stripTags(a.htmlContent) : '';
  return (a.header || '') + ' ' + content + ' ' + (a.authority || '') + ' ' + (a.type || '');
}

function getItemTitle(a) {
  return a.title || a.header || '';
}

/**
 * Probe SiteVision AppRegistry and return structured result (no console output).
 */
function probeSiteVisionData(html) {
  const result = findAnnouncementsKey(html);
  if (!result) return null;

  const { key, items, type } = result;

  const bygglov = items.filter(a => {
    const text = getItemText(a);
    return /bygglov|rivningslov|marklov|förhandsbesked|tidsbegränsat|nybyggnad|tillbyggnad/i.test(text);
  });

  const sample = bygglov.slice(0, 3).map(a => {
    const searchText = getItemText(a);
    const dnrMatch = searchText.match(/\b([A-ZÅÄÖ]{2,5})\s+(\d{4}-\d+)/);
    return {
      diarienummer: dnrMatch ? `${dnrMatch[1]} ${dnrMatch[2]}` : null,
      title: getItemTitle(a).slice(0, 80),
    };
  });

  const fields = items.length > 0 ? Object.keys(items[0]) : [];

  return {
    appRegistryKey: key,
    portletType: type,
    totalItems: items.length,
    bygglovItems: bygglov.length,
    sample,
    fields,
  };
}

/**
 * For a SiteVision site, extract announcements and log a summary.
 */
function probeSiteVision(kommun, html) {
  const data = probeSiteVisionData(html);
  if (!data) {
    console.log(`  ⚠  ${kommun}: SiteVision men ingen AppRegistry med announcements/articles/initialNotices hittad`);
    return null;
  }

  console.log(`  ✓  AppRegistry-nyckel: '${data.appRegistryKey}' (typ: ${data.portletType})`);
  console.log(`     Totalt ${data.totalItems} kungörelser, varav ${data.bygglovItems} bygglov-relaterade`);

  for (const s of data.sample) {
    console.log(`     → ${s.diarienummer || '(inget dnr)'}  ${s.title}`);
  }

  if (data.fields.length > 0) {
    console.log(`     Fält: ${data.fields.join(', ')}`);
  }

  return data;
}

// ── Scan functions ──────────────────────────────────────────────────────────

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

      if (platform.includes('sitevision')) {
        probeSiteVision(kommun, html);
      }
    } catch (err) {
      console.log(`${kommun.padEnd(14)} ${'FEL'.padEnd(16)} (alla varianter misslyckades)`);
      console.log(`  ${err.message}`);
    }
  }
}

async function scanVastraGotaland() {
  console.log('═══ Västra Götalands län (49 kommuner) ═══\n');
  console.log(`${'Kommun'.padEnd(14)} ${'Plattform'.padEnd(24)} URL`);
  console.log(`${'─'.repeat(14)} ${'─'.repeat(24)} ${'─'.repeat(60)}`);

  const results = [];

  for (const entry of VASTRA_GOTALAND) {
    const { kommun, urls } = entry;
    const record = { kommun, platform: null, url: null, error: null, sitevision: null };

    try {
      const { url, html } = await fetchWithFallback(urls);
      const platform = identify(url, html);
      record.platform = platform;
      record.url = url;

      let svDetail = '';
      if (platform.includes('sitevision')) {
        const svData = probeSiteVisionData(html);
        if (svData) {
          record.sitevision = svData;
          svDetail = ` [${svData.portletType}: ${svData.totalItems} st, ${svData.bygglovItems} bygglov]`;
        } else {
          svDetail = ' [ingen AppRegistry-data]';
        }
      }

      console.log(`${kommun.padEnd(14)} ${(platform + svDetail).padEnd(24)} ${url}`);
    } catch (err) {
      record.platform = 'FEL';
      record.error = err.message;
      console.log(`${kommun.padEnd(14)} ${'FEL'.padEnd(24)} (alla varianter misslyckades)`);
    }

    results.push(record);
  }

  // Summary
  const platforms = {};
  for (const r of results) {
    const p = r.platform || 'FEL';
    platforms[p] = (platforms[p] || 0) + 1;
  }

  console.log('\n── Sammanfattning ──');
  for (const [p, count] of Object.entries(platforms).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}: ${count} kommuner`);
  }

  // Save JSON
  const outPath = path.join(__dirname, 'platform-scan-vastra-gotaland.json');
  const output = {
    scannedAt: new Date().toISOString(),
    län: 'Västra Götaland',
    totalKommuner: results.length,
    summary: platforms,
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSparat till ${outPath}`);

  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Platform-identifiering av anslagstavlor\n');

  const args = process.argv.slice(2);
  const runVG = args.includes('--vg') || args.includes('--vastra-gotaland');
  const runUppsala = args.includes('--uppsala');
  const runStockholm = args.includes('--stockholm');
  const runAll = !runVG && !runUppsala && !runStockholm;

  if (runStockholm || runAll) {
    await scanStockholm();
    console.log('');
  }
  if (runUppsala || runAll) {
    await scanUppsala();
    console.log('');
  }
  if (runVG || runAll) {
    await scanVastraGotaland();
  }
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
