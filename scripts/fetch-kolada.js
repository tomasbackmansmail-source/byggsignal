/**
 * Hamtar bygglov-nyckeltal fran Kolada API (SKR/RKA)
 * och sparar i enrichment_kolada-tabellen.
 *
 * KPI:er:
 *   U00810 - Median handlaggningstid fran inkommet till beslut (dagar)
 *   U00811 - Median handlaggningstid fran komplett till beslut (dagar)
 *   U00812 - Antal arenden (underlag for medianen)
 *
 * Koers: node scripts/fetch-kolada.js
 */

require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const KPI_IDS = ['U00810', 'U00811', 'U00812', 'N00820', 'N00821', 'N00822'];
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const BASE_URL = 'https://api.kolada.se/v2';
const RATE_LIMIT_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Hamta kommunnamn fran Kolada
async function fetchMunicipalityNames() {
  console.log('Hamtar kommunlista fran Kolada...');
  const res = await axios.get(`${BASE_URL}/municipality?title=`);
  const map = {};
  for (const m of res.data.values) {
    // Bara kommuner (4-siffrig kod, inga grupper med G-prefix)
    if (/^\d{4}$/.test(m.id)) {
      map[m.id] = m.title;
    }
  }
  console.log(`  Hittade ${Object.keys(map).length} kommuner`);
  return map;
}

async function fetchKpiYear(kpiId, year) {
  const url = `${BASE_URL}/data/kpi/${kpiId}/year/${year}`;
  try {
    const res = await axios.get(url, { timeout: 30000 });
    return res.data.values || [];
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return [];
    }
    throw err;
  }
}

async function main() {
  const municipalityNames = await fetchMunicipalityNames();
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const kpiId of KPI_IDS) {
    for (const year of YEARS) {
      console.log(`Hamtar ${kpiId} / ${year}...`);
      await sleep(RATE_LIMIT_MS);

      const records = await fetchKpiYear(kpiId, year);
      if (records.length === 0) {
        console.log(`  Inga data`);
        continue;
      }

      // Filtrera till enbart kommuner (inte grupper) och rader med varden
      const rows = [];
      for (const r of records) {
        if (!/^\d{4}$/.test(r.municipality)) continue;
        const val = r.values && r.values[0];
        if (!val || val.value === null || val.value === undefined) continue;
        if (val.status === 'Missing' || val.status === 'Privacy') continue;

        rows.push({
          municipality_code: r.municipality,
          municipality_name: municipalityNames[r.municipality] || r.municipality,
          kpi_id: kpiId,
          year: r.period,
          value: val.value,
        });
      }

      if (rows.length === 0) {
        console.log(`  Inga giltiga varden`);
        continue;
      }

      // Upsert i batchar om 500
      const BATCH_SIZE = 500;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from('enrichment_kolada')
          .upsert(batch, { onConflict: 'municipality_code,kpi_id,year' });

        if (error) {
          console.error(`  FEL vid upsert: ${error.message}`);
          totalSkipped += batch.length;
        } else {
          totalInserted += batch.length;
        }
      }

      console.log(`  ${rows.length} rader sparade`);
    }
  }

  console.log(`\nKlart! ${totalInserted} rader sparade, ${totalSkipped} misslyckade.`);

  // Sammanfattning
  const { data: summary } = await supabase
    .from('enrichment_kolada')
    .select('kpi_id, year')
    .limit(1);

  const { count } = await supabase
    .from('enrichment_kolada')
    .select('*', { count: 'exact', head: true });

  console.log(`Totalt ${count} rader i enrichment_kolada`);
}

main().catch(err => {
  console.error('FEL:', err.message);
  process.exit(1);
});
