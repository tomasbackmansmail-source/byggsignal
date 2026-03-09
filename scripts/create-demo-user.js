#!/usr/bin/env node
// scripts/create-demo-user.js
// Skapar eller uppdaterar ett demo-konto med valfri plan och provperiod.
//
// Användning:
//   node scripts/create-demo-user.js <email> <lösenord> <plan> <dagar>
//
// Exempel:
//   node scripts/create-demo-user.js vvs@firma.se demo2026 pro 60

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const [,, email, password, plan, days] = process.argv;

if (!email || !password || !plan || !days) {
  console.error('Användning: node scripts/create-demo-user.js <email> <lösenord> <plan> <dagar>');
  console.error('Exempel:   node scripts/create-demo-user.js vvs@firma.se demo2026 pro 60');
  process.exit(1);
}

const VALID_PLANS = ['free', 'bas', 'pro', 'enterprise'];
if (!VALID_PLANS.includes(plan)) {
  console.error(`Ogiltigt plan: "${plan}". Tillåtna värden: ${VALID_PLANS.join(', ')}`);
  process.exit(1);
}

const daysNum = parseInt(days, 10);
if (isNaN(daysNum) || daysNum < 1) {
  console.error('Antal dagar måste vara ett positivt heltal, t.ex. 60');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Fel: SUPABASE_URL och SUPABASE_SERVICE_KEY måste vara satta i .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  const expiresAt = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000);
  const expiresStr = expiresAt.toISOString().split('T')[0];

  let userId;

  // Försök skapa ny användare
  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    const isAlreadyExists =
      createError.message.includes('already been registered') ||
      createError.message.includes('already exists') ||
      createError.status === 422;

    if (isAlreadyExists) {
      // Användaren finns — hämta befintligt ID
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) {
        console.error('Kunde inte hämta användarlista:', listError.message);
        process.exit(1);
      }
      const existing = listData.users.find(u => u.email === email);
      if (!existing) {
        console.error('Hittade inte användaren trots dubblett-fel. Kontakta Supabase support.');
        process.exit(1);
      }
      userId = existing.id;
      console.log(`Befintligt konto hittat — uppdaterar plan och provperiod.`);
    } else {
      console.error('Fel vid skapande av användare:', createError.message);
      process.exit(1);
    }
  } else {
    userId = createData.user.id;
  }

  // Upserta profil
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(
      { id: userId, email, plan, trial_expires_at: expiresAt.toISOString() },
      { onConflict: 'id' }
    );

  if (profileError) {
    console.error('Fel vid uppdatering av profil:', profileError.message);
    process.exit(1);
  }

  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  console.log(`\nKonto skapat: ${email} / ${password} — ${planLabel} till ${expiresStr}\n`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
