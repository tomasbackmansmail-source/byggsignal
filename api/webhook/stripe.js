/**
 * Vercel Serverless Function for Stripe webhooks.
 *
 * Handles raw body manually to guarantee Stripe signature verification
 * works regardless of Vercel's body parsing behaviour.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Disable Vercel's default body parsing
module.exports.config = {
  api: { bodyParser: false },
};

/**
 * Read raw body from request stream.
 * Works whether Vercel has pre-parsed the body or not.
 */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    // If body is already a Buffer (express.raw or Vercel raw mode)
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    // If body is already a string
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    // If body is already parsed as object, stringify it
    // (signature won't match but we'll get a clear error)
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return resolve(Buffer.from(JSON.stringify(req.body)));
    }
    // Read from stream
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  console.log('[STRIPE] Webhook hit, body type:', typeof req.body,
    Buffer.isBuffer(req.body) ? '(Buffer)' : '',
    'rawBody length:', rawBody.length,
    'sig:', sig ? 'present' : 'MISSING');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[STRIPE] Signature verification failed:', err.message);
    console.error('[STRIPE] STRIPE_WEBHOOK_SECRET configured:', !!process.env.STRIPE_WEBHOOK_SECRET);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log('[STRIPE] Event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const customerId = session.customer;
    const plan = session.metadata?.plan || 'trial';

    console.log('[STRIPE] Email:', email);
    console.log('[STRIPE] Plan:', plan);
    console.log('[STRIPE] Customer ID:', customerId);

    if (!email) {
      console.error('[STRIPE] Inget email i session — avbryter');
      return res.json({ received: true });
    }

    // Slå upp befintlig auth-användare via email (paginerat)
    let authUser = null;
    let page = 1;
    while (!authUser) {
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listErr || !listData.users || listData.users.length === 0) break;
      authUser = listData.users.find(u => u.email === email);
      if (listData.users.length < 1000) break;
      page++;
    }

    console.log('[STRIPE] Profile found:', !!authUser);

    if (!authUser) {
      console.log('[STRIPE] Skapar ny auth-användare för:', email);
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (createErr) {
        console.error('[STRIPE] Kunde inte skapa användare:', createErr.message);
        return res.json({ received: true });
      }
      authUser = newUser.user;
      console.log('[STRIPE] Ny användare skapad:', authUser.id);
    }

    const updates = plan === 'trial'
      ? {
          plan: 'pro',
          has_used_trial: true,
          trial_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          email,
          stripe_customer_id: customerId,
        }
      : { plan, email, stripe_customer_id: customerId };

    const { error } = await supabaseAdmin.from('profiles')
      .upsert({ id: authUser.id, ...updates }, { onConflict: 'id' });

    if (error) {
      console.error('[STRIPE] Upsert error:', error.message);
    } else {
      console.log(`[STRIPE] Plan uppdaterad: ${email} → ${updates.plan} (userId: ${authUser.id})`);
    }
  }

  res.json({ received: true });
};
