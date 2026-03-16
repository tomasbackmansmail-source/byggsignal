/**
 * listing-parsers.js
 *
 * Two listing parsers for SiteVision municipality bulletin boards:
 *
 * 1. parseSitevisionListing(url, options)
 *    - Fetches HTML listing page, finds links to detail pages
 *    - Filters by keyword in link text or URL
 *    - Returns array of absolute URLs
 *
 * 2. parseSitevisionAppRegistry(html, type)
 *    - Extracts JSON from AppRegistry embedded in HTML
 *    - Supports: announcements, initialNotices, pages, items
 *    - Returns array of structured objects
 *
 * Usage:
 *   const { parseSitevisionListing, parseSitevisionAppRegistry } = require('./listing-parsers');
 *   const urls = await parseSitevisionListing('https://www.boras.se/anslagstavla');
 *   const items = parseSitevisionAppRegistry(html, 'announcements');
 */

const cheerio = require('cheerio');
const { fetchHtml } = require('./detail-page-parser');

const BYGGLOV_RE = /bygglov|marklov|rivning|förhandsbesked|strandskydd|\bBN\b|\bBYGG\b|\bBMN\b|\bkungörelse\b/i;

// ── Puppeteer fallback for JS-rendered pages ────────────────────────────────

let _puppeteer = null;
function getPuppeteer() {
  if (!_puppeteer) _puppeteer = require('puppeteer');
  return _puppeteer;
}

async function fetchHtmlWithPuppeteer(url) {
  const puppeteer = getPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; ByggSignal/1.0)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    // Wait for content to appear — try common SiteVision containers
    await page.waitForSelector('a[href], .sv-channel-item, .sv-text-portlet', { timeout: 10000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}

// ── Extract links from HTML (shared by fetch and Puppeteer paths) ───────────

function stripWww(host) {
  return host.replace(/^www\./, '');
}

function extractLinksFromHtml(html, url, options = {}) {
  const $ = cheerio.load(html);
  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const configHost = stripWww(parsed.host);

  const selectors = options.linkSelector
    ? (Array.isArray(options.linkSelector) ? options.linkSelector : [options.linkSelector])
    : [
        'a[href*="bygglov"]',
        'a[href*="kungorelse"]',
        'a[href*="kungörelse"]',
        'a[href*="/anslagstavla/"]',
        'a[href*="/anslagstavlan/"]',
      ];

  const filter = options.filter || BYGGLOV_RE;
  const seen = new Set();
  const links = [];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      if (href.startsWith('/')) {
        href = baseUrl + href;
      } else if (!href.startsWith('http')) {
        href = baseUrl + '/' + href;
      }
      if (href === url || href === url + '/') return;
      try {
        const linkHost = stripWww(new URL(href).host);
        if (linkHost !== configHost) return;
      } catch { return; }
      if (seen.has(href)) return;
      seen.add(href);
      if (!options.skipFilter) {
        const linkText = $(el).text().trim();
        const testString = linkText + ' ' + href;
        if (!filter.test(testString)) return;
      }
      links.push(href);
    });
  }

  return links;
}

/**
 * Pattern 1: HTML listing page → extract detail page links.
 *
 * @param {string} url — listing page URL
 * @param {object} [options]
 * @param {string|string[]} [options.linkSelector] — CSS selector(s) for links
 * @param {RegExp} [options.filter] — regex to match against link text + href (default: BYGGLOV_RE)
 * @param {boolean} [options.skipFilter] — if true, return all matched links without keyword filtering
 * @returns {Promise<string[]>} — array of absolute URLs
 */
async function parseSitevisionListing(url, options = {}) {
  // Step 1: Try fast plain fetch
  const html = await fetchHtml(url);
  const links = extractLinksFromHtml(html, url, options);

  if (links.length > 0) {
    return links;
  }

  // Step 2: No links found — try Puppeteer for JS-rendered pages
  console.error('  Vanlig fetch: 0 ärenden, försöker Puppeteer...');
  try {
    const puppeteerHtml = await fetchHtmlWithPuppeteer(url);
    const puppeteerLinks = extractLinksFromHtml(puppeteerHtml, url, options);
    console.error(`  Puppeteer: ${puppeteerLinks.length} ärenden hittade`);
    return puppeteerLinks;
  } catch (err) {
    console.error(`  Puppeteer misslyckades: ${err.message}`);
    return [];
  }
}

/**
 * Pattern 2: Extract structured data from SiteVision AppRegistry.
 *
 * @param {string} html — full HTML of the listing page
 * @param {string} [type] — portlet type to look for:
 *   "announcements" (Knivsta), "initialNotices" (Enköping),
 *   "pages" (Lerum), "items" (generic), or null (auto-detect)
 * @returns {{ key: string, type: string, items: object[] } | null}
 */
function parseSitevisionAppRegistry(html, type) {
  const re = /AppRegistry\.registerInitialState\('([^']+)',\s*([\s\S]+?)\);\s*(?:AppRegistry|<\/script)/g;
  let match;

  // Type → array field name mapping
  const typeFields = {
    announcements: 'announcements',
    initialNotices: 'initialNotices',
    pages: 'pages',
    articles: 'articles',
    items: 'items',
  };

  // Auto-detect order when no type specified
  const searchOrder = type
    ? [type]
    : ['announcements', 'articles', 'initialNotices', 'pages'];

  while ((match = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[2]);

      for (const t of searchOrder) {
        const fieldName = typeFields[t] || t;
        if (Array.isArray(json[fieldName])) {
          return {
            key: match[1],
            type: t,
            items: json[fieldName].map(item => normalizeAppRegistryItem(item, t)),
          };
        }
      }
    } catch (_) {
      // JSON parse failed — skip this key
    }
  }

  return null;
}

/**
 * Normalize an AppRegistry item to a common shape.
 */
function normalizeAppRegistryItem(item, type) {
  const base = {
    title: item.title || item.header || null,
    url: item.uri || item.url || null,
    published: item.published || item.publishDate || null,
  };

  switch (type) {
    case 'announcements':
      return {
        ...base,
        organ: item.organ || null,
        freeText: item.freeText || null,
        type: item.type || null,
      };

    case 'initialNotices':
      return {
        ...base,
        authority: item.authority || null,
        htmlContent: item.htmlContent || null,
        type: item.type || null,
      };

    case 'pages':
      return {
        ...base,
        organization: item.organization || null,
        preamble: item.preamble || null,
        subject: item.subject || null,
        fromDate: item.fromDate || null,
        toDate: item.toDate || null,
      };

    case 'articles':
      return {
        ...base,
        organ: item.organ || null,
        freeText: item.freeText || null,
      };

    default:
      return { ...base, ...item };
  }
}

/**
 * Filter AppRegistry items for bygglov-related entries.
 *
 * @param {object[]} items — normalized AppRegistry items
 * @returns {object[]}
 */
function filterBygglovItems(items) {
  return items.filter(item => {
    const text = [
      item.title, item.freeText, item.type, item.organ,
      item.authority, item.htmlContent, item.preamble,
      item.subject, item.organization,
    ].filter(Boolean).join(' ');
    return BYGGLOV_RE.test(text);
  });
}

/**
 * Pattern 3: Inline bulletin board — data is embedded directly on the page,
 * not behind detail-page links. Covers several SiteVision layout variants:
 *
 *   a) lp-bulletin-board__list-item  (Halmstad, Sandviken, Älmhult)
 *   b) Accordion/expandable sections (Västerås, Håbo, Malung-Sälen)
 *   c) h3/h4 structured blocks       (Ljungby)
 *   d) sv-text-portlet with styling   (Markaryd)
 *
 * Returns parsed permit objects directly (no detail-page fetch needed).
 *
 * @param {string} url — listing page URL
 * @returns {Promise<object[]>} — array of { diarienummer, fastighetsbeteckning, adress, atgard, status, beslutsdatum, sourceUrl }
 */
async function parseSitevisionInline(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  // --- Strategy A: lp-bulletin-board items ---
  $('li.lp-bulletin-board__list-item').each((_, el) => {
    const $item = $(el);
    const heading = $item.find('.lp-bulletin-board__list-item__heading').text().trim();
    const descHtml = $item.find('.lp-bulletin-board__list-item__description').html() || '';
    const fullText = heading + ' ' + descHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    if (BYGGLOV_RE.test(fullText)) {
      items.push(parseInlineBlock(heading, descHtml, url));
    }
  });

  if (items.length > 0) return items.filter(Boolean);

  // --- Strategy B: Accordion sections (expandable divs) ---
  // Covers: sv-text-portlet-content (Västerås), msk-accordion__content (Malung-Sälen),
  //         sv-portlet divs (Markaryd), and generic styled divs
  const portletSections = [];
  const contentSelectors = [
    'div.sv-text-portlet-content',
    'div[class*="accordion__content"]',
    'div.sv-text-portlet[style*="background"]',
  ];
  $(contentSelectors.join(', ')).each((_, el) => {
    const $section = $(el);
    const text = $section.text().trim();
    if (BYGGLOV_RE.test(text) && text.length > 30) {
      // Get heading from parent or preceding heading
      let heading = '';
      const $parent = $section.closest('.env-collapse, [class*="collapsible"], [class*="accordion"], .sv-portlet, .sv-layout');
      if ($parent.length) {
        heading = $parent.find('h4, h3, button').first().text().trim()
          .replace(/\s+/g, ' ');
      }
      if (!heading) {
        heading = $section.find('h1, h2, h3').first().text().trim();
      }
      portletSections.push({ heading, html: $section.html() || '', text });
    }
  });

  // Deduplicate by text content (nested elements may repeat)
  const seenTexts = new Set();
  for (const sec of portletSections) {
    const key = sec.text.slice(0, 100);
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    const parsed = parseInlineBlock(sec.heading, sec.html, url);
    if (parsed) items.push(parsed);
  }

  if (items.length > 0) return items.filter(Boolean);

  // --- Strategy C: h3 headings with h4 label / p value pairs (Ljungby) ---
  const h3Items = [];
  $('h3').each((_, el) => {
    const $h3 = $(el);
    const title = $h3.text().trim();
    if (!BYGGLOV_RE.test(title) && title.length < 10) return;

    // Collect h4/p pairs following this h3 until next h3
    const fields = {};
    fields._title = title;
    let $next = $h3.next();
    let lastLabel = null;
    while ($next.length && !$next.is('h3')) {
      if ($next.is('h4')) {
        lastLabel = $next.text().replace(/[:\s]+$/, '').trim();
      } else if ($next.is('p') && lastLabel) {
        fields[lastLabel.toLowerCase()] = $next.text().trim();
        lastLabel = null;
      }
      $next = $next.next();
    }

    if (fields.diarienummer || fields.ärendenummer) {
      const dnr = fields.diarienummer || fields.ärendenummer;
      const fast = fields.fastighet || null;
      h3Items.push({
        diarienummer: dnr,
        fastighetsbeteckning: fast,
        adress: null,
        atgard: extractAtgard(title),
        status: inferStatus(title + ' ' + Object.values(fields).join(' ')),
        beslutsdatum: null,
        sourceUrl: url,
      });
    }
  });

  if (h3Items.length > 0) return h3Items;

  // --- Strategy D: Expandable notice sections (Enköping-style) ---
  // JS-rendered page with clickable div.header.notice-* headers.
  // Requires Puppeteer to click headers and read expanded content.
  try {
    const noticeItems = await parseSitevisionNoticeExpand(url);
    if (noticeItems.length > 0) return noticeItems;
  } catch (err) {
    console.error(`  Strategy D (notice-expand): ${err.message}`);
  }

  return items.filter(Boolean);
}

// --- Helpers for inline parsing ---

const DNR_RE = /((?:VGS-BYGG|MBN-B|BN|SBN|BMN|MBN|BYGG|BoM|SBF|MHN|SBFV|GRMB|BY|BM|MBE|B|D)\s*[-./]?\s*\d{4}[-.\s/:]*\d+)/i;

const FASTIGHET_RE = /(?:fastighet(?:en)?[:\s]+)?([A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d+[:\s]\d+)/;
const FASTIGHET_RE2 = /fastigheten\s+([A-ZÅÄÖa-zåäö][\wåäöÅÄÖ\s-]+\d+[:\s]\d+)/i;

const DATUM_RE = /(\d{4}-\d{2}-\d{2})/;

function extractAtgard(text) {
  const m = text.match(/(?:bygglov|rivningslov|marklov|förhandsbesked)\s+för\s+(.+?)(?:\s+(?:på|har|,\s*[A-ZÅÄÖ])|\s*$)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function inferStatus(text) {
  if (/beviljats|beviljat|beviljas|beviljar/i.test(text)) return 'beviljat';
  if (/avslag|avslås/i.test(text)) return 'avslag';
  if (/startbesked/i.test(text)) return 'startbesked';
  if (/grannhörande|grannar|yttra|synpunkter/i.test(text)) return 'ansökt';
  if (/ansökan\s+om/i.test(text)) return 'ansökt';
  if (/meddelande\s+om\s+beslut/i.test(text)) return 'beviljat';
  return 'beviljat'; // default for published decisions on anslagstavla
}

/**
 * Parse a single inline block (heading + description HTML) into a permit object.
 */
function parseInlineBlock(heading, descHtml, sourceUrl) {
  const descText = descHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fullText = (heading + ' ' + descText).trim();

  // Extract diarienummer
  let diarienummer = null;
  const dnrLabeled = fullText.match(/(?:diarienummer|diarienr|ärendenummer|ärende)\s*[:\s]+\s*([A-Za-zÅÄÖåäö]*[-.\s/]?\d{4}[-.\s/:]*\d+)/i);
  if (dnrLabeled) {
    const m = dnrLabeled[1].match(DNR_RE) || [null, dnrLabeled[1].trim()];
    diarienummer = m[1];
  }
  if (!diarienummer) {
    // "ärende BY 2026-000112, Bygglov för..."
    const dnrInline = fullText.match(/ärende\s+((?:BY|BN|BYGG|BM|MBE|VGS-BYGG)\s*[-./]?\s*\d{4}[-.\s/:]*\d+)/i);
    if (dnrInline) diarienummer = dnrInline[1];
  }
  if (!diarienummer) {
    const dnrFallback = fullText.match(DNR_RE);
    if (dnrFallback) diarienummer = dnrFallback[1];
  }

  if (!diarienummer) return null;

  // Clean up diarienummer
  diarienummer = diarienummer.replace(/\s+/g, ' ').trim();

  // Extract fastighet
  let fastighetsbeteckning = null;
  const fastLabeled = fullText.match(/fastighet(?:en)?[:\s]+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s-]+\d+[:\s]\d+)/i);
  if (fastLabeled) {
    fastighetsbeteckning = fastLabeled[1].trim();
  }
  if (!fastighetsbeteckning) {
    // "Bygglov för X på Västra Sälen 7:22" or "på fastigheten Tidö 1:63"
    // Match: "på" + optional words + UPPERCASE_START word(s) + number:number
    const fastPa = fullText.match(/\bpå\s+(?:fastigheten\s+)?([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s-]*\s+\d+[:\s]\d+)/);
    if (fastPa) fastighetsbeteckning = fastPa[1].trim();
  }
  if (!fastighetsbeteckning) {
    // "fastigheten Svedjan 4" (Västerås — short names without colon)
    const fastSimple = fullText.match(/fastigheten\s+([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ][a-zåäö]+)*\s+\d+(?::\d+)?)/);
    if (fastSimple) fastighetsbeteckning = fastSimple[1].trim();
  }
  if (!fastighetsbeteckning) {
    // From heading: "Beslut om bygglov FASTIGHETSNAMN 1:23 (Adress)"
    const fastHeading = heading.match(/([A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d+:\d+)/);
    if (fastHeading) fastighetsbeteckning = fastHeading[1].trim();
  }

  // Extract adress from parentheses after fastighet
  let adress = null;
  if (fastighetsbeteckning) {
    const afterFast = fullText.split(fastighetsbeteckning)[1] || '';
    const addrMatch = afterFast.match(/^\s*\(([^)]+)\)/);
    if (addrMatch && /[a-zåäö]/i.test(addrMatch[1]) && /\d/.test(addrMatch[1])) {
      adress = addrMatch[1].trim();
    }
  }

  // Extract åtgärd
  const atgard = extractAtgard(fullText);

  // Extract beslutsdatum
  let beslutsdatum = null;
  const datumLabeled = fullText.match(/(?:beslutsdatum|datum\s+för\s+beslut)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  if (datumLabeled) {
    beslutsdatum = datumLabeled[1];
  }
  if (!beslutsdatum) {
    // "har beviljats, 2026-03-13" or "har beviljats 2026-03-13"
    const datumInline = fullText.match(/(?:beviljats?|beviljat)\s*,?\s*(\d{4}-\d{2}-\d{2})/i);
    if (datumInline) beslutsdatum = datumInline[1];
  }

  // Status
  const status = inferStatus(fullText);

  return {
    diarienummer,
    fastighetsbeteckning,
    adress,
    atgard,
    status,
    beslutsdatum,
    sourceUrl,
  };
}

// ── Strategy D: Puppeteer-based expandable notice sections (Enköping) ────────
// Structure: article.notice > div.notice-header > div.header (clickable) + h3
//            article.notice > div.expandable (appears after click)

async function parseSitevisionNoticeExpand(url) {
  console.error('  Strategy D: Puppeteer expandable notices...');
  const puppeteer = getPuppeteer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; ByggSignal/1.0)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait for notice articles to render
    const hasNotices = await page.waitForSelector('article.notice', { timeout: 10000 }).catch(() => null);
    if (!hasNotices) return [];

    // Click all notice headers to expand them
    const count = await page.evaluate(() => {
      const headers = document.querySelectorAll('article.notice div.header');
      headers.forEach(h => h.click());
      return headers.length;
    });
    console.error(`  ${count} notice-headers klickade, väntar på expansion...`);

    // Wait for expandable content to render
    await new Promise(r => setTimeout(r, 2500));

    // Extract data from each expanded article directly in browser
    const extracted = await page.evaluate(() => {
      const re = /bygglov|marklov|rivning|förhandsbesked|strandskydd|\bBN\b|\bBYGG\b|\bBMN\b|\bkungörelse\b/i;
      const articles = document.querySelectorAll('article.notice');
      const results = [];
      for (const a of articles) {
        const h3 = a.querySelector('h3');
        const title = h3 ? h3.textContent.trim() : '';
        const tags = [...a.querySelectorAll('span.tag')].map(t => t.textContent.trim());
        if (!re.test(title + ' ' + tags.join(' '))) continue;

        const exp = a.querySelector('div.expandable');
        if (!exp || exp.offsetHeight === 0) continue;

        results.push({ title, text: exp.textContent.trim() });
      }
      return results;
    });

    console.error(`  ${extracted.length} bygglov-relaterade notices med expanderat innehåll`);

    // Parse each extracted notice
    return extracted.map(e => parseNoticeText(e.title, e.text, url)).filter(Boolean);
  } finally {
    await browser.close();
  }
}

function parseNoticeText(title, text, sourceUrl) {
  const fullText = title + ' ' + text;

  // Extract diarienummer — two formats:
  //   "Diarienummer: BYGG 2025-801" or "Diarienr: Bygg 2025-000763"
  let diarienummer = null;
  const dnrLabeled = fullText.match(/(?:diarienummer|diarienr|diarenummer)[:\s]+([A-Za-zÅÄÖåäö\s]*\d{4}[-\s/:]*\d+)/i);
  if (dnrLabeled) {
    diarienummer = dnrLabeled[1].replace(/\s+/g, ' ').trim();
  }
  if (!diarienummer) {
    const dnrFallback = fullText.match(DNR_RE);
    if (dnrFallback) diarienummer = dnrFallback[1].replace(/\s+/g, ' ').trim();
  }
  if (!diarienummer) return null;

  // Extract fastighetsbeteckning — two formats:
  //   "Fastighetsbeteckning: Munksundet 61:2" (beslut)
  //   "område.Lillsidan 8:9Bygglov" or "område Skolsta 13:1Förlängning" (grannehörande)
  let fastighetsbeteckning = null;
  const fastLabeled = text.match(/Fastighetsbeteckning[:\s]+([A-ZÅÄÖa-zåäö][\wåäöÅÄÖ\s-]+\d+:\d+)/i);
  if (fastLabeled) {
    fastighetsbeteckning = fastLabeled[1].trim();
  }
  if (!fastighetsbeteckning) {
    // Unlabeled: fastighet name appears on its own between sentences
    // e.g. "detaljplanerat område.Lillsidan 8:9Bygglov" or "detaljplanerat områdeBergvreten 1:2Bygglov"
    const fastUnlabeled = text.match(/område\.?([A-ZÅÄÖ][A-ZÅÄÖa-zåäö\s-]+\d+:\d+)/);
    if (fastUnlabeled) fastighetsbeteckning = fastUnlabeled[1].trim();
  }

  // Extract beslutsdatum — "bifall YYYY-MM-DD" or "bifall: YYYY-MM-DD" or "bifall, YYYY-MM-DD"
  let beslutsdatum = null;
  const datumBifall = text.match(/bifall[,:\s]+(\d{4}-\d{2}-\d{2})/i);
  if (datumBifall) beslutsdatum = datumBifall[1];

  // Extract åtgärd from title
  const atgard = extractAtgard(title) || extractAtgard(text);

  // Status
  const status = inferStatus(fullText);

  return {
    diarienummer,
    fastighetsbeteckning,
    adress: null,
    atgard,
    status,
    beslutsdatum,
    sourceUrl,
  };
}

module.exports = {
  parseSitevisionListing,
  parseSitevisionAppRegistry,
  parseSitevisionInline,
  filterBygglovItems,
  BYGGLOV_RE,
};
