// api/cron-scrape.js
// Vercel Cron Job — körs mån-fre kl 06:00 UTC
// Triggar Railway scraper-service med alla 26 kommuner

module.exports = async (req, res) => {
  const auth = req.headers.authorization ?? '';
  const secret = process.env.CRON_SECRET ?? '';

  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = new Date().toISOString();
  console.log(`[cron-scrape] Startar: ${startedAt}`);

  // Kontrollera att SUPABASE_SERVICE_KEY är satt (anon key räcker inte för writes)
  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.warn('[cron-scrape] VARNING: SUPABASE_SERVICE_KEY saknas — scraper kan inte skriva till DB');
  }

  const scraperUrl = process.env.RAILWAY_SCRAPER_URL;
  const scraperSecret = process.env.SCRAPER_SECRET;

  if (!scraperUrl) {
    console.error('[cron-scrape] FEL: RAILWAY_SCRAPER_URL är inte satt');
    return res.status(500).json({ error: 'RAILWAY_SCRAPER_URL inte konfigurerad' });
  }

  if (!scraperSecret) {
    console.error('[cron-scrape] FEL: SCRAPER_SECRET är inte satt');
    return res.status(500).json({ error: 'SCRAPER_SECRET inte konfigurerad' });
  }

  try {
    const response = await fetch(`${scraperUrl}/run-scrape`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${scraperSecret}` },
    });

    const data = await response.json();
    const completedAt = new Date().toISOString();

    console.log(`[cron-scrape] Railway svar (${response.status}): ${JSON.stringify(data)}`);
    console.log(`[cron-scrape] Klar: ${completedAt}`);

    return res.status(200).json({
      success: true,
      startedAt,
      completedAt,
      railway: data,
    });
  } catch (err) {
    console.error(`[cron-scrape] FEL vid anrop till Railway: ${err.message}`);
    return res.status(500).json({ error: err.message, startedAt });
  }
};
