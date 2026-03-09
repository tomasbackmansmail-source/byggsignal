// Engångsskript: kör alla kommunscraper för historisk backfill.
// Kör en gång: node scripts/backfill-all.js
//
// NOTER OM HISTORIKDJUP
// De flesta kommunscraper hämtar kommunens aktuella anslagstavla — hur långt
// bakåt de når beror på hur länge kommunen håller sina anslag tillgängliga
// (typiskt 1–6 månader). Scrapers med paginering (Danderyd, Norrtälje) och
// Tyresö-API:et hämtar ALLT som är tillgängligt i en körning.
// Värmdö: skickar WEEKS_BACK=52 (~12 månader) för djupare backfill.
// Upsert på diarienummer+kommun förhindrar dubletter vid upprepade körningar.
//
// Österåker och Upplands-Bro: scrapers FINNS — de ingår i körningen nedan.

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { spawn } = require('child_process');
const path      = require('path');

const ROOT = path.join(__dirname, '..');

// ─── Lista över kommuner ────────────────────────────────────────────────────
// Stockholm stad hoppas över — redan backfillad med backfill-stockholm.js.
// Österåker och Upplands-Bro: scrapers finns och ingår.
// Solna: två scrapers (HTML + PDF) — båda körs.

const KOMMUNER = [
  { namn: 'Nacka',          scraper: 'scraper-nacka.js' },
  { namn: 'Värmdö',         scraper: 'scraper-varmdo.js',         env: { WEEKS_BACK: '52' } },
  { namn: 'Täby',           scraper: 'scraper-taby.mjs' },
  { namn: 'Danderyd',       scraper: 'scraper-danderyd.js' },
  { namn: 'Lidingö',        scraper: 'scraper-lidingo.js' },
  { namn: 'Vaxholm',        scraper: 'scraper-vaxholm.js' },
  { namn: 'Österåker',      scraper: 'scraper-osteraker.js' },
  { namn: 'Ekerö',          scraper: 'scraper-ekero.js' },
  { namn: 'Sollentuna',     scraper: 'scraper-sollentuna.js' },
  { namn: 'Solna (HTML)',   scraper: 'scraper-solna.js' },
  { namn: 'Solna (PDF)',    scraper: 'scraper-solna.mjs' },
  { namn: 'Sundbyberg',     scraper: 'scraper-sundbyberg.js' },
  { namn: 'Järfälla',       scraper: 'scraper-jarfalla.js' },
  { namn: 'Upplands Väsby', scraper: 'scraper-upplandsvasby.js' },
  { namn: 'Upplands-Bro',   scraper: 'scraper-upplands-bro.js' },
  { namn: 'Sigtuna',        scraper: 'scraper-sigtuna.js' },
  { namn: 'Botkyrka',       scraper: 'scraper-botkyrka.js' },
  { namn: 'Huddinge',       scraper: 'scraper-huddinge.js' },
  { namn: 'Södertälje',     scraper: 'scraper-sodertalje.js' },
  { namn: 'Salem',          scraper: 'scraper-salem.js' },
  { namn: 'Haninge',        scraper: 'scraper-haninge.js' },
  { namn: 'Tyresö',         scraper: 'scraper-tyreso.js' },
  { namn: 'Nynäshamn',      scraper: 'scraper-nynashamn.js' },
  { namn: 'Nykvarn',        scraper: 'scraper-nykvarn.js' },
  { namn: 'Vallentuna',     scraper: 'scraper-vallentuna.js' },
  { namn: 'Knivsta',        scraper: 'scraper-knivsta.js' },
  { namn: 'Norrtälje',      scraper: 'scraper-norrtalje.js' },
];

const DELAY_MS = 2000; // paus mellan kommuner för att inte hammra API:erna

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Kör en scraper som subprocess och returnerar { code, saved, output }.
 * saved = antal poster enligt "Klart: X" i utdata.
 */
function runScraper(kommun) {
  return new Promise(resolve => {
    const scraperPath = path.join(ROOT, kommun.scraper);
    const child = spawn(process.execPath, [scraperPath], {
      cwd: ROOT,
      env: { ...process.env, ...(kommun.env || {}) },
    });

    let combined = '';
    child.stdout.on('data', d => { combined += d.toString(); });
    child.stderr.on('data', d => { combined += d.toString(); });

    child.on('close', code => {
      // Matcha "Klart: 42/58 ...", "Klart: 42 ...", "Sparade: 42"
      const m = combined.match(/(?:Klart:\s+(\d+)(?:\/\d+)?|Sparade:\s+(\d+))/i);
      const saved = m ? parseInt(m[1] || m[2]) : 0;
      resolve({ code, saved, output: combined });
    });

    child.on('error', err => {
      resolve({ code: -1, saved: 0, output: err.message });
    });
  });
}

/** Hämtar de tre sista icke-tomma raderna ur en logg-sträng. */
function lastLines(text, n = 3) {
  return text.trim().split('\n').filter(l => l.trim()).slice(-n).join(' | ');
}

// ─── Huvudloop ───────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log('=== ByggSignal Backfill — alla kommuner ===');
  console.log(`Scrapers att köra: ${KOMMUNER.length}`);
  console.log('(Stockholm stad hoppas över — redan backfillad)\n');

  let totalSaved = 0;
  const results  = [];

  for (let i = 0; i < KOMMUNER.length; i++) {
    const kommun = KOMMUNER[i];
    const label  = `[${String(i + 1).padStart(2)}/${KOMMUNER.length}] ${kommun.namn}`;

    process.stdout.write(`${label}... `);

    try {
      const { code, saved, output } = await runScraper(kommun);

      if (code !== 0) {
        console.log(`FEL (exit ${code})`);
        console.log(`  → ${lastLines(output)}`);
        results.push({ namn: kommun.namn, status: 'fel', saved: 0 });
      } else {
        console.log(`${saved} poster sparade`);
        totalSaved += saved;
        results.push({ namn: kommun.namn, status: 'ok', saved });
      }
    } catch (err) {
      console.log(`UNDANTAG: ${err.message}`);
      results.push({ namn: kommun.namn, status: 'undantag', saved: 0 });
    }

    // Rate-limit: vänta innan nästa anrop
    if (i < KOMMUNER.length - 1) await sleep(DELAY_MS);
  }

  // ─── Sammanfattning ────────────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const ok  = results.filter(r => r.status === 'ok');
  const fel = results.filter(r => r.status !== 'ok');

  console.log('\n=== SAMMANFATTNING ===');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : '✗';
    console.log(`  ${icon} ${r.namn.padEnd(22)} ${String(r.saved).padStart(4)} poster`);
  }
  console.log('─'.repeat(40));
  console.log(`  Lyckades: ${ok.length}  Fel: ${fel.length}  |  Totalt sparade: ${totalSaved} poster`);
  console.log(`  Tid: ${elapsed}s`);
  console.log('\nKlart!');
}

main().catch(err => {
  console.error('Oväntat fel:', err);
  process.exit(1);
});
