require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function savePermit(permit) {
  // Only accept beslutsdatum values with a plausible year (2020–2035)
  const bd = permit.beslutsdatum || null;
  const bdYear = bd ? parseInt(bd.slice(0, 4), 10) : null;
  const validBd = bd && bdYear >= 2020 && bdYear <= 2035 ? bd : null;

  const row = {
    diarienummer: permit.diarienummer,
    fastighetsbeteckning: permit.fastighetsbeteckning,
    adress: permit.adress,
    atgard: permit.atgard,
    kommun: permit.kommun || 'Nacka',
    source_url: permit.sourceUrl || null,
    status: permit.status,
    beslutsdatum: validBd,
    // When we have a real decision date, use it as scraped_at too
    // so that sort order and "new permits" logic reflects the decision, not scrape time
    ...(validBd ? { scraped_at: new Date(validBd).toISOString() } : {}),
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
