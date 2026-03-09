require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function savePermit(permit) {
  // Only accept beslutsdatum in range 2020–currentYear (rejects expiry dates and future placeholders)
  const bd = permit.beslutsdatum || null;
  const bdYear = bd ? parseInt(bd.slice(0, 4), 10) : null;
  const currentYear = new Date().getFullYear();
  const validBd = bd && bdYear >= 2020 && bdYear <= currentYear ? bd : null;

  const now = new Date().toISOString();
  const row = {
    diarienummer: permit.diarienummer,
    fastighetsbeteckning: permit.fastighetsbeteckning,
    adress: permit.adress,
    atgard: permit.atgard,
    kommun: permit.kommun || 'Nacka',
    source_url: permit.sourceUrl || null,
    status: permit.status,
    beslutsdatum: validBd,
    // Use beslutsdatum as scraped_at when available (stable sort key).
    // Otherwise fall back to now() so scraped_at is never NULL after a scrape run.
    scraped_at: validBd ? new Date(validBd).toISOString() : now,
  };

  const { error } = await supabase
    .from('permits')
    .upsert(row, { onConflict: 'diarienummer', ignoreDuplicates: false });

  if (error) throw new Error(`savePermit failed (${row.diarienummer}): ${error.message}`);
}

async function getNewPermits() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('permits')
    .select('*')
    .gte('scraped_at', since)
    .order('scraped_at', { ascending: false });

  if (error) throw new Error(`getNewPermits failed: ${error.message}`);
  return data;
}

module.exports = { savePermit, getNewPermits };
