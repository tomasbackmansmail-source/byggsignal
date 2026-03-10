#!/usr/bin/env node
// scripts/run-all-scrapers.js
// Kör alla scraper-*.js i root-katalogen sekventiellt.
// Exit 0 om minst en lyckades, exit 1 om alla misslyckades.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// Hitta alla scraper-filer i root
const scraperFiles = fs.readdirSync(ROOT)
  .filter(f => /^scraper-[a-z].*\.js$/.test(f))
  .sort()
  .map(f => path.join(ROOT, f));

if (scraperFiles.length === 0) {
  console.error('Inga scraper-filer hittades i', ROOT);
  process.exit(1);
}

console.log(`Hittade ${scraperFiles.length} scrapers. Startar...\n`);

// Bygg NODE_OPTIONS: lägg till CI-patch utan att krocka med befintliga --require
const existingNodeOptions = process.env.NODE_OPTIONS || '';
const ciPatch = path.join(__dirname, 'puppeteer-ci-patch.js');
const nodeOptions = `--require ${ciPatch}${existingNodeOptions ? ' ' + existingNodeOptions : ''}`;

let successes = 0;
let failures = 0;

for (const scraperPath of scraperFiles) {
  const name = path.basename(scraperPath, '.js').replace('scraper-', '');
  const label = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');

  console.log(`──────────────────────────────`);
  console.log(`Kör: ${label}`);
  console.log(`File: ${path.basename(scraperPath)}`);

  const start = Date.now();

  const result = spawnSync('node', [scraperPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    },
    encoding: 'utf8',
    timeout: 5 * 60 * 1000, // 5 min per scraper
    maxBuffer: 10 * 1024 * 1024,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0 && result.error == null) {
    console.log(`${label}: OK (${elapsed}s)\n`);
    successes++;
  } else {
    const reason = result.error
      ? result.error.message
      : `exit code ${result.status}`;
    console.error(`${label}: FEL — ${reason} (${elapsed}s)\n`);
    failures++;
    // Fortsätt med nästa scraper
  }
}

console.log(`══════════════════════════════`);
console.log(`Scraping klar: ${successes} lyckades, ${failures} misslyckades`);

process.exit(successes > 0 ? 0 : 1);
