/**
 * Vercel Serverless Function for Stripe webhooks.
 *
 * Separate from server.js to guarantee raw body access on Vercel.
 * Vercel's @vercel/node builder parses JSON by default; this config
 * disables that so Stripe signature verification works.
 */

const { buffer } = require('micro');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Disable Vercel's default body parsing — we need the raw body for Stripe
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Read raw body as Buffer
  const rawBody = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[STRIPE] Signature verification failed:', err.message);
    console.error('[STRIPE] Secret configured:', !!process.env.STRIPE_WEBHOOK_SECRET);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log('[STRIPE] Event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // Payment Links: customer_email; Checkout forms: customer_details.email
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

    // Om användaren inte finns — skapa auth-konto (lösenordslöst)
    // Användaren sätter lösenord via "glömt lösenord" vid första inloggning
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

    // Bygg uppdatering
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
