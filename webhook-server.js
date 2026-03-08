require('dotenv').config();
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key
const PORT = process.env.PORT || 3001;

// Verifiera Stripe webhook-signatur
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const signed = `${parts.t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

function supabaseUpdate(table, match, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const matchStr = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const req = https.request({
      hostname: new URL(SUPABASE_URL).hostname,
      path: `/rest/v1/${table}?${matchStr}`,
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'return=minimal'
      }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function supabaseGet(table, match) {
  return new Promise((resolve, reject) => {
    const matchStr = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const req = https.request({
      hostname: new URL(SUPABASE_URL).hostname,
      path: `/rest/v1/${table}?${matchStr}&select=id`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject);
    req.end();
  });
}

async function handleCheckoutCompleted(session) {
  const email = session.customer_details?.email;
  const metadata = session.metadata || {};

  if (!email) { console.log('Ingen email i session'); return; }

  // Hitta användaren via email i profiles
  const profiles = await supabaseGet('profiles', { email });
  if (!profiles.length) { console.log(`Ingen profil för ${email}`); return; }
  const userId = profiles[0].id;

  if (metadata.type === 'pro_trial') {
    const trialExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await supabaseUpdate('profiles', { id: userId }, {
      plan: 'pro_trial',
      trial_expires_at: trialExpires,
      has_used_trial: true,
    });
    console.log(`[pro_trial] ${email} → expires ${trialExpires} (status ${result.status})`);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook/stripe') {
    res.writeHead(404); res.end(); return;
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const sig = req.headers['stripe-signature'];
    try {
      if (!verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET)) {
        console.log('Ogiltig signatur');
        res.writeHead(400); res.end('Bad signature'); return;
      }
    } catch (e) {
      console.log('Signaturfel:', e.message);
      res.writeHead(400); res.end('Signature error'); return;
    }

    const event = JSON.parse(body);
    console.log(`Webhook: ${event.type}`);

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object).catch(console.error);
    }

    res.writeHead(200); res.end('ok');
  });
});

server.listen(PORT, () => console.log(`Webhook-server lyssnar på port ${PORT}`));
