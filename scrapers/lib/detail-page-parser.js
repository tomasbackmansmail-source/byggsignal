/**
 * detail-page-parser.js
 *
 * Generic parser for SiteVision detail pages (kungörelser/bygglov).
 * Handles two main patterns:
 *   1. <strong>Label:</strong> value  (Grästorp-style, separate <p> per field)
 *   2. Plain text "Label: value<br>"  (Borås-style, single <p> with <br> separators)
 *
 * Also extracts åtgärd + fastighet from h1 title.
 *
 * Usage:
 *   const { parseDetailPage } = require('./detail-page-parser');
 *   const result = await parseDetailPage('https://www.grastorp.se/...');
 */

const cheerio = require('cheerio');

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

// Label → field mapping
const FIELD_PATTERNS = [
  { field: 'diarienummer',         re: /diarienummer|dnr|ärendenummer|beslutsnummer|bestlutsnummer/i },
  { field: 'fastighetsbeteckning', re: /fastighet(?:sbeteckning)?/i },
  { field: 'adress',               re: /^adress$|^gatuadress$/i },
  { field: 'atgard',               re: /åtgärd|ärendet?\s*avser|beslutet\s*gäller/i },
  { field: 'beslutsdatum',         re: /beslutsdatum|datum\s*för\s*beslut/i },
  { field: 'status',               re: /^beslut(?:styp)?$|^status$/i },
  { field: 'sokande',              re: /sökande|byggherre/i },
  { field: '_arende',              re: /^ärende$/i },
  { field: '_beslut',              re: /^beslut$/i },
];

function matchField(label) {
  const trimmed = label.replace(/[:\s]+$/, '').trim();
  for (const { field, re } of FIELD_PATTERNS) {
    if (re.test(trimmed)) return field;
  }
  return null;
}

/**
 * Pattern 1: <strong>Label:</strong> value in <p> tags (Grästorp-style)
 */
function extractStrongLabelPairs($) {
  const pairs = {};

  $('strong').each((_, el) => {
    const $strong = $(el);
    const label = $strong.text().trim();
    const field = matchField(label);
    if (!field) return;

    // Value is sibling text after the <strong> tag within the same parent
    const parent = $strong.parent();
    const parentHtml = parent.html() || '';
    const strongHtml = $.html($strong);
    const afterStrong = parentHtml.split(strongHtml).slice(1).join('');
    // Strip remaining HTML tags, take first line
    const value = afterStrong
      .replace(/<[^>]+>/g, '')
      .replace(/^[:\s]+/, '')
      .trim()
      .split('\n')[0]
      .trim();

    if (value && !pairs[field]) {
      pairs[field] = value;
    }
  });

  return pairs;
}

/**
 * Pattern 1b: <h2>Label</h2><p>value</p> (Stenungsund/Munkedal-style)
 * Heading acts as label, following <p> siblings contain the value.
 */
function extractHeadingLabelPairs($) {
  const pairs = {};

  $('h2, h3').each((_, el) => {
    const $heading = $(el);
    const label = $heading.text().trim();
    const field = matchField(label);
    if (!field) return;

    // Collect text from all <p> siblings until next heading
    const valueParts = [];
    let $next = $heading.next();
    while ($next.length && !$next.is('h2, h3')) {
      const text = $next.text().trim();
      if (text) valueParts.push(text);
      $next = $next.next();
    }

    const value = valueParts.join(' ').trim();
    if (value && !pairs[field]) {
      pairs[field] = value;
    }
  });

  return pairs;
}

/**
 * Pattern 2: Plain text "Label: value" separated by <br> (Borås-style)
 */
function extractPlainLabelValue($) {
  const pairs = {};

  // Look in .sv-text-portlet-content, #Ingress, or fall back to main content
  const containers = [
    '#Ingress .sv-text-portlet-content',
    '#Ingress',
    '.sv-text-portlet-content',
    'main',
  ];

  for (const selector of containers) {
    const $container = $(selector);
    if (!$container.length) continue;

    // Get HTML, split on <br> and newlines
    const html = $container.html() || '';
    const lines = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 1 || colonIdx > 40) continue;

      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      const field = matchField(label);

      if (field && value && !pairs[field]) {
        pairs[field] = value;
      }
    }

    if (Object.keys(pairs).length > 0) break;
  }

  return pairs;
}

/**
 * Extract åtgärd and fastighetsbeteckning from h1 title.
 * Common patterns:
 *   "Bygglov för [åtgärd], [FASTIGHET]"
 *   "Kungörelse — Bygglov för [åtgärd] på [FASTIGHET]"
 */
function extractFromTitle($) {
  // Find the best h1: prefer one containing "bygglov/rivningslov/kungörelse/marklov"
  let h1 = '';
  $('h1').each((_, el) => {
    const text = $(el).text().trim();
    if (/bygglov|rivningslov|marklov|förhandsbesked|kungörelse/i.test(text) && text.length > h1.length) {
      h1 = text;
    }
  });
  if (!h1) h1 = $('h1').first().text().trim();
  if (!h1) return {};

  const result = { _h1: h1 };

  // Extract åtgärd from "Bygglov för ..." or "Rivningslov för ..." etc.
  const atgardMatch = h1.match(/(?:bygglov|rivningslov|marklov|förhandsbesked)\s+för\s+(.+?)(?:,\s+[A-ZÅÄÖ]|\s+på\s+|$)/i);
  if (atgardMatch) {
    result.atgard = atgardMatch[1].trim().toLowerCase();
  }

  // Extract fastighet: uppercase word(s) followed by number:number pattern
  const fastighetMatch = h1.match(/([A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d+:\d+)/)
    || h1.match(/fastigheten\s+([A-ZÅÄÖa-zåäö][\wåäöÅÄÖ\s-]+\d+)/i);
  if (fastighetMatch) {
    result.fastighetsbeteckning = fastighetMatch[1].trim();
  }

  // Also look for free-text paragraphs describing the decision
  const freeText = [];
  $('p.normal, .sv-text-portlet-content p').each((_, el) => {
    const text = $(el).text().trim();
    if (/beviljas|beviljat|avslås|avslag|startbesked/i.test(text) && text.length > 20 && text.length < 500) {
      freeText.push(text);
    }
  });

  if (freeText.length > 0 && !result.atgard) {
    const descMatch = freeText[0].match(/(?:bygglov|rivningslov|marklov)\s+(?:beviljas\s+)?för\s+(.+?)(?:\.|,\s+på\s+fastigheten)/i);
    if (descMatch) {
      result.atgard = descMatch[1].trim().toLowerCase();
    }
  }

  return result;
}

/**
 * Normalize extracted field values.
 */
function normalizeFields(raw) {
  const result = { ...raw };

  // Diarienummer regex — covers all known prefixes
  const DNR_RE = /((?:MBN-B|BN|SBN|BMN|MBN|BYGG|BoM|SBF|MHN|SBFV|GRMB|B|D)\s*[-.]?\s*\d{4}[-.\s/]*\d+)/i;

  // Split compound "Ärende" field: "Ansökan om bygglov för X på FASTIGHET (ADRESS), Diarienummer Y"
  // or Munkedal-style: "Tillbyggnad uterum, STALE 3:49 SBFV 2026-47"
  if (result._arende) {
    const val = result._arende;

    // Extract diarienummer from ärende text
    if (!result.diarienummer) {
      const dnr = val.match(DNR_RE);
      if (dnr) result.diarienummer = dnr[1];
    }

    // Extract fastighet: UPPERCASE WORD(S) number:number
    if (!result.fastighetsbeteckning) {
      const fast = val.match(/([A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d+:\d+)/);
      if (fast) result.fastighetsbeteckning = fast[1].trim();
    }

    // Extract adress from parentheses: (ÅLSTIGEN 15)
    if (!result.adress) {
      const addr = val.match(/\(([^)]+)\)/);
      if (addr && /\d/.test(addr[1])) result.adress = addr[1].trim();
    }

    // Extract åtgärd
    if (!result.atgard) {
      const atg = val.match(/(?:bygglov|rivningslov|marklov|förhandsbesked)\s+för\s+(.+?)(?:\s+på\s+[A-ZÅÄÖ]|,\s+[A-ZÅÄÖ]|\s+Diarienummer|$)/i);
      if (atg) result.atgard = atg[1].trim().toLowerCase();
    }

    delete result._arende;
  }

  // Split compound "Beslut" field: extract beslutsdatum from text like "6 mars 2026"
  if (result._beslut) {
    const val = result._beslut;

    if (!result.beslutsdatum) {
      // ISO date
      const iso = val.match(/(\d{4}-\d{2}-\d{2})/);
      if (iso) {
        result.beslutsdatum = iso[1];
      } else {
        // Swedish date: "6 mars 2026"
        const sv = val.match(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/i);
        if (sv) result.beslutsdatum = sv[0]; // will be normalized below
      }
    }

    delete result._beslut;
  }

  // Clean diarienummer: extract just the code (e.g. "BN 2026-000123")
  if (result.diarienummer) {
    const dnrMatch = result.diarienummer.match(DNR_RE);
    if (dnrMatch) {
      result.diarienummer = dnrMatch[1].replace(/\s+/g, ' ').trim();
    }
  }

  // If status looks like a date, it was mis-mapped — move to beslutsdatum
  if (result.status && /\d{4}-\d{2}-\d{2}/.test(result.status) && !result.beslutsdatum) {
    result.beslutsdatum = result.status;
    result.status = null;
  }
  if (result.status && /\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+\d{4}/i.test(result.status) && !result.beslutsdatum) {
    result.beslutsdatum = result.status;
    result.status = null;
  }

  // Normalize datum: "26 februari 2026" → "2026-02-26"
  if (result.beslutsdatum && !/\d{4}-\d{2}-\d{2}/.test(result.beslutsdatum)) {
    const months = {
      januari: '01', februari: '02', mars: '03', april: '04',
      maj: '05', juni: '06', juli: '07', augusti: '08',
      september: '09', oktober: '10', november: '11', december: '12',
    };
    const m = result.beslutsdatum.match(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/i);
    if (m) {
      result.beslutsdatum = `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    }
  }

  // Extract just the date if there's extra text
  if (result.beslutsdatum) {
    const dateMatch = result.beslutsdatum.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) result.beslutsdatum = dateMatch[0];
  }

  // Clean up fastighet: sometimes includes address after comma
  if (result.fastighetsbeteckning && !result.adress) {
    const parts = result.fastighetsbeteckning.split(',');
    if (parts.length >= 2) {
      // Check if second part looks like an address (contains a number)
      const possibleAddr = parts.slice(1).join(',').trim();
      if (/\d/.test(possibleAddr) && /[a-zåäö]/i.test(possibleAddr)) {
        result.fastighetsbeteckning = parts[0].trim();
        result.adress = possibleAddr;
      }
    }
  }

  return result;
}

/**
 * Parse a SiteVision detail page.
 *
 * @param {string} url — URL to the detail page
 * @returns {Promise<{diarienummer, fastighetsbeteckning, adress, atgard, status, beslutsdatum, sokande, sourceUrl, title}>}
 */
async function parseDetailPage(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Try all extraction patterns
  const strongPairs = extractStrongLabelPairs($);
  const headingPairs = extractHeadingLabelPairs($);
  const plainPairs = extractPlainLabelValue($);
  const titleData = extractFromTitle($);

  // Merge: strong > heading > plain > title (most specific wins)
  const merged = {
    diarienummer: null,
    fastighetsbeteckning: null,
    adress: null,
    atgard: null,
    status: null,
    beslutsdatum: null,
    sokande: null,
    ...titleData,
    ...plainPairs,
    ...headingPairs,
    ...strongPairs,
    sourceUrl: url,
    title: titleData._h1 || $('h1').first().text().trim() || null,
  };

  // Infer status from page text if not explicitly found
  if (!merged.status) {
    const bodyText = $('main').text() || $('body').text();
    if (/startbesked/i.test(bodyText)) merged.status = 'startbesked';
    else if (/avslag|avslås/i.test(bodyText)) merged.status = 'avslag';
    else if (/beviljas|beviljat|beviljad/i.test(bodyText)) merged.status = 'beviljat';
    else if (/grannhörande|grannehörande|underrättelse/i.test(bodyText)) merged.status = 'ansökt';
  }

  return normalizeFields(merged);
}

module.exports = { parseDetailPage, fetchHtml, extractStrongLabelPairs, extractPlainLabelValue, extractFromTitle };
