#!/usr/bin/env node
// Sätt plan på en användare direkt i Supabase utan Stripe.
// Kräver SUPABASE_SERVICE_KEY i .env
//
// Användning:
//   node admin-set-plan.js <email> <plan>
//
// Exempel:
//   node admin-set-plan.js kompis@email.com pro
//   node admin-set-plan.js kompis@email.com bas
//   node admin-set-plan.js kompis@email.com free

require('dotenv').config();
const https = require('https');

const VALID_PLANS = ['free', 'pro_trial', 'bas', 'pro'];
const [,, email, plan] = process.argv;

if (!email || !plan) {
  console.error('Användning: node admin-set-plan.js <email> <plan>');
  console.error('Planer:', VALID_PLANS.join(', '));
  process.exit(1);
}
if (!VALID_PLANS.includes(plan)) {
  console.error(`Ogiltig plan "${plan}". Tillåtna: ${VALID_PLANS.join(', ')}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_KEY saknas i .env');
  process.exit(1);
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const r = https.request({
      hostname: new URL(SUPABASE_URL).hostname,
      path,
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
        Prefer: 'return=representation'
      }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '[]') })); });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

(async () => {
  // Hämta profil via email
  const { data: profiles } = await req('GET', `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,email,plan`);
  if (!profiles.length) {
    console.error(`Ingen profil hittad för: ${email}`);
    process.exit(1);
  }

  const current = profiles[0];
  console.log(`Hittad: ${current.email} (nuvarande plan: ${current.plan})`);

  const update = { plan };
  // Rensa trial-fält om vi sätter ett riktigt plan
  if (plan !== 'pro_trial') update.trial_expires_at = null;

  const { status, data } = await req('PATCH',
    `/rest/v1/profiles?id=eq.${current.id}`,
    update
  );

  if (status === 200 && data.length) {
    console.log(`✓ Plan uppdaterad: ${current.plan} → ${data[0].plan}`);
  } else {
    console.error(`Fel (status ${status}):`, data);
    process.exit(1);
  }
})();
