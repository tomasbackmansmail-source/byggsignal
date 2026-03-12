// TODO: Fixa raw body-parsning och återinför signaturverifiering.
//       Vercel/Express parsar body innan vi kommer åt den, vilket bryter
//       stripe.webhooks.constructEvent(). Som temporär lösning verifierar
//       vi istället genom att hämta sessionen direkt från Stripe API.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parsa body — kan vara Buffer, string eller redan parsat objekt
  let event;
  try {
    if (typeof req.body === 'string') {
      event = JSON.parse(req.body);
    } else if (Buffer.isBuffer(req.body)) {
      event = JSON.parse(req.body.toString('utf8'));
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error('[STRIPE] JSON parse error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('[STRIPE] Webhook hit, event type:', event?.type);

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const sessionId = event.data?.object?.id;
  if (!sessionId) {
    console.error('[STRIPE] Ingen session id i event');
    return res.status(400).json({ error: 'Missing session id' });
  }

  // Verifiera genom att hämta sessionen direkt från Stripe API
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error('[STRIPE] Kunde inte hämta session:', err.message);
    return res.status(400).json({ error: 'Invalid session' });
  }

  const email = session.customer_email || session.customer_details?.email;
  console.log('[STRIPE] Verified session:', sessionId);
  console.log('[STRIPE] Customer email:', email);

  if (!email) {
    console.error('[STRIPE] Inget email i session');
    return res.status(200).json({ received: true });
  }

  // Kolla om användaren redan finns
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (profile) {
    await supabase
      .from('profiles')
      .update({ plan: 'trial' })
      .eq('email', email);
    console.log('[STRIPE] Updated existing profile for:', email);
  } else {
    // Skapa ny användare via Supabase Auth
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true
    });
    if (authErr) {
      console.error('[STRIPE] Auth create error:', authErr.message);
    } else {
      await supabase
        .from('profiles')
        .upsert({ id: authUser.user.id, email, plan: 'trial' });
      console.log('[STRIPE] Created new user + profile for:', email);
    }
  }

  res.status(200).json({ received: true });
};
