const Stripe = require('stripe');
const { buffer } = require('micro');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports.config = {
  api: { bodyParser: false }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  console.log('[STRIPE] Webhook hit');
  console.log('[STRIPE] Sig header present:', !!sig);
  console.log('[STRIPE] Body length:', buf.length);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      buf, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[STRIPE] Signature error:', err.message);
    return res.status(400).json({ error: 'Webhook Error: ' + err.message });
  }

  console.log('[STRIPE] Event type:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    console.log('[STRIPE] Customer email:', email);

    if (email) {
      // Kolla om anvandaren finns
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();

      if (profile) {
        // Uppdatera befintlig
        await supabase
          .from('profiles')
          .update({ plan: 'trial' })
          .eq('email', email);
        console.log('[STRIPE] Updated existing profile');
      } else {
        // Skapa ny anvandare via Supabase Auth
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
          console.log('[STRIPE] Created new user + profile');
        }
      }
    }
  }

  res.status(200).json({ received: true });
};
