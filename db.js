require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Stockholm municipalities that don't pass län explicitly
const STOCKHOLM_KOMMUNER = new Set([
  'Botkyrka', 'Danderyd', 'Ekerö', 'Haninge', 'Huddinge',
  'Järfälla', 'Knivsta', 'Lidingö', 'Nacka', 'Norrtälje',
  'Nykvarn', 'Nynäshamn', 'Salem', 'Sigtuna', 'Sollentuna',
  'Solna', 'Stockholm stad', 'Sundbyberg', 'Södertälje', 'Tyresö',
  'Upplands Väsby', 'Upplands-Bro', 'Vallentuna', 'Vaxholm',
  'Värmdö', 'Österåker',
]);

async function savePermit(permit) {
  // Only accept beslutsdatum in range 2020–currentYear (rejects expiry dates and future placeholders)
  const bd = permit.beslutsdatum || null;
  const bdYear = bd ? parseInt(bd.slice(0, 4), 10) : null;
  const currentYear = new Date().getFullYear();
  const validBd = bd && bdYear >= 2020 && bdYear <= currentYear ? bd : null;

  const kommun = permit.kommun || 'Nacka';
  const lan = permit.lan || (STOCKHOLM_KOMMUNER.has(kommun) ? 'Stockholms län' : null);

  const now = new Date().toISOString();
  const row = {
    diarienummer: permit.diarienummer,
    fastighetsbeteckning: permit.fastighetsbeteckning,
    adress: permit.adress,
    atgard: permit.atgard,
    kommun,
    lan,
    country: permit.country || 'SE',
    source_url: permit.sourceUrl || null,
    status: permit.status,
    permit_type: permit.permit_type || null,
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
