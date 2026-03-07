require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = (text) =>
  `Extrahera från denna bygglovsbeskrivning: 1) åtgärder (lista, t.ex. altan/garage/kök/badrum/carport/tak/pool/solceller/fasad/fönster) 2) fastighetstyp (villa/radhus/flerbostadshus/industri/annat) 3) en kort beskrivning på svenska, max 10 ord. Svara ENDAST med JSON: {"atgarder": "...", "fastighetstyp": "...", "beskrivning_kort": "..."}. Beskrivning: ${text}`;

async function enrichPermit(permit) {
  const text = [permit.atgard, permit.fastighetsbeteckning, permit.adress]
    .filter(Boolean)
    .join(' — ');

  if (!text.trim()) {
    console.log(`[skip] ${permit.diarienummer} — ingen text att extrahera`);
    return;
  }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: PROMPT(text) }],
    });

    const raw = msg.content[0].text.trim();
    // Extrahera JSON (hantera ev. markdown-kodblock)
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(jsonStr);

    const { atgarder, fastighetstyp, beskrivning_kort } = parsed;

    const { error } = await supabase
      .from('permits')
      .update({ atgarder, fastighetstyp, beskrivning_kort })
      .eq('id', permit.id);

    if (error) throw new Error(error.message);

    console.log(`[ok] ${permit.diarienummer} → ${fastighetstyp} | ${atgarder} | "${beskrivning_kort}"`);
  } catch (err) {
    console.error(`[fel] ${permit.diarienummer}:`, err.message);
  }
}

async function main() {
  console.log('Hämtar permits utan atgarder...');

  const { data: permits, error } = await supabase
    .from('permits')
    .select('id, diarienummer, atgard, fastighetsbeteckning, adress')
    .is('atgarder', null)
    .order('scraped_at', { ascending: false });

  if (error) {
    console.error('Supabase-fel:', error.message);
    process.exit(1);
  }

  console.log(`Hittade ${permits.length} permits att berika\n`);

  // Kör ett i taget för att inte hammra APIet
  for (const permit of permits) {
    await enrichPermit(permit);
    // Liten paus för att hålla sig inom rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\nKlart!');
}

main().catch(err => {
  console.error('Kritiskt fel:', err);
  process.exit(1);
});
