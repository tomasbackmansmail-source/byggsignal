/**
 * Hamtar Boverkets planbestammelsekatalog (alla ~3700 bestammelser)
 * och sparar i enrichment_planbestammelser.
 *
 * API: https://api.boverket.se/planbestammelsekatalogen/
 * Ingen autentisering kravs.
 *
 * Koers: node scripts/fetch-planbestammelser.js
 */

require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const API_URL = 'https://api.boverket.se/planbestammelsekatalogen/release/full/platt/aktuell';

async function main() {
  console.log('Hamtar planbestammelsekatalogen fran Boverket...');

  const res = await axios.get(API_URL, {
    headers: { 'Accept': 'application/json' },
    timeout: 120000,
  });

  const data = res.data;

  // Hantera olika responsformat
  let bestammelser;
  if (Array.isArray(data)) {
    bestammelser = data;
  } else if (data.bestammelser) {
    bestammelser = data.bestammelser;
  } else if (data.release && data.release.bestammelser) {
    bestammelser = data.release.bestammelser;
  } else {
    // Prova att hitta arrayen i svaret
    const keys = Object.keys(data);
    console.log('Responsnycklar:', keys);
    // Skriv ut forsta 500 tecken for debugging
    console.log('Svar (forsta 500 tecken):', JSON.stringify(data).substring(0, 500));
    throw new Error('Okant responsformat - kunde inte hitta bestammelser-arrayen');
  }

  console.log(`Hittade ${bestammelser.length} bestammelser`);

  // Mappa till databasrader
  const rows = bestammelser.map(b => ({
    bestammelse_kod: b.bestammelsekod || b.beteckning || null,
    bestammelse_uuid: b.id || b.uuid || null,
    namn: b.bestammelseformulering || b.namn || b.name || null,
    kategori: b.kategori || b.bestammelsetyp || null,
    underkategori: b.underkategori || b.anvandningsform || null,
    beskrivning: b.forklaring || b.beskrivning || null,
    raw_json: b,
  }));

  // Ladda in i batchar
  const BATCH_SIZE = 500;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('enrichment_planbestammelser')
      .insert(batch);

    if (error) {
      console.error(`FEL vid batch ${i}: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\nKlart!`);
  console.log(`  Sparade: ${inserted} rader`);
  console.log(`  Fel: ${errors} batchar`);

  const { count } = await supabase
    .from('enrichment_planbestammelser')
    .select('*', { count: 'exact', head: true });

  console.log(`  Totalt i tabellen: ${count}`);
}

main().catch(err => {
  console.error('FEL:', err.message);
  process.exit(1);
});
