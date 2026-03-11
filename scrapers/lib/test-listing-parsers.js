#!/usr/bin/env node
/**
 * test-listing-parsers.js
 *
 * Integration test: listing → detail page parsing for Borås and Grästorp.
 * Fetches listing, filters bygglov links, parses each detail page.
 */

const { parseSitevisionListing } = require('./listing-parsers');
const { parseDetailPage } = require('./detail-page-parser');

const TESTS = [
  {
    kommun: 'Borås',
    url: 'https://www.boras.se/anslagstavla',
    linkSelector: 'a[href*="kungorelsebygglov"]',
  },
  {
    kommun: 'Grästorp',
    url: 'https://www.grastorp.se/kommun-och-politik/anslagstavla',
    linkSelector: ['a[href*="kungorelse-bygglov"]', 'a[href*="kungorelse--bygglov"]'],
  },
];

async function testKommun(test) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${test.kommun} — ${test.url}`);
  console.log(`${'─'.repeat(60)}`);

  // Step 1: Get listing links
  const links = await parseSitevisionListing(test.url, {
    linkSelector: test.linkSelector,
    skipFilter: true, // selector already filters on "kungorelsebygglov"/"kungorelse-bygglov"
  });

  console.log(`Listning: ${links.length} bygglovsärenden hittade`);

  if (links.length === 0) {
    console.log('  (inga länkar)');
    return { kommun: test.kommun, found: 0, parsed: 0 };
  }

  // Step 2: Parse each detail page
  let parsed = 0;
  let failed = 0;

  for (const url of links) {
    try {
      const result = await parseDetailPage(url);

      if (result.diarienummer && result.fastighetsbeteckning) {
        parsed++;
        console.log(`  ✓ ${result.diarienummer} — ${result.fastighetsbeteckning}${result.adress ? ' (' + result.adress + ')' : ''} — ${result.status || '?'} — ${result.beslutsdatum || '?'}`);
      } else {
        failed++;
        const missing = [];
        if (!result.diarienummer) missing.push('diarienummer');
        if (!result.fastighetsbeteckning) missing.push('fastighet');
        console.log(`  ⚠ ${result.title?.slice(0, 60) || url} — saknar: ${missing.join(', ')}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ${url.split('/').pop()} — ${err.message}`);
    }
  }

  const summary = `${test.kommun}: ${links.length} bygglovsärenden hittade, ${parsed} lyckades parsas`;
  if (failed > 0) {
    console.log(`\n  ${summary} (${failed} misslyckades)`);
  } else {
    console.log(`\n  ${summary}`);
  }

  return { kommun: test.kommun, found: links.length, parsed, failed };
}

async function main() {
  console.log('=== Listing + Detail Parser Integration Test ===');

  const results = [];
  for (const test of TESTS) {
    results.push(await testKommun(test));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('SAMMANFATTNING');
  console.log(`${'─'.repeat(60)}`);
  for (const r of results) {
    console.log(`  ${r.kommun}: ${r.found} hittade, ${r.parsed} parsade`);
  }
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
