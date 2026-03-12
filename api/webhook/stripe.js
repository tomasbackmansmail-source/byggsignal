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
  // === DIAGNOSTIK — ta bort när webhook fungerar ===
  console.log('[STRIPE] req.method:', req.method);
  console.log('[STRIPE] content-type:', req.headers['content-type']);
  console.log('[STRIPE] typeof req.body:', typeof req.body);
  console.log('[STRIPE] req.body keys:', req.body ? Object.keys(req.body) : 'null');
  console.log('[STRIPE] raw body snippet:', typeof req.body === 'string' ? req.body.substring(0, 200) : JSON.stringify(req.body).substring(0, 200));
  console.log('[STRIPE] Buffer.isBuffer(req.body):', Buffer.isBuffer(req.body));
  console.log('[STRIPE] req.body is undefined:', req.body === undefined);
  // === SLUT DIAGNOSTIK ===

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parsa body — kan vara Buffer, string, redan parsat objekt, eller undefined
  let event;
  try {
    if (req.body === undefined || req.body === null) {
      // Body saknas — läs från stream
      console.log('[STRIPE] Body undefined/null, reading from stream...');
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      console.log('[STRIPE] Stream body snippet:', rawBody.substring(0, 200));
      event = JSON.parse(rawBody);
    } else if (typeof req.body === 'string') {
      console.log('[STRIPE] Parsing string body');
      event = JSON.parse(req.body);
    } else if (Buffer.isBuffer(req.body)) {
      console.log('[STRIPE] Parsing Buffer body');
      event = JSON.parse(req.body.toString('utf8'));
    } else {
      console.log('[STRIPE] Using pre-parsed object body');
      event = req.body;
    }
  } catch (err) {
    console.error('[STRIPE] JSON parse error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('[STRIPE] Webhook hit, event type:', event?.type);
  console.log('[STRIPE] event.data exists:', !!event?.data);
  console.log('[STRIPE] event.data.object exists:', !!event?.data?.object);
  console.log('[STRIPE] session id:', event?.data?.object?.id);

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const sessionId = event.data?.object?.id;
  if (!sessionId) {
    console.error('[STRIPE] Ingen session id i event');
    console.error('[STRIPE] Full event keys:', Object.keys(event));
    console.error('[STRIPE] event.data keys:', event.data ? Object.keys(event.data) : 'null');
    return res.status(400).json({ error: 'Missing session id' });
  }

  // Verifiera genom att hämta sessionen direkt från Stripe API
  console.log('[STRIPE] Retrieving session from Stripe API:', sessionId);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('[STRIPE] Session retrieved successfully, status:', session.status);
  } catch (err) {
    console.error('[STRIPE] Kunde inte hämta session:', err.message);
    console.error('[STRIPE] Stripe error type:', err.type);
    console.error('[STRIPE] Stripe error code:', err.code);
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
  console.log('[STRIPE] Looking up profile by email:', email);
  const { data: profile, error: lookupErr } = await supabase
    .from('profiles')
    .select('id, plan, email')
    .eq('email', email)
    .single();

  console.log('[STRIPE] Profile lookup result:', JSON.stringify({ profile, error: lookupErr }));

  if (profile) {
    console.log('[STRIPE] Updating profile id:', profile.id, 'current plan:', profile.plan);
    const { data: updateData, error: updateErr } = await supabase
      .from('profiles')
      .update({ plan: 'trial' })
      .eq('email', email)
      .select();
    console.log('[STRIPE] Update result:', JSON.stringify({ data: updateData, error: updateErr }));

    if (updateErr) {
      console.error('[STRIPE] UPDATE FAILED:', updateErr.message, updateErr.code, updateErr.details);
    } else {
      console.log('[STRIPE] Updated existing profile for:', email);
    }
  } else {
    // Skapa ny användare via Supabase Auth
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true
    });
    if (authErr) {
      console.error('[STRIPE] Auth create error:', authErr.message);
    } else {
      const { data: upsertData, error: upsertErr } = await supabase
        .from('profiles')
        .upsert({ id: authUser.user.id, email, plan: 'trial' })
        .select();
      console.log('[STRIPE] Upsert result:', JSON.stringify({ data: upsertData, error: upsertErr }));
      if (upsertErr) {
        console.error('[STRIPE] UPSERT FAILED:', upsertErr.message, upsertErr.code, upsertErr.details);
      } else {
        console.log('[STRIPE] Created new user + profile for:', email);
      }
    }
  }

  res.status(200).json({ received: true });
};
