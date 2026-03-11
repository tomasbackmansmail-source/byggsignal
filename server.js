require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Stripe webhook — måste vara FÖRE express.json() för att få raw body
app.post('/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email;
      const customerId = session.customer;
      const plan = session.metadata?.plan; // 'bas', 'pro', eller 'trial'

      if (email && plan) {
        // Slå upp auth-användare via email för att få UUID
        const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = listErr ? null : listData.users.find(u => u.email === email);
        const userId = authUser?.id ?? null;

        const updates = plan === 'trial'
          ? { plan: 'pro', has_used_trial: true, trial_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), email, stripe_customer_id: customerId }
          : { plan, email, stripe_customer_id: customerId };

        if (userId) {
          // Känd användare — upsert på id
          const { error } = await supabaseAdmin.from('profiles')
            .upsert({ id: userId, ...updates }, { onConflict: 'id' });
          if (error) console.error('[Stripe] Upsert error:', error.message);
        } else {
          // Okänd användare (betalade utan att skapa konto) — upsert på email
          const { error } = await supabaseAdmin.from('profiles')
            .upsert(updates, { onConflict: 'email' });
          if (error) console.error('[Stripe] Email-upsert error:', error.message);
        }
        console.log(`[Stripe] Plan uppdaterad: ${email} → ${plan} (userId: ${userId ?? 'okänd'})`);
      }
    }
    res.json({ received: true });
  }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function getAllPermits() {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('permits')
      .select('*')
      .order('scraped_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const byKommun = all.reduce((acc, p) => { acc[p.kommun] = (acc[p.kommun] || 0) + 1; return acc; }, {});
  console.log(`[permits] totalt: ${all.length}, per kommun:`, JSON.stringify(byKommun));
  return all;
}

function renderPage(permits) {
  const cards = permits.map(p => {
    const badge = p.atgard && p.atgard.includes('nybyggnad')
      ? '<span class="badge new">Nybyggnad</span>'
      : '<span class="badge ext">Tillbyggnad</span>';

    return `
    <div class="card">
      <div class="card-header">
        ${badge}
        <span class="kommun">${p.kommun || 'Nacka'}</span>
      </div>
      <h2 class="fastighet">${p.fastighetsbeteckning || '—'}</h2>
      <p class="atgard">${p.atgard || '—'}</p>
      <div class="locked-row">
        <span class="lock-icon">🔒</span>
        <span class="locked-text">Adress tillgänglig för premiumanvändare</span>
      </div>
      <div class="meta">
        <span>${p.diarienummer}</span>
        <a href="${p.source_url}" target="_blank" rel="noopener">Källa ↗</a>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ByggSignal — Nya bygglov i Nacka</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f4f6f9;
      color: #1a1a2e;
      min-height: 100vh;
    }

    header {
      background: #1a1a2e;
      color: #fff;
      padding: 20px 16px 16px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    header h1 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.5px; }
    header p { font-size: 0.8rem; opacity: 0.6; margin-top: 2px; }

    .container { max-width: 600px; margin: 0 auto; padding: 16px; }

    .count { font-size: 0.8rem; color: #666; margin-bottom: 12px; }

    .card {
      background: #fff;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    .badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge.new  { background: #e8f5e9; color: #2e7d32; }
    .badge.ext  { background: #e3f2fd; color: #1565c0; }

    .kommun {
      font-size: 0.75rem;
      color: #999;
      margin-left: auto;
    }

    .fastighet {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .atgard {
      font-size: 0.85rem;
      color: #444;
      text-transform: capitalize;
      margin-bottom: 12px;
    }

    .locked-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f9f9f9;
      border: 1px dashed #ddd;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    .lock-icon { font-size: 1rem; }
    .locked-text { font-size: 0.8rem; color: #888; }

    .meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: #aaa;
    }
    .meta a { color: #1a73e8; text-decoration: none; }
    .meta a:hover { text-decoration: underline; }

    .empty { text-align: center; padding: 60px 16px; color: #999; }
  </style>
</head>
<body>
  <header>
    <h1>ByggSignal</h1>
    <p>Beviljade bygglov — Nacka kommun</p>
  </header>
  <div class="container">
    <p class="count">${permits.length} bygglov</p>
    ${permits.length ? cards : '<div class="empty">Inga bygglov hittades.</div>'}
  </div>
</body>
</html>`;
}

// Vercel Cron Job — GET /api/cron/scrape (kl 06:00 varje dag)
app.get('/api/cron/scrape', require('./api/cron/scrape'));

// Säkerställ att profiles-rad finns vid inloggning (fallback för användare skapade innan trigger)
app.post('/api/ensure-profile', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.warn('[ensure-profile] SUPABASE_SERVICE_KEY saknas');
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: user.id, email: user.email }, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.error('[ensure-profile]', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// -- CREATE TABLE privacy_requests (
// --   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
// --   email text NOT NULL,
// --   message text NOT NULL,
// --   created_at timestamptz DEFAULT now()
// -- );
app.post('/api/privacy-request', async (req, res) => {
  const { email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'email och message krävs' });
  const { error } = await supabase.from('privacy_requests').insert({ email, message });
  if (error) { console.error('privacy_requests insert:', error); return res.status(500).json({ error: error.message }); }
  res.json({ ok: true });
});

// Server-side filter definitions (keyword sets per filter name)
const SERVER_FILTERS = {
  solceller: 'atgard.ilike.%solcell%,atgard.ilike.%solenergianlägg%,atgard.ilike.%solpanel%,atgarder.ilike.%solcell%',
  eldstad:   'atgard.ilike.%eldstad%,atgard.ilike.%rökkanal%,atgarder.ilike.%eldstad%',
  ventilation: 'atgard.ilike.%ventilation%,atgard.ilike.%vvs%,atgarder.ilike.%ventilation%',
  'altan-garage': 'atgard.ilike.%altan%,atgard.ilike.%carport%,atgard.ilike.%garage%,atgarder.ilike.%altan%',
};

const FILTER_PAGE_SIZE = 50;

app.get('/api/permits', async (req, res) => {
  const { filter, days, page } = req.query;

  // Legacy: no filter param → return full dataset (existing behaviour)
  if (!filter) {
    try {
      const permits = await getAllPermits();
      return res.json(permits);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Server-side filtered + paginated query
  const filterOr = SERVER_FILTERS[filter];
  if (!filterOr) return res.status(400).json({ error: `Okänt filter: ${filter}` });

  const pageNum = Math.max(1, parseInt(page) || 1);
  const daysNum = parseInt(days) || 30;
  const from    = (pageNum - 1) * FILTER_PAGE_SIZE;
  const to      = from + FILTER_PAGE_SIZE - 1;
  const cutoff  = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    let query = supabase
      .from('permits')
      .select('*', { count: 'exact' })
      .or(filterOr)
      .or(`scraped_at.gte.${cutoff},beslutsdatum.gte.${cutoff},scraped_at.is.null`)
      .order('scraped_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (req.query.kommun) {
      query = query.eq('kommun', req.query.kommun);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      data,
      total:    count,
      page:     pageNum,
      pages:    Math.ceil(count / FILTER_PAGE_SIZE),
      per_page: FILTER_PAGE_SIZE,
    });
  } catch (err) {
    console.error('[/api/permits filter]', err);
    res.status(500).json({ error: err.message });
  }
});

function ssrPermitCards(permits) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recent = permits.filter(p => p.beslutsdatum && p.beslutsdatum >= cutoff);
  // Dedup by diarienummer
  const seen = new Set();
  const deduped = recent.filter(p => {
    if (!p.diarienummer || seen.has(p.diarienummer)) return false;
    seen.add(p.diarienummer);
    return true;
  });
  return deduped.map(p => {
    const pt = (p.permit_type || 'bygglov').toLowerCase();
    let badgeClass, badgeLabel;
    if (pt === 'marklov') { badgeClass = 'b-marklov'; badgeLabel = 'Marklov'; }
    else if (pt === 'rivningslov') { badgeClass = 'b-rivningslov'; badgeLabel = 'Rivningslov'; }
    else if (pt === 'förhandsbesked') { badgeClass = 'b-forhandsbesked'; badgeLabel = 'Förhandsbesked'; }
    else if (pt === 'strandskyddsdispens') { badgeClass = 'b-strandskydd'; badgeLabel = 'Strandskydd'; }
    else if (pt === 'anmälan') { badgeClass = 'b-anmalan'; badgeLabel = 'Anmälan'; }
    else {
      const isNy = (p.atgard || '').toLowerCase().includes('nybyggnad');
      badgeClass = isNy ? 'b-ny' : 'b-till';
      badgeLabel = isNy ? 'Nybyggnad' : 'Tillbyggnad';
    }
    const status = (p.status || '').toLowerCase();
    const statusLabel = status === 'ansökt' ? 'Ansökt' : status === 'startbesked' ? 'Startbesked' : 'Beviljat';
    const statusCls = status === 'ansökt' ? 'status-ansökt' : status === 'startbesked' ? 'status-startbesked' : 'status-beviljat';
    const dateStr = p.beslutsdatum
      ? new Date(p.beslutsdatum + 'T12:00:00').toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })
      : '';
    return `<div class="card" style="border-left:4px solid var(--border,#ddd)">
  <div class="card-top"><span class="badge ${badgeClass}">${badgeLabel}</span><span class="card-date ${statusCls}">${dateStr ? statusLabel + ' ' + dateStr : ''}</span></div>
  <div class="card-address">${p.fastighetsbeteckning || ''}</div>
  <div class="card-sub">${[p.atgard, p.diarienummer].filter(Boolean).join(' · ')}</div>
  <div class="card-footer"><span class="card-place">${p.kommun || ''}</span></div>
</div>`;
  }).join('\n');
}

app.get('/', async (req, res) => {
  try {
    const [permits, html] = await Promise.all([
      getAllPermits(),
      fs.promises.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8'),
    ]);
    const ssrHtml = ssrPermitCards(permits);
    const injected = html.replace(
      '<div class="cards-loading">Laddar bygglov…</div>',
      ssrHtml || '<div class="cards-loading">Laddar bygglov…</div>'
    );
    res.type('html').send(injected);
  } catch (err) {
    console.error('[SSR]', err.message);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/stockholm/nacka', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/varmdo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/huddinge', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/sundbyberg', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/solna', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/ekero', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/taby', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/botkyrka', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/haninge', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/nykvarn', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/vallentuna', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/vaxholm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/knivsta', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/norrtalje', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/nynashamn', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/sodertalje', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/salem', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/osteraker', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/jarfalla', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/sigtuna', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/upplands-vasby', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/lidingo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/norrtalje', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/danderyd', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/stockholm/tyreso', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ByggSignal körs på http://localhost:${PORT}`);
});
