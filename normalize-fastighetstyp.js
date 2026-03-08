require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Normalisera till: villa, radhus, flerbostadshus, industri, fritidshus, annat, okänd
function normalize(raw) {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();

  if (v === 'villa' || v === 'tvåbostadshus' || v === 'villa/radhus') return 'villa';
  if (v === 'radhus') return 'radhus';
  if (v === 'flerbostadshus' || v === 'flerbostadshus, radhus') return 'flerbostadshus';
  if (v === 'industri' || v === 'industri/näringsfastighet') return 'industri';
  if (v === 'fritidshus' || v === 'kolonistuga') return 'fritidshus';
  if (v === 'okänd' || v === 'okänt') return 'okänd';

  // Allt övrigt → annat
  return 'annat';
}

async function main() {
  const { data, error } = await sb
    .from('permits')
    .select('id, fastighetstyp')
    .not('fastighetstyp', 'is', null);

  if (error) { console.error(error); process.exit(1); }

  // Gruppera per (råvärde → normaliserat) för att batcha uppdateringar
  const toUpdate = {};
  for (const r of data) {
    const norm = normalize(r.fastighetstyp);
    if (norm !== r.fastighetstyp) {
      if (!toUpdate[norm]) toUpdate[norm] = [];
      toUpdate[norm].push(r.id);
    }
  }

  const unchanged = data.length - Object.values(toUpdate).flat().length;
  console.log(`Totalt: ${data.length} poster, ${unchanged} redan korrekta\n`);

  for (const [norm, ids] of Object.entries(toUpdate)) {
    console.log(`Uppdaterar ${ids.length} poster → "${norm}"`);
    // Supabase stödjer inte IN-filter med .update direkt, kör i batchar om 50
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const { error: e } = await sb
        .from('permits')
        .update({ fastighetstyp: norm })
        .in('id', batch);
      if (e) console.error('  Fel:', e.message);
    }
  }

  console.log('\nKlart!');
}

main().catch(console.error);
