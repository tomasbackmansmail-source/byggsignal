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

module.exports = {
  parseSitevisionListing,
  parseSitevisionAppRegistry,
  filterBygglovItems,
  BYGGLOV_RE,
};
