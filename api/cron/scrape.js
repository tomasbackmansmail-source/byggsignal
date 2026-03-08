// api/cron/scrape.js
// Vercel Cron Job -- körs kl 06:00 UTC varje dag
// Kräver CRON_SECRET i miljövariablerna

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
  );

module.exports = async (req, res) => {
    const auth = req.headers.authorization ?? '';
    const secret = process.env.CRON_SECRET ?? '';

    if (secret && auth !== `Bearer ${secret}`) {
          return res.status(401).json({ error: 'Unauthorized' });
    }

    const startedAt = new Date().toISOString();
    console.log('[cron] Startar:', startedAt);

    const { count, error } = await supabase
      .from('permits')
      .select('*', { count: 'exact', head: true });

    if (error) {
          console.error('[cron] Supabase-fel:', error.message);
          return res.status(500).json({ error: error.message });
    }

    const completedAt = new Date().toISOString();
    console.log('[cron] Klar. Permits i DB:', count);

    return res.status(200).json({
          success: true,
          permitsInDb: count,
          startedAt,
          completedAt,
    });
};
