/**
 * Byggsignal scraper service
 * Express-server som kör alla scraper-*.js via child_process.fork()
 * Max 3 scrapers parallellt (Puppeteer är minneskrävande)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const { fork }  = require('child_process');
const fs        = require('fs');
const path      = require('path');

const app    = express();
const PORT   = process.env.PORT || 3001;
const SECRET = process.env.SCRAPER_SECRET;

// State
let lastRun      = null;
let runInProgress = false;

// Discover all root-level scraper files
const ROOT = path.join(__dirname, '..');
function getScraperFiles() {
  return fs.readdirSync(ROOT)
    .filter(f => /^scraper-.+\.js$/.test(f))
    .map(f => path.join(ROOT, f));
}

// ── Auth middleware ─────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  if (!SECRET) return res.status(500).json({ error: 'SCRAPER_SECRET inte konfigurerad' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${SECRET}`) return res.status(401).json({ error: 'Ej auktoriserad' });
  next();
}

// ── Kör en scraper som child process ────────────────────────────────────────
function runScraper(scraperPath) {
  return new Promise((resolve) => {
    const name = path.basename(scraperPath, '.js');
    const start = Date.now();
    const ts = () => new Date().toISOString();

    console.log(`[${ts()}] START ${name}`);

    const child = fork(scraperPath, [], {
      silent: false,       // ärv stdout/stderr
      env: process.env,
    });

    child.on('exit', (code) => {
      const ms = Date.now() - start;
      if (code === 0) {
        console.log(`[${ts()}] OK    ${name} (${ms}ms)`);
      } else {
        console.log(`[${ts()}] FEL   ${name} avslutade med kod ${code} (${ms}ms)`);
      }
      resolve({ name, code, ms });
    });

    child.on('error', (err) => {
      const ms = Date.now() - start;
      console.log(`[${ts()}] FEL   ${name}: ${err.message} (${ms}ms)`);
      resolve({ name, code: -1, ms, error: err.message });
    });
  });
}

// ── Kör alla scrapers i batchar om max 3 ────────────────────────────────────
async function runAllScrapers() {
  if (runInProgress) {
    console.log(`[${new Date().toISOString()}] Körning redan pågår, hoppar över.`);
    return;
  }
  runInProgress = true;
  const scrapers = getScraperFiles();
  const CONCURRENCY = 3;
  const results = [];

  console.log(`[${new Date().toISOString()}] === Startar scraping: ${scrapers.length} scrapers ===`);

  for (let i = 0; i < scrapers.length; i += CONCURRENCY) {
    const batch = scrapers.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runScraper));
    results.push(...batchResults);
  }

  lastRun = new Date().toISOString();
  runInProgress = false;

  const ok  = results.filter(r => r.code === 0).length;
  const fel = results.filter(r => r.code !== 0).length;
  console.log(`[${lastRun}] === Klar: ${ok} OK, ${fel} fel ===`);
  return results;
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    lastRun,
    scraperCount: getScraperFiles().length,
    runInProgress,
  });
});

app.get('/run-scrape', requireSecret, async (_req, res) => {
  if (runInProgress) {
    return res.json({ status: 'already_running', lastRun });
  }
  // Returnera direkt — körningen sker i bakgrunden
  res.json({ status: 'started', scraperCount: getScraperFiles().length });
  runAllScrapers().catch(err =>
    console.error(`[${new Date().toISOString()}] Oväntat fel i runAllScrapers:`, err.message)
  );
});

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Scraper service lyssnar på port ${PORT}`);
});

module.exports = { runAllScrapers };
