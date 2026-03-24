require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Du är en dataextraktor. Analysera upphandlingsbeskrivningar och returnera JSON.

Returnera EXAKT detta JSON-format (alla fält, null om ej hittat):
{
  "estimated_value_sek": null,
  "contact_name": null,
  "contact_email": null,
  "contact_phone": null,
  "requirements": []
}

Regler:
- estimated_value_sek: belopp i SEK. Om "5 MSEK" skriv 5000000. Om "500 tkr" skriv 500000. null om inget belopp nämns.
- contact_name: upphandlarens namn om det nämns. Ej privatpersoner.
- contact_email: mejladress om den nämns.
- contact_phone: telefonnummer om det nämns.
- requirements: lista med identifierade krav, t.ex. ["F-skattsedel", "Ansvarsförsäkring 10 MSEK", "ID06", "Referensprojekt senaste 3 åren"]. Tom lista om inga krav nämns.

Svara BARA med JSON, inget annat.`;

async function parseOne(description) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Beskrivning:\n---\n${description}\n---` }],
  });

  let text = msg.content[0].text.trim();
  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const json = JSON.parse(text);
  return {
    json,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Fetch unparsed procurements
  const { data: rows, error } = await sb
    .from('procurements')
    .select('id, title, description')
    .is('parsed_at', null)
    .not('description', 'is', null);

  if (error) { console.error('Fetch error:', error.message); return; }

  // Also include rows with empty description to mark as parsed
  const { data: emptyRows } = await sb
    .from('procurements')
    .select('id')
    .is('parsed_at', null)
    .is('description', null);

  console.log(`Found ${rows.length} rows with descriptions to parse`);
  console.log(`Found ${(emptyRows || []).length} rows with NULL description (will mark as parsed)`);

  let ok = 0, fail = 0, totalIn = 0, totalOut = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const desc = (row.description || '').trim();
    if (!desc) continue;

    try {
      const { json, inputTokens, outputTokens } = await parseOne(desc);
      totalIn += inputTokens;
      totalOut += outputTokens;

      const update = {
        parsed_at: new Date().toISOString(),
      };
      if (json.estimated_value_sek) update.estimated_value_parsed = json.estimated_value_sek;
      if (json.contact_name) update.contact_name = json.contact_name;
      if (json.contact_email) update.contact_email = json.contact_email;
      if (json.contact_phone) update.contact_phone = json.contact_phone;
      if (json.requirements && json.requirements.length > 0) update.parsed_requirements = json.requirements;

      const { error: updateErr } = await sb
        .from('procurements')
        .update(update)
        .eq('id', row.id);

      if (updateErr) {
        console.error(`  [${i + 1}/${rows.length}] UPDATE error for ${row.id}:`, updateErr.message);
        fail++;
      } else {
        const extracted = [];
        if (json.estimated_value_sek) extracted.push(`${json.estimated_value_sek} SEK`);
        if (json.contact_name) extracted.push(json.contact_name);
        if (json.requirements?.length) extracted.push(`${json.requirements.length} krav`);
        const info = extracted.length > 0 ? extracted.join(', ') : 'inga fält';
        console.log(`  [${i + 1}/${rows.length}] ${row.title.slice(0, 60)} → ${info}`);
        ok++;
      }
    } catch (e) {
      console.error(`  [${i + 1}/${rows.length}] PARSE error for "${row.title}":`, e.message);
      fail++;
    }

    // Rate limit: ~5 req/sec
    if (i < rows.length - 1) await sleep(200);
  }

  // Mark empty-description rows as parsed
  for (const row of (emptyRows || [])) {
    await sb.from('procurements').update({ parsed_at: new Date().toISOString() }).eq('id', row.id);
  }

  console.log('\n=== RESULT ===');
  console.log(`Parsed: ${ok} ok, ${fail} failed`);
  console.log(`Tokens: ${totalIn} in, ${totalOut} out`);
  console.log(`Empty descriptions marked: ${(emptyRows || []).length}`);

  // Cost estimate (Haiku pricing: $0.80/MTok in, $4/MTok out)
  const costIn = (totalIn / 1000000) * 0.80;
  const costOut = (totalOut / 1000000) * 4.00;
  console.log(`Estimated cost: $${(costIn + costOut).toFixed(4)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
