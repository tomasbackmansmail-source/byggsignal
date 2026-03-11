#!/usr/bin/env node
/**
 * test-detail-parser.js
 *
 * Fetches listing pages from Borås and Grästorp, extracts detail page links,
 * then tests the detail-page-parser against real pages.
 */

const cheerio = require('cheerio');
const { parseDetailPage, fetchHtml } = require('./detail-page-parser');

const TESTS = [
  {
    kommun: 'Borås',
    listingUrl: 'https://www.boras.se/anslagstavla',
    linkSelector: 'a[href*="kungorelsebygglov"]',
    baseUrl: 'https://www.boras.se',
  },
  {
    kommun: 'Grästorp',
    listingUrl: 'https://www.grastorp.se/kommun-och-politik/anslagstavla',
    linkSelector: 'a[href*="kungorelse-bygglov"], a[href*="kungorelse--bygglov"]',
    baseUrl: 'https://www.grastorp.se',
  },
];

async function getDetailLinks(test) {
  const html = await fetchHtml(test.listingUrl);
  const $ = cheerio.load(html);
  const links = [];

  $(test.linkSelector).each((_, el) => {
    let href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('/')) href = test.baseUrl + href;
    if (!links.includes(href)) links.push(href);
  });

  return links;
}

async function main() {
  console.log('=== Detail Page Parser Test ===\n');

  for (const test of TESTS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${test.kommun} — ${test.listingUrl}`);
    console.log(`${'─'.repeat(60)}`);

    try {
      const links = await getDetailLinks(test);
      console.log(`Hittade ${links.length} detaljsidlänkar`);

      if (links.length === 0) {
        console.log('  (inga länkar matchade selektorn)');
        continue;
      }

      // Test up to 3 pages per kommun
      const toTest = links.slice(0, 3);
      for (const url of toTest) {
        console.log(`\n  → ${url}`);
        try {
          const result = await parseDetailPage(url);
          console.log(`    titel:        ${result.title || '—'}`);
          console.log(`    diarienummer:  ${result.diarienummer || '—'}`);
          console.log(`    fastighet:    ${result.fastighetsbeteckning || '—'}`);
          console.log(`    adress:       ${result.adress || '—'}`);
          console.log(`    åtgärd:       ${result.atgard || '—'}`);
          console.log(`    status:       ${result.status || '—'}`);
          console.log(`    beslutsdatum: ${result.beslutsdatum || '—'}`);
          console.log(`    sökande:      ${result.sokande || '—'}`);

          // Validate minimum fields
          const fields = ['diarienummer', 'fastighetsbeteckning'];
          const missing = fields.filter(f => !result[f]);
          if (missing.length > 0) {
            console.log(`    ⚠ SAKNAR: ${missing.join(', ')}`);
          } else {
            console.log(`    ✓ OK`);
          }
        } catch (err) {
          console.log(`    ✗ FEL: ${err.message}`);
        }
      }
    } catch (err) {
      console.log(`  FEL vid hämtning av listningssida: ${err.message}`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('Test klart.');
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
