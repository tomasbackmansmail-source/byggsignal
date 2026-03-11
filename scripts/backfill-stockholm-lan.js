#!/usr/bin/env node
/**
 * Backfill: set lan='Stockholms län' and country='SE' for all permits
 * where lan IS NULL. All existing permits without lan are from Stockholm.
 *
 * Usage: node scripts/backfill-stockholm-lan.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function backfill() {
  // Supabase JS client doesn't support raw UPDATE, so we batch-select + update
  const { count, error: countErr } = await supabase
    .from('permits')
    .select('*', { count: 'exact', head: true })
    .is('lan', null);

  if (countErr) {
    console.error('Fel vid räkning:', countErr.message);
    process.exit(1);
  }

  console.log(`Hittade ${count} poster med lan=NULL`);

  if (count === 0) {
    console.log('Inget att uppdatera.');
    return;
  }

  // Update in batches of 100
  const batchSize = 100;
  let updated = 0;

  while (true) {
    // Fetch a batch of IDs where lan is null
    const { data, error: fetchErr } = await supabase
      .from('permits')
      .select('id')
      .is('lan', null)
      .limit(batchSize);

    if (fetchErr) {
      console.error('Fel vid hämtning:', fetchErr.message);
      break;
    }

    if (!data || data.length === 0) break;

    // Update one at a time in parallel batches
    const results = await Promise.all(
      data.map(row =>
        supabase
          .from('permits')
          .update({ lan: 'Stockholms län', country: 'SE' })
          .eq('id', row.id)
      )
    );

    const ok = results.filter(r => !r.error).length;
    const errs = results.filter(r => r.error).length;
    updated += ok;

    if (errs > 0) {
      console.error(`  ${errs} fel i batch`);
    }
    console.log(`  Uppdaterade ${updated}/${count}`);

    if (data.length < batchSize) break;
  }

  console.log(`\nKlart! ${updated} poster uppdaterade med lan='Stockholms län', country='SE'`);
}

backfill().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
