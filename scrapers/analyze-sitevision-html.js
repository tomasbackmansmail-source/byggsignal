#!/usr/bin/env node
/**
 * analyze-sitevision-html.js
 *
 * Fetches anslagstavla pages from 5 SiteVision municipalities in VG
 * (without AppRegistry data) and analyzes the HTML structure around
 * building permit notices to determine if there's a shared pattern.
 *
 * Also probes for additional AppRegistry data types beyond the ones
 * already known (announcements, articles, initialNotices).
 *
 * Usage:
 *   node scrapers/analyze-sitevision-html.js
 *
 * Findings (2026-03-11):
 *
 * THREE distinct SiteVision patterns found:
 *
 * 1. LISTING + DETAIL PAGES (Borås, Grästorp)
 *    - Main page lists links to individual kungörelse pages
 *    - Each detail page has <strong>label:</strong> value pairs
 *    - Borås: sv-channel-item <li>, detail pages at /funktioner/anslagstavla/kungorelsebygglov/*.html
 *    - Grästorp: <article> tags, detail pages at /kommun-och-politik/anslagstavla/.../YYYY-MM-DD-*.html
 *    - Diarienummer, fastighet, datum on detail pages (not listing)
 *    - Scraping: fetch listing → extract links → fetch each detail → parse <strong>label: value
 *
 * 2. APPREGISTRY "pages" (Lerum — NEW type!)
 *    - BulletinBoard React component with pages[] in AppRegistry
 *    - First 10 items server-rendered, rest requires pagination (JS)
 *    - Each item has: title, uri, published, organization, preamble, subject, fromDate, toDate
 *    - Detail pages at /kommun-och-politik/digital-anslagstavla/anslagsarkiv/YYYY-MM-DD-slug
 *    - Scraping: parse AppRegistry for first 10 + fetch detail pages
 *
 * 3. INLINE sv-text-portlet (Munkedal)
 *    - sv-channel-item <li> on listing page
 *    - Detail pages: sv-text-portlet divs with #Ingress (ärende) and #Text-0 (dates)
 *    - Data mashed into single <strong> tag: "Åtgärd, FASTIGHET\nDIARIENR"
 *    - Inconsistent structure between pages
 *    - Scraping: fetch listing → extract links → fetch detail → parse free text from #Ingress
 *
 * 4. NO DATA on main page (Mölndal)
 *    - 0 keyword hits — likely JS-rendered or uses external system
 *    - Needs Puppeteer or different approach
 */

const TARGETS = [
  { kommun: 'Borås',     url: 'https://www.boras.se/anslagstavla',       pop: '~115k' },
  { kommun: 'Mölndal',   url: 'https://www.molndal.se/anslagstavla',     pop: '~70k' },
  { kommun: 'Lerum',     url: 'https://www.lerum.se/anslagstavla',       pop: '~43k' },
  { kommun: 'Munkedal',  url: 'https://www.munkedal.se/kommun-och-politik/officiell-anslagstavla', pop: '~10k' },
  { kommun: 'Grästorp',  url: 'https://www.grastorp.se/kommun-och-politik/anslagstavla', pop: '~6k' },
];

const KEYWORDS_RE = /bygglov|byggnad|marklov|rivning|\bBN\s|\bBYGG\b/i;

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

/**
 * Find ALL AppRegistry keys and report what data each contains.
 * Goes beyond announcements/articles/initialNotices to discover new types.
 */
function probeAllAppRegistryKeys(html) {
  const re = /AppRegistry\.registerInitialState\('([^']+)',\s*([\s\S]+?)\);\s*(?:AppRegistry|<\/script)/g;
  const keys = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[2]);
      const topFields = Object.keys(json);
      const arrFields = topFields.filter(k => Array.isArray(json[k]));
      keys.push({
        key: match[1],
        topFields,
        arrayFields: arrFields.map(k => `${k}(${json[k].length})`),
        hasPages: Array.isArray(json.pages),
        hasAnnouncements: Array.isArray(json.announcements),
        hasArticles: Array.isArray(json.articles),
        hasInitialNotices: Array.isArray(json.initialNotices),
      });
    } catch (_) {
      keys.push({ key: match[1], parseError: true });
    }
  }
  return keys;
}

/**
 * Find the innermost container elements that contain keyword matches.
 */
function analyzeHtml(html) {
  const results = {
    totalSize: html.length,
    keywordHits: 0,
    containerTags: {},
    hasDiarienummer: false,
    hasAdress: false,
    hasDatum: false,
    diariePattern: null,
    datumPattern: null,
    sampleSnippet: null,
    sampleTag: null,
    hasSvTextPortlet: false,
    hasAccordion: false,
    hasChannelItem: false,
    hasShowHideSection: false,
    appRegistryKeys: [],
  };

  // Probe AppRegistry
  results.appRegistryKeys = probeAllAppRegistryKeys(html);

  // Strip <script> and <style> blocks to avoid false positives
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Find all positions of keyword matches in cleaned HTML
  const re = new RegExp(KEYWORDS_RE.source, 'gi');
  let match;
  const positions = [];
  while ((match = re.exec(cleaned)) !== null) {
    positions.push({ index: match.index, keyword: match[0] });
  }

  results.keywordHits = positions.length;

  if (positions.length === 0) return results;

  // For each match, look back to find the enclosing tag
  const tagCounts = {};
  const snippets = [];

  for (const pos of positions) {
    const lookback = cleaned.slice(Math.max(0, pos.index - 2000), pos.index);

    const blockTags = [...lookback.matchAll(/<(article|section|details|li|tr|div|aside|dl|dd)\b[^>]*>/gi)];
    const nearest = blockTags.length > 0 ? blockTags[blockTags.length - 1] : null;

    if (nearest) {
      const tag = nearest[1].toLowerCase();
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;

      const tagStart = lookback.lastIndexOf(nearest[0]);
      if (tagStart >= 0) {
        const snippetStart = Math.max(0, pos.index - 2000) + tagStart;
        const snippet = cleaned.slice(snippetStart, pos.index + 500);
        snippets.push({ tag, keyword: pos.keyword, snippet });
      }
    } else {
      tagCounts['(otaggad)'] = (tagCounts['(otaggad)'] || 0) + 1;
    }
  }

  results.containerTags = tagCounts;

  // Check for structured data patterns near keywords
  for (const pos of positions.slice(0, 20)) {
    const context = cleaned.slice(Math.max(0, pos.index - 500), pos.index + 1000);

    if (!results.hasDiarienummer) {
      const dnr = context.match(/\b(BN|SBN|BMN|MBN|BYGG|BoM|SBF|MHN|SBFV|GRMB)\s*[\s.]?\s*\d{4}[-.\s\/]\d+/i);
      if (dnr) {
        results.hasDiarienummer = true;
        results.diariePattern = dnr[0].trim();
      }
    }

    if (!results.hasAdress) {
      const addr = context.match(/(?:adress|gatan|vägen|stigen|väg\s+\d|gata\s+\d)/i);
      if (addr) results.hasAdress = true;
    }

    if (!results.hasDatum) {
      const datum = context.match(/\d{4}-\d{2}-\d{2}/);
      if (datum) {
        results.hasDatum = true;
        results.datumPattern = datum[0];
      }
    }
  }

  // Pick the best sample snippet
  const bestSnippet = snippets.find(s => /BN|SBN|BYGG|BMN|MBN|BoM|SBFV|GRMB/i.test(s.snippet))
    || snippets[0];
  if (bestSnippet) {
    results.sampleSnippet = bestSnippet.snippet.slice(0, 600);
    results.sampleTag = bestSnippet.tag;
  }

  results.hasSvTextPortlet = /sv-text-portlet/i.test(cleaned);
  results.hasAccordion = /<details|class="[^"]*accordion/i.test(cleaned);
  results.hasChannelItem = /sv-channel-item/i.test(cleaned);
  results.hasShowHideSection = /show-hide-section/i.test(cleaned);

  return results;
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log('SiteVision HTML-strukturanalys — 5 VG-kommuner utan AppRegistry\n');

  for (const target of TARGETS) {
    console.log(`${'═'.repeat(70)}`);
    console.log(`${target.kommun} (${target.pop})  —  ${target.url}`);
    console.log(`${'─'.repeat(70)}`);

    try {
      const html = await fetchHtml(target.url);
      const analysis = analyzeHtml(html);

      console.log(`  HTML-storlek: ${(analysis.totalSize / 1024).toFixed(0)} KB`);
      console.log(`  Nyckelords-träffar: ${analysis.keywordHits}`);
      console.log(`  Container-taggar: ${JSON.stringify(analysis.containerTags)}`);
      console.log(`  Diarienummer: ${analysis.hasDiarienummer ? `JA (ex: "${analysis.diariePattern}")` : 'NEJ'}`);
      console.log(`  Adress: ${analysis.hasAdress ? 'JA' : 'NEJ'}`);
      console.log(`  Datum: ${analysis.hasDatum ? `JA (ex: ${analysis.datumPattern})` : 'NEJ'}`);
      console.log(`  SV-portlets: sv-text-portlet=${analysis.hasSvTextPortlet}, accordion/details=${analysis.hasAccordion}, channel-item=${analysis.hasChannelItem}, show-hide=${analysis.hasShowHideSection}`);

      // AppRegistry deep probe
      if (analysis.appRegistryKeys.length > 0) {
        console.log(`  AppRegistry-nycklar (${analysis.appRegistryKeys.length} st):`);
        for (const k of analysis.appRegistryKeys) {
          if (k.parseError) {
            console.log(`    '${k.key}' — JSON parse error`);
          } else {
            const interesting = k.arrayFields.length > 0 ? ` arrays: ${k.arrayFields.join(', ')}` : '';
            console.log(`    '${k.key}' — fält: ${k.topFields.join(', ')}${interesting}`);
          }
        }
      }

      if (analysis.sampleSnippet) {
        console.log(`\n  Exempelträff (tag: <${analysis.sampleTag}>):`);
        const text = stripTags(analysis.sampleSnippet);
        console.log(`  TEXT: ${text.slice(0, 300)}`);
        console.log(`\n  RÅ HTML (500 tecken):`);
        console.log(`  ${analysis.sampleSnippet.slice(0, 500)}`);
      } else {
        console.log('\n  (inga bygglov-träffar i HTML)');
      }
    } catch (err) {
      console.log(`  FEL: ${err.message}`);
    }
    console.log('');
  }

  // Summary
  console.log(`${'═'.repeat(70)}`);
  console.log('SAMMANFATTNING');
  console.log(`${'─'.repeat(70)}`);
  console.log(`
  Tre distinkta SiteVision-mönster identifierade:

  1. LISTING + DETAIL PAGES (Borås, Grästorp)
     - Huvudsida listar länkar till individuella kungörelsesidor
     - Detaljsidor har <strong>etikett:</strong> värde-par (flat HTML)
     - Borås: sv-channel-item <li>, 43+ länkar
     - Grästorp: <article> tags, enklare struktur
     - Diarienummer-prefix: BN (Borås), GRMB (Grästorp)

  2. APPREGISTRY "pages" (Lerum — NY typ!)
     - BulletinBoard React-komponent med pages[] i AppRegistry
     - Första 10 items serverrenderade, resten kräver JS
     - Har title, uri, published, organization, preamble
     - Diarienummer-prefix: D (Lerum)
     - Kan delvis skrapas utan Puppeteer (första 10 poster)

  3. INLINE sv-text-portlet (Munkedal)
     - Detaljsidor med #Ingress (ärende) och #Text-0 (datum)
     - Data i <strong> utan konsekvent struktur
     - Diarienummer-prefix: SBFV (Munkedal)

  4. INGEN DATA (Mölndal) — JS-renderad, kräver Puppeteer

  KONKLUSION:
  Det finns INGEN gemensam HTML-struktur mellan SiteVision-kommuner.
  Varje kommun konfigurerar SiteVision olika. Men detaljsidorna delar
  ett mönster: <strong>etikett:</strong> värde. En generisk parser som
  hämtar detaljsidor och extraherar label:value-par från <strong>-taggar
  kan fungera som bas, med kommun-specifik konfiguration för:
  - URL till listningssida
  - CSS-selektor för att hitta länkar till detaljsidor
  - Diarienummer-prefix (BN, GRMB, SBFV, D, etc.)
`);
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
