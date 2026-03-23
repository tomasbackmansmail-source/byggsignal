#!/usr/bin/env node
/**
 * Batch dry-run all configs with 0 data in DB.
 * Runs each scraper with --dry-run, captures output, reports results.
 * Usage: node scripts/batch-dryrun-v3.js
 */
require('dotenv').config({quiet: true});
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRAPER_MAP = {
  sitevision: 'scrapers/scrape-sitevision.js',
  wordpress: 'scrapers/scrape-wordpress.js',
  netpublicator: 'scrapers/scrape-netpublicator.js',
  ciceron: 'scrapers/scrape-ciceron.js',
  pollux: 'scrapers/scrape-pollux.js',
  limepark: 'scrapers/scrape-limepark.js',
  meetingsplus: 'scrapers/scrape-meetingsplus.js',
};

// Get all config files
function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.name.endsWith('.json')) results.push(full);
  }
  return results;
}

const dbKommuner = new Set(['Arvidsjaur','Askersund','Bengtsfors','Bollebygd','Borås','Burlöv','Båstad','Eksjö','Emmaboda','Enköping','Falun','Flen','Gotland','Halmstad','Haninge','Huddinge','Härryda','Hässleholm','Håbo','Höganäs','Järfälla','Jönköping','Karlshamn','Katrineholm','Klippan','Knivsta','Kungsör','Kävlinge','Köping','Laxå','Leksand','Lidingö','Lindesberg','Ljungby','Lomma','Ludvika','Lund','Lysekil','Malmö','Malung-Sälen','Mariestad','Mark','Markaryd','Nacka','Nordanstig','Norrköping','Norrtälje','Nykvarn','Nyköping','Nynäshamn','Nässjö','Ockelbo','Orust','Oskarshamn','Oxelösund','Pajala','Perstorp','Piteå','Ronneby','Sala','Sandviken','Sigtuna','Simrishamn','Sjöbo','Sollefteå','Sollentuna','Solna','Stenungsund','Stockholm stad','Strängnäs','Strömstad','Sundbyberg','Sundsvall','Säffle','Säter','Södertälje','Tingsryd','Tomelilla','Trelleborg','Trosa','Täby','Uddevalla','Umeå','Upplands Väsby','Upplands-Bro','Uppsala','Uppvidinge','Vaggeryd','Vallentuna','Varberg','Vaxholm','Vingåker','Vänersborg','Vännäs','Värmdö','Västerås','Ystad','Älmhult','Älvkarleby','Örebro']);

const configFiles = walkDir('scrapers/configs');
const configs = [];

for (const f of configFiles) {
  try {
    const c = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (dbKommuner.has(c.kommun)) continue;

    const dir = path.dirname(f).split(path.sep).pop();
    let platform = 'sitevision';
    if (SCRAPER_MAP[dir]) platform = dir;

    configs.push({ kommun: c.kommun, file: f, platform });
  } catch(e) {}
}

console.error(`Testing ${configs.length} configs with 0 data...\n`);

const found = [];
const empty = [];

for (let i = 0; i < configs.length; i++) {
  const { kommun, file: configFile, platform } = configs[i];
  const scraper = SCRAPER_MAP[platform];

  process.stderr.write(`[${i+1}/${configs.length}] ${kommun} (${platform})... `);

  try {
    const output = execSync(`node ${scraper} --dry-run --config ${configFile}`, {
      timeout: 45000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    // Count permits from output
    let count = 0;

    // Ciceron: "X permits"
    const permitsMatch = output.match(/(\d+) permits/);
    if (permitsMatch) count = parseInt(permitsMatch[1]);

    // SiteVision: "X lyckades parsas"
    if (!count) {
      const parsasMatch = output.match(/(\d+) lyckades parsas/);
      if (parsasMatch) count = parseInt(parsasMatch[1]);
    }

    // Netpublicator/Pollux/Limepark/MeetingsPlus: count BN/DN lines
    if (!count) {
      const diaryLines = output.match(/^\s*(BN|DN|LOV|SBN|MBN|BMN|BYN|Dnr)\s/gm);
      if (diaryLines) count = diaryLines.length;
    }

    // Generic: count "beviljat" or "ansökt" lines
    if (!count) {
      const statusLines = output.match(/beviljat|ansökt|startbesked/g);
      if (statusLines) count = statusLines.length;
    }

    // Count saved lines
    if (!count) {
      const savedLines = output.match(/Saved|Sparad/gi);
      if (savedLines) count = savedLines.length;
    }

    if (count > 0) {
      found.push({ kommun, platform, count, configFile });
      process.stderr.write(`✓ ${count} permits\n`);
    } else {
      empty.push({ kommun, platform, configFile });
      process.stderr.write(`0\n`);
    }
  } catch(e) {
    const msg = e.stderr ? e.stderr.slice(0, 100) : e.message.slice(0, 100);
    empty.push({ kommun, platform, configFile, error: msg });
    process.stderr.write(`ERROR: ${msg.split('\n')[0]}\n`);
  }
}

console.log('\n=== BATCH DRY-RUN RESULTS ===');
console.log(`Total tested: ${configs.length}`);
console.log(`Found data: ${found.length}`);
console.log(`Still empty: ${empty.length}`);
console.log('');

if (found.length > 0) {
  console.log('=== CONFIGS WITH DATA (ready for --save) ===');
  found.sort((a,b) => b.count - a.count);
  for (const f of found) {
    console.log(`  ${f.kommun} (${f.platform}): ${f.count} permits — ${f.configFile}`);
  }
}

// Write found configs to file for --save step
fs.writeFileSync('/tmp/dryrun-found.json', JSON.stringify(found, null, 2));
console.log('\nFound configs saved to /tmp/dryrun-found.json');
