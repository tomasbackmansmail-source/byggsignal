// api/cron/scrape.js
// Anropas av Vercel Cron Jobs kl 06:00 varje dag: GET /api/cron/scrape
// Kräver CRON_SECRET i miljövariablerna.
//
// OBS: Scrapers som använder Puppeteer kräver en riktig servermiljö
// (VPS, Railway, Render etc.) — de fungerar inte i Vercels Lambda-miljö.

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// Alla kommuners scrapers i körordning.
// .mjs-filer körs direkt med node (ESM-stöd finns i Node >=12).
const SCRAPERS = [
  { name: 'Stockholm stad',  file: 'scraper-stockholm-stad.js' },
  { name: 'Nacka',           file: 'scraper.js' },
  { name: 'Huddinge',        file: 'scraper-huddinge.js' },
  { name: 'Botkyrka',        file: 'scraper-botkyrka.js' },
  { name: 'Haninge',         file: 'scraper-haninge.js' },
  { name: 'Värmdö',          file: 'scraper-varmdo.js' },
  { name: 'Södertälje',      file: 'scraper-sodertalje.js' },
  { name: 'Tyresö',          file: 'scraper-tyreso.js' },
  { name: 'Nynäshamn',       file: 'scraper-nynashamn.js' },
  { name: 'Salem',           file: 'scraper-salem.js' },
  { name: 'Nykvarn',         file: 'scraper-nykvarn.js' },
  { name: 'Ekerö',           file: 'scraper-ekero.js' },
  { name: 'Sundbyberg',      file: 'scraper-sundbyberg.js' },
  { name: 'Solna',           file: 'scraper-solna.mjs' },
  { name: 'Danderyd',        file: 'scraper-danderyd.js' },
  { name: 'Lidingö',         file: 'scraper-lidingo.js' },
  { name: 'Täby',            file: 'scraper-taby.mjs' },
  { name: 'Vallentuna',      file: 'scraper-vallentuna.js' },
  { name: 'Vaxholm',         file: 'scraper-vaxholm.js' },
  { name: 'Österåker',       file: 'scraper-osteraker.js' },
  { name: 'Sollentuna',      file: 'scraper-sollentuna.js' },
  { name: 'Upplands Väsby',  file: 'scraper-upplandsvasby.js' },
  { name: 'Sigtuna',         file: 'scraper-sigtuna.js' },
  { name: 'Järfälla',        file: 'scraper-jarfalla.js' },
  { name: 'Knivsta',         file: 'scraper-knivsta.js' },
  { name: 'Norrtälje',       file: 'scraper-norrtalje.js' },
];

// Kör en scraper som child process. Timeout 5 min per kommun.
function runScraper(scraper) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const proc = spawn('node', [path.join(ROOT, scraper.file)], {
      cwd: ROOT,
      env: process.env,
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      console.error(`[cron] ${scraper.name}: TIMEOUT efter 5 min`);
    }, 5 * 60 * 1000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const ms = Date.now() - t0;
      const ok = code === 0;

      // Plocka ut "Klart: X/Y" från scraperlogg
      const m = stderr.match(/Klart:\s+(\d+)\/(\d+)/);
      const saved = m ? parseInt(m[1]) : null;
      const total = m ? parseInt(m[2]) : null;

      console.log(
        `[cron] ${scraper.name}: ${ok ? 'OK' : `ERR(${code})`} — ` +
        `${saved !== null ? `sparade ${saved}/${total}` : 'okänt antal'} — ${ms}ms`
      );
      if (!ok) {
        console.error(`[cron] ${scraper.name} stderr (sista 500 tecken):\n${stderr.slice(-500)}`);
      }

      resolve({ name: scraper.name, ok, saved, total, ms });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[cron] ${scraper.name} spawn-fel: ${err.message}`);
      resolve({ name: scraper.name, ok: false, error: err.message, ms: Date.now() - t0 });
    });
  });
}

// Express-handler — exporteras och monteras i server.js
module.exports = async function cronHandler(req, res) {
  // Vercel skickar automatiskt Authorization: Bearer <CRON_SECRET>
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = new Date().toISOString();
  console.log(`[cron] Daglig scraping startar — ${startedAt}`);

  const results = [];
  let totalSaved = 0;

  for (const scraper of SCRAPERS) {
    const result = await runScraper(scraper);
    results.push(result);
    if (result.saved) totalSaved += result.saved;
  }

  const completedAt = new Date().toISOString();
  console.log(`[cron] Klart. Totalt sparade ärenden: ${totalSaved} — ${completedAt}`);

  return res.json({
    success: true,
    saved: totalSaved,
    ran: results.length,
    results,
    startedAt,
    completedAt,
  });
};
