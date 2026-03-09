/**
 * Byggsignal cron-runner
 * Startar scraper-service och triggar daglig scraping kl 06:00 UTC (08:00 svensk sommartid)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const cron    = require('node-cron');
const http    = require('http');

// Starta Express-servern från scraper-service.js
require('./scraper-service');

const PORT   = process.env.PORT || 3001;
const SECRET = process.env.SCRAPER_SECRET;

function triggerScrape() {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Cron: triggar /run-scrape`);

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/run-scrape',
    method: 'GET',
    headers: { Authorization: `Bearer ${SECRET}` },
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log(`[${new Date().toISOString()}] Cron svar: ${body}`);
    });
  });

  req.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Cron fel: ${err.message}`);
  });

  req.end();
}

// Vänta 5 sekunder på att servern ska starta, kör sedan schema
setTimeout(() => {
  // Schema: 06:00 UTC varje dag
  cron.schedule('0 6 * * *', () => {
    triggerScrape();
  }, { timezone: 'UTC' });

  console.log(`[${new Date().toISOString()}] Cron schemalagd: 06:00 UTC (= 08:00 CEST)`);

  // Kör direkt vid uppstart om SCRAPE_ON_START=true (användbart vid driftsättning)
  if (process.env.SCRAPE_ON_START === 'true') {
    console.log(`[${new Date().toISOString()}] SCRAPE_ON_START aktiv — kör direkt`);
    setTimeout(triggerScrape, 2000);
  }
}, 5000);
