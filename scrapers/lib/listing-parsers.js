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
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Determine base URL for resolving relative paths
  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;

  // Default selectors: common SiteVision link patterns for bygglov detail pages
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

      // Skip anchors, javascript:, mailto:, and external links
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;

      // Resolve relative URLs
      if (href.startsWith('/')) {
        href = baseUrl + href;
      } else if (!href.startsWith('http')) {
        href = baseUrl + '/' + href;
      }

      // Skip links back to the listing page itself
      if (href === url || href === url + '/') return;

      // Skip links to other domains
      try {
        const linkHost = new URL(href).host;
        if (linkHost !== parsed.host) return;
      } catch { return; }

      // Deduplicate
      if (seen.has(href)) return;
      seen.add(href);

      // Filter by keyword unless skipFilter is set
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

module.exports = {
  parseSitevisionListing,
  parseSitevisionAppRegistry,
  parseSitevisionInline,
  filterBygglovItems,
  BYGGLOV_RE,
};
