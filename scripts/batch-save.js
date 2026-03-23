#!/usr/bin/env node
/**
 * Batch --save for all configs that found data in dry-run.
 * Reads /tmp/dryrun-found.json and runs each with --save.
 */
require('dotenv').config({quiet: true});
const { execSync } = require('child_process');
const fs = require('fs');

const SCRAPER_MAP = {
  sitevision: 'scrapers/scrape-sitevision.js',
  wordpress: 'scrapers/scrape-wordpress.js',
  netpublicator: 'scrapers/scrape-netpublicator.js',
  ciceron: 'scrapers/scrape-ciceron.js',
  pollux: 'scrapers/scrape-pollux.js',
  limepark: 'scrapers/scrape-limepark.js',
  meetingsplus: 'scrapers/scrape-meetingsplus.js',
};

const found = JSON.parse(fs.readFileSync('/tmp/dryrun-found.json', 'utf-8'));
console.log(`Saving ${found.length} configs...\n`);

const results = { saved: [], failed: [] };

for (let i = 0; i < found.length; i++) {
  const { kommun, platform, count, configFile } = found[i];
  const scraper = SCRAPER_MAP[platform];

  process.stdout.write(`[${i+1}/${found.length}] ${kommun} (${platform}, ~${count} permits)... `);

  try {
    const output = execSync(`node ${scraper} --save --config ${configFile}`, {
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    // Count actual saves
    const savedMatch = output.match(/(\d+) (lyckades|permits|saved|sparad)/i);
    const savedCount = savedMatch ? parseInt(savedMatch[1]) : count;
    results.saved.push({ kommun, platform, count: savedCount });
    console.log(`✓ saved`);
  } catch(e) {
    const msg = e.stderr ? e.stderr.slice(0, 100) : e.message.slice(0, 100);
    results.failed.push({ kommun, platform, error: msg.split('\n')[0] });
    console.log(`✗ ${msg.split('\n')[0]}`);
  }
}

console.log('\n=== SAVE RESULTS ===');
console.log(`Successfully saved: ${results.saved.length}`);
console.log(`Failed: ${results.failed.length}`);

if (results.saved.length > 0) {
  console.log('\nSaved municipalities:');
  for (const s of results.saved) {
    console.log(`  ✓ ${s.kommun} (${s.platform}): ~${s.count} permits`);
  }
}

if (results.failed.length > 0) {
  console.log('\nFailed:');
  for (const f of results.failed) {
    console.log(`  ✗ ${f.kommun}: ${f.error}`);
  }
}

console.log(`\nNew municipalities with data: ${results.saved.length}`);
console.log(`Previous: 100, now: ${100 + results.saved.length}`);
