require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function savePermit(permit) {
  const row = {
    diarienummer: permit.diarienummer,
    fastighetsbeteckning: permit.fastighetsbeteckning,
    adress: permit.adress,
    atgard: permit.atgard,
    kommun: permit.kommun || 'Nacka',
    source_url: permit.sourceUrl || null,
    status: permit.status,
    beslutsdatum: permit.beslutsdatum || null,
    // When we have a real decision date, use it as scraped_at too
    // so that sort order and "new permits" logic reflects the decision, not scrape time
    ...(permit.beslutsdatum ? { scraped_at: new Date(permit.beslutsdatum).toISOString() } : {}),
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
