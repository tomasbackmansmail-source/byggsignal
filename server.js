require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Stripe webhook hanteras av api/webhook/stripe.js (Vercel serverless function)
// Se vercel.json för routing.

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hämta email + plan från en Stripe Checkout Session (för welcome-flödet)
app.get('/api/checkout-session', async (req, res) => {
  const sessionId = req.query.id;
  if (!sessionId) return res.status(400).json({ error: 'Missing session id' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const email = session.customer_email || session.customer_details?.email || null;
    const plan = session.metadata?.plan || 'trial';
    res.json({ email, plan });
  } catch (err) {
    console.error('[checkout-session]', err.message);
    res.status(404).json({ error: 'Session not found' });
  }
});

// Paginated query for API consumers
async function getPermitsPaginated({ lan, kommun, dagar = 30, limit = 500, offset = 0 } = {}) {
  let query = supabase
    .from('permits_v2')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (kommun) query = query.eq('municipality', kommun);
  else if (lan) query = query.eq('lan', lan);

  if (dagar) {
    const cutoff = new Date(Date.now() - dagar * 24 * 60 * 60 * 1000).toISOString();
    query = query.or(`created_at.gte.${cutoff},created_at.is.null`);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) throw error;
  const label = kommun || lan || 'alla';
  console.log(`[permits] ${label}: ${data.length}/${count} (offset=${offset}, limit=${limit}, dagar=${dagar})`);
  return { data, total: count, offset, limit };
}

// Fetch all permits (for internal/analytics use)
async function getAllPermits() {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('permits_v2')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  console.log(`[permits] alla: ${all.length} rader`);
  return all;
}

function renderPage(permits) {
  const cards = permits.map(p => {
    const badge = p.description && p.description.includes('nybyggnad')
      ? '<span class="badge new">Nybyggnad</span>'
      : '<span class="badge ext">Tillbyggnad</span>';

    return `
    <div class="card">
      <div class="card-header">
        ${badge}
        <span class="kommun">${p.municipality || 'Nacka'}</span>
      </div>
      <h2 class="fastighet">${p.property || '—'}</h2>
      <p class="atgard">${p.description || '—'}</p>
      <div class="locked-row">
        <span class="lock-icon">🔒</span>
        <span class="locked-text">Adress tillgänglig för premiumanvändare</span>
      </div>
      <div class="meta">
        <span>${p.case_number}</span>
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

// --- EXPIRY CHECK ---
app.get('/api/check-expiry', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('plan, max_expires_at, pro_expires_at, trial_expires_at')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  const now = new Date();
  const updates = {};

  // Max plan expired
  if (profile.plan === 'max' && profile.max_expires_at && new Date(profile.max_expires_at) < now) {
    updates.plan = 'free';
    updates.max_expires_at = null;
    console.log('[expiry] Max expired for user:', user.id);
  }

  // Pro plan with expiry (24h trial) expired
  if (profile.plan === 'pro' && profile.pro_expires_at && new Date(profile.pro_expires_at) < now) {
    updates.plan = 'free';
    updates.pro_expires_at = null;
    console.log('[expiry] Pro (24h) expired for user:', user.id);
  }

  // Trial expired
  if (profile.plan === 'trial' && profile.trial_expires_at && new Date(profile.trial_expires_at) < now) {
    updates.plan = 'free';
    updates.trial_expires_at = null;
    console.log('[expiry] Trial expired for user:', user.id);
  }

  if (Object.keys(updates).length > 0) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select('plan, max_expires_at, pro_expires_at, trial_expires_at')
      .single();
    console.log('[expiry] Downgrade result:', JSON.stringify({ data, error }));
    return res.json({ downgraded: true, plan: updates.plan });
  }

  res.json({ downgraded: false, plan: profile.plan });
});

// --- SHARED ÅTGÄRDS-GRUPPERING ---
// EN källa — används av /api/insights (SQL ILIKE), /api/analys (JS-matchning), pipeline
const ATGARD_KEYWORDS = {
  eldstad:           ['eldstad', 'rokkanal', 'rökkanal', 'kakelugn', 'kamin'],
  tillbyggnad:       ['tillbygg', 'ombygg'],
  nybyggnad:         ['nybygg'],
  komplementbyggnad: ['komplement', 'friggebod', 'attefalls'],
  altan:             ['altan', 'balkong', 'terrass'],
  tak:               ['tak', 'kupa'],
  fasad:             ['fasad', 'exteriör', 'yttre'],
  solceller:         ['solcell', 'solpanel', 'solenergianlägg'],
  carport:           ['carport', 'garage', 'förråd'],
  rivning:           ['rivning', 'riva'],
  kok_bad:           ['kök', 'badrum', 'våtrum'],
  skylt:             ['skylt', 'ljus', 'reklam'],
};

// JS-side categorization — shared by analys, pipeline, per-atgard
function categorizeAtgard(atgard) {
  if (!atgard) return 'Övrigt';
  const a = atgard.toLowerCase();
  for (const [cat, keywords] of Object.entries(ATGARD_KEYWORDS)) {
    if (keywords.some(kw => a.includes(kw))) return cat;
  }
  return 'Övrigt';
}

// --- INSIGHTS API (cached 30 min) ---
let insightsCache = null;
let insightsCacheTime = 0;
const INSIGHTS_TTL = 30 * 60 * 1000; // 30 min

async function buildInsights() {
  const categories = {};
  // DB stores Swedish status values (ansökt, överklagat etc). Map DB→display for response keys.
  const statusEntries = [['ansökt', 'ansökt'], ['beviljat', 'beviljat'], ['startbesked', 'startbesked']];

  // Run all category+status queries in parallel (derives ILIKE from shared ATGARD_KEYWORDS)
  const queries = [];
  for (const [cat, keywords] of Object.entries(ATGARD_KEYWORDS)) {
    for (const [dbStatus, displayStatus] of statusEntries) {
      queries.push({ cat, dbStatus, displayStatus, keywords });
    }
  }

  const results = await Promise.all(queries.map(({ cat, keywords, dbStatus, displayStatus }) => {
    const orFilter = keywords.map(kw => `description.ilike.%${kw}%`).join(',');
    return supabase
      .from('permits_v2')
      .select('id', { count: 'exact', head: true })
      .or(orFilter)
      .ilike('status', `%${dbStatus}%`)
      .then(r => ({ cat, displayStatus, count: r.count || 0 }));
  }));

  for (const { cat, displayStatus, count } of results) {
    if (!categories[cat]) categories[cat] = { ansökt: 0, beviljat: 0, startbesked: 0 };
    categories[cat][displayStatus] = count;
  }

  // Totals
  const today = new Date().toISOString().slice(0, 10);
  const [totalR, ansR, bevR, startR, nyaR, nyaBevR] = await Promise.all([
    supabase.from('permits_v2').select('id', { count: 'exact', head: true }),
    supabase.from('permits_v2').select('id', { count: 'exact', head: true }).ilike('status', '%ansökt%'),
    supabase.from('permits_v2').select('id', { count: 'exact', head: true }).ilike('status', '%beviljat%'),
    supabase.from('permits_v2').select('id', { count: 'exact', head: true }).ilike('status', '%startbesked%'),
    supabase.from('permits_v2').select('id', { count: 'exact', head: true }).gte('created_at', today),
    supabase.from('permits_v2').select('id', { count: 'exact', head: true }).gte('created_at', today).ilike('status', '%beviljat%'),
  ]);

  return {
    categories,
    totals: {
      ansökt: ansR.count || 0,
      beviljat: bevR.count || 0,
      startbesked: startR.count || 0,
      total: totalR.count || 0,
    },
    nya_idag: nyaR.count || 0,
    nya_beviljat_idag: nyaBevR.count || 0,
    updated_at: new Date().toISOString(),
  };
}

app.get('/api/insights', async (req, res) => {
  try {
    const now = Date.now();
    if (!insightsCache || (now - insightsCacheTime) > INSIGHTS_TTL) {
      insightsCache = await buildInsights();
      insightsCacheTime = now;
      console.log('[insights] Cache refreshed');
    }
    res.json(insightsCache);
  } catch (err) {
    console.error('[insights]', err);
    res.status(500).json({ error: err.message });
  }
});

// --- COVERAGE API ---
let coverageCache = null;
let coverageCacheTime = 0;
const COVERAGE_TTL = 30 * 60 * 1000;

app.get('/api/coverage', async (req, res) => {
  try {
    const now = Date.now();
    if (!coverageCache || (now - coverageCacheTime) > COVERAGE_TTL) {
      // Fetch all permits and aggregate in JS (Supabase JS client doesn't support GROUP BY)
      const permits = await getAllPermits();
      const byKommun = {};
      for (const p of permits) {
        const key = p.municipality || 'Okänd';
        if (!byKommun[key]) {
          byKommun[key] = { kommun: key, lan: p.lan || '', antal: 0, beviljat: 0, senast_skrapad: null };
        }
        byKommun[key].antal++;
        if ((p.status || '').toLowerCase().includes('beviljat')) byKommun[key].beviljat++;
        const sa = p.created_at ? p.created_at.slice(0, 10) : null;
        if (sa && (!byKommun[key].senast_skrapad || sa > byKommun[key].senast_skrapad)) {
          byKommun[key].senast_skrapad = sa;
        }
      }

      const municipalities = Object.values(byKommun).sort((a, b) =>
        (a.lan || '').localeCompare(b.lan || '', 'sv') || (a.kommun || '').localeCompare(b.kommun || '', 'sv')
      );
      const lanSet = new Set(municipalities.map(m => m.lan).filter(Boolean));
      coverageCache = {
        municipalities,
        summary: {
          total_kommuner: municipalities.length,
          total_arenden: permits.length,
          lan_count: lanSet.size,
        },
        updated_at: new Date().toISOString(),
      };
      coverageCacheTime = now;
      console.log('[coverage] Cache refreshed:', municipalities.length, 'kommuner');
    }
    res.json(coverageCache);
  } catch (err) {
    console.error('[coverage]', err);
    res.status(500).json({ error: err.message });
  }
});

// --- ANALYS API (cached 30 min, all data open) ---
let analysCache = null;
let analysCacheTime = 0;
const ANALYS_TTL = 30 * 60 * 1000;

const KOMMUNER_PER_LAN = {
  'stockholms län': 26, 'uppsala län': 8, 'södermanlands län': 9,
  'östergötlands län': 13, 'jönköpings län': 13, 'kronobergs län': 8,
  'kalmar län': 12, 'gotlands län': 1, 'blekinge län': 5, 'skåne län': 33,
  'hallands län': 6, 'västra götalands län': 49, 'värmlands län': 16,
  'örebro län': 12, 'västmanlands län': 10, 'dalarnas län': 15,
  'gävleborgs län': 10, 'västernorrlands län': 7, 'jämtlands län': 8,
  'västerbottens län': 15, 'norrbottens län': 14,
};

async function buildAnalysData() {
  const permits = await getAllPermits();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const kommunSet = new Set();
  const perDag = {};
  const perLan = {};
  const perKommun = {};
  const kommunAtgardCounts = {};
  const perAtgard = {};
  const perManad = {};
  let eldstaDatum = null;

  for (const p of permits) {
    const kommun = p.municipality || 'Okänd';
    const lan = p.lan || 'Okänt';
    const status = (p.status || '').toLowerCase();
    const beslut = p.date;
    const scraped = p.created_at ? p.created_at.slice(0, 10) : null;
    const cat = categorizeAtgard(p.description);

    if (p.municipality) kommunSet.add(p.municipality);

    const isBev = status.includes('beviljat');
    const isAns = status.includes('ansökt');
    const isSta = status.includes('startbesked');

    // Äldsta datum
    if (beslut && (!eldstaDatum || beslut < eldstaDatum)) eldstaDatum = beslut;

    // Per dag (senaste 30 dagar)
    if (beslut && beslut >= thirtyDaysAgo) {
      if (!perDag[beslut]) perDag[beslut] = { datum: beslut, total: 0, beviljat: 0, ansokt: 0, startbesked: 0 };
      perDag[beslut].total++;
      if (isBev) perDag[beslut].beviljat++;
      if (isAns) perDag[beslut].ansokt++;
      if (isSta) perDag[beslut].startbesked++;
    }

    // Per län
    if (!perLan[lan]) perLan[lan] = { lan, total: 0, kommuner: new Set() };
    perLan[lan].total++;
    if (p.municipality) perLan[lan].kommuner.add(p.municipality);

    // Per kommun
    if (!perKommun[kommun]) perKommun[kommun] = { kommun, lan, total: 0, beviljat: 0, ansokt: 0, startbesked: 0, senast_skrapad: null };
    perKommun[kommun].total++;
    if (isBev) perKommun[kommun].beviljat++;
    if (isAns) perKommun[kommun].ansokt++;
    if (isSta) perKommun[kommun].startbesked++;
    if (scraped && (!perKommun[kommun].senast_skrapad || scraped > perKommun[kommun].senast_skrapad)) {
      perKommun[kommun].senast_skrapad = scraped;
    }

    // Kommun åtgärdsräkning
    if (!kommunAtgardCounts[kommun]) kommunAtgardCounts[kommun] = {};
    kommunAtgardCounts[kommun][cat] = (kommunAtgardCounts[kommun][cat] || 0) + 1;

    // Per åtgärdstyp
    if (!perAtgard[cat]) perAtgard[cat] = { atgard: cat, total: 0, beviljat: 0, ansokt: 0, startbesked: 0 };
    perAtgard[cat].total++;
    if (isBev) perAtgard[cat].beviljat++;
    if (isAns) perAtgard[cat].ansokt++;
    if (isSta) perAtgard[cat].startbesked++;

    // Per månad
    const manadSrc = beslut || (p.created_at ? p.created_at.slice(0, 10) : null);
    if (manadSrc) {
      const m = manadSrc.slice(0, 7);
      if (!perManad[m]) perManad[m] = { manad: m, total: 0, beviljat: 0, ansokt: 0, startbesked: 0 };
      perManad[m].total++;
      if (isBev) perManad[m].beviljat++;
      if (isAns) perManad[m].ansokt++;
      if (isSta) perManad[m].startbesked++;
    }
  }

  // Vanligaste åtgärd per kommun
  for (const k of Object.keys(perKommun)) {
    const cats = kommunAtgardCounts[k] || {};
    let best = 'Övrigt', bestCount = 0;
    for (const [cat, count] of Object.entries(cats)) {
      if (count > bestCount) { best = cat; bestCount = count; }
    }
    perKommun[k].vanligaste_atgard = best;
  }

  return {
    hero: {
      total: permits.length,
      kommuner: kommunSet.size,
      rikstackning: Math.round((kommunSet.size / 290) * 1000) / 10,
    },
    eldsta_datum: eldstaDatum,
    per_dag: Object.values(perDag).sort((a, b) => a.datum.localeCompare(b.datum)),
    per_lan: Object.values(perLan).map(l => {
      const key = (l.lan || '').toLowerCase();
      const tot = KOMMUNER_PER_LAN[key] || 0;
      return {
        lan: l.lan, total: l.total,
        kommuner_med_data: l.kommuner.size, kommuner_totalt: tot,
        tackning_procent: tot ? Math.round((l.kommuner.size / tot) * 100) : 0,
      };
    }).sort((a, b) => b.total - a.total),
    per_kommun: Object.values(perKommun).sort((a, b) => b.total - a.total),
    per_atgardstyp: Object.values(perAtgard).sort((a, b) => b.total - a.total),
    per_manad: Object.values(perManad).sort((a, b) => a.manad.localeCompare(b.manad)),
    updated_at: new Date().toISOString(),
  };
}

app.get('/api/analys', async (req, res) => {
  try {
    const now = Date.now();
    if (!analysCache || (now - analysCacheTime) > ANALYS_TTL) {
      analysCache = await buildAnalysData();
      analysCacheTime = now;
      console.log('[analys] Cache refreshed');
    }
    res.json(analysCache);
  } catch (err) {
    console.error('[analys]', err);
    res.status(500).json({ error: err.message });
  }
});

// --- ANALYTICS ENDPOINTS (8 new, existing endpoints untouched) ---

// Shared normalizeAtgard — used by per-atgard, pipeline
function normalizeAtgard(rawAtgard) {
  if (!rawAtgard) return 'Övrigt';
  const a = rawAtgard.toLowerCase();
  if (a.includes('nybyggnad')) return 'Nybyggnad';
  if (a.includes('tillbyggnad')) return 'Tillbyggnad';
  if (a.includes('eldstad') || a.includes('rokkanal') || a.includes('skorsten')) return 'Eldstad/rökkanal';
  if (a.includes('fasad')) return 'Fasadändring';
  if (a.includes('rivning') || a.includes('riv')) return 'Rivning';
  if (a.includes('skylt')) return 'Skylt';
  if (a.includes('attefall')) return 'Attefallsåtgärd';
  if (a.includes('marklov') || a.includes('mark')) return 'Marklov';
  if (a.includes('altan') || a.includes('uteplats') || a.includes('balkong')) return 'Altan/uteplats';
  if (a.includes('carport') || a.includes('garage') || a.includes('förråd') || a.includes('forrad')) return 'Carport/garage';
  return 'Övrigt';
}

// Cached permits shared across all analytics endpoints
let _anPermits = null;
let _anPermitsTime = 0;
const _AN_TTL = 30 * 60 * 1000;

async function getCachedPermits() {
  const now = Date.now();
  if (!_anPermits || (now - _anPermitsTime) > _AN_TTL) {
    _anPermits = await getAllPermits();
    _anPermitsTime = now;
    console.log('[analytics] Permits cache refreshed:', _anPermits.length);
  }
  return _anPermits;
}

function statusFlags(s) {
  const st = (s || '').toLowerCase();
  return {
    bev: st.includes('beviljat'),
    ans: st.includes('ansökt'),
    sta: st.includes('startbesked'),
  };
}

// 3a) GET /api/analytics/per-lan
app.get('/api/analytics/per-lan', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const byLan = {};
    for (const p of permits) {
      const lan = p.lan || 'Okänt';
      if (!byLan[lan]) byLan[lan] = { total: 0, beviljade: 0, kommuner: new Set(), senast: null };
      byLan[lan].total++;
      if (statusFlags(p.status).bev) byLan[lan].beviljade++;
      if (p.municipality) byLan[lan].kommuner.add(p.municipality);
      const sa = p.created_at ? p.created_at.slice(0, 10) : null;
      if (sa && (!byLan[lan].senast || sa > byLan[lan].senast)) byLan[lan].senast = sa;
    }

    // Build all 21 län (even empty ones)
    const result = [];
    for (const [key, kommuner_totalt] of Object.entries(KOMMUNER_PER_LAN)) {
      const match = Object.entries(byLan).find(([lan]) => lan.toLowerCase() === key);
      const d = match ? match[1] : null;
      const kommuner_aktiva = d ? d.kommuner.size : 0;
      result.push({
        lan: match ? match[0] : key.charAt(0).toUpperCase() + key.slice(1),
        total: d ? d.total : 0,
        beviljade: d ? d.beviljade : 0,
        kommuner_aktiva,
        kommuner_totalt,
        tackning_procent: kommuner_totalt ? Math.round((kommuner_aktiva / kommuner_totalt) * 1000) / 10 : 0,
        senast_skrapad: d ? d.senast : null,
      });
    }
    // Add any län not in reference
    for (const [lan, d] of Object.entries(byLan)) {
      if (!KOMMUNER_PER_LAN[lan.toLowerCase()]) {
        result.push({ lan, total: d.total, beviljade: d.beviljade, kommuner_aktiva: d.kommuner.size, kommuner_totalt: 0, tackning_procent: 0, senast_skrapad: d.senast });
      }
    }
    result.sort((a, b) => b.total - a.total);
    res.json({ data: result, meta: { updated_at: new Date().toISOString() } });
  } catch (err) {
    console.error('[analytics/per-lan]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3b) GET /api/analytics/daily
app.get('/api/analytics/daily', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const byDag = {};
    const kommuner = new Set();
    let senast = null;
    let count = 0;

    for (const p of permits) {
      const d = p.date;
      if (!d || d < cutoff) continue;
      if (!byDag[d]) byDag[d] = { dag: d, total: 0, beviljade: 0, ansokta: 0 };
      byDag[d].total++;
      count++;
      const fl = statusFlags(p.status);
      if (fl.bev) byDag[d].beviljade++;
      if (fl.ans) byDag[d].ansokta++;
      if (p.municipality) kommuner.add(p.municipality);
      const sa = p.created_at;
      if (sa && (!senast || sa > senast)) senast = sa;
    }
    const data = Object.values(byDag).sort((a, b) => a.dag.localeCompare(b.dag));
    res.json({
      data,
      meta: { antal_kommuner: kommuner.size, antal_arenden: count, senast_uppdaterad: senast || null },
    });
  } catch (err) {
    console.error('[analytics/daily]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3c) GET /api/analytics/per-atgard
app.get('/api/analytics/per-atgard', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const byAtg = {};
    for (const p of permits) {
      const cat = normalizeAtgard(p.description);
      if (!byAtg[cat]) byAtg[cat] = { atgard: cat, total: 0, beviljade: 0, ansokta: 0 };
      byAtg[cat].total++;
      const fl = statusFlags(p.status);
      if (fl.bev) byAtg[cat].beviljade++;
      if (fl.ans) byAtg[cat].ansokta++;
    }
    const sorted = Object.values(byAtg).sort((a, b) => b.total - a.total);
    // Top 10 + övrigt bundle
    let data;
    if (sorted.length > 11) {
      const top = sorted.slice(0, 10);
      const rest = sorted.slice(10).reduce((acc, d) => { acc.total += d.total; acc.beviljade += d.beviljade; acc.ansokta += d.ansokta; return acc; }, { atgard: 'Övrigt (sammanslagen)', total: 0, beviljade: 0, ansokta: 0 });
      data = [...top, rest];
    } else {
      data = sorted;
    }
    res.json({ data, meta: { updated_at: new Date().toISOString() } });
  } catch (err) {
    console.error('[analytics/per-atgard]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3d) GET /api/analytics/pipeline
app.get('/api/analytics/pipeline', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const byAtg = {};
    for (const p of permits) {
      const cat = normalizeAtgard(p.description);
      if (!byAtg[cat]) byAtg[cat] = { atgard: cat, ansokta: 0, beviljade: 0, startbesked: 0, total: 0 };
      byAtg[cat].total++;
      const fl = statusFlags(p.status);
      if (fl.bev) byAtg[cat].beviljade++;
      if (fl.ans) byAtg[cat].ansokta++;
      if (fl.sta) byAtg[cat].startbesked++;
    }
    const data = Object.values(byAtg).sort((a, b) => b.total - a.total);
    res.json({ data, meta: { updated_at: new Date().toISOString() } });
  } catch (err) {
    console.error('[analytics/pipeline]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3e) GET /api/analytics/per-manad
app.get('/api/analytics/per-manad', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const byManad = {};
    let aldsta = null, senaste = null;
    for (const p of permits) {
      const d = p.date;
      if (!d) continue;
      const m = d.slice(0, 7);
      if (!byManad[m]) byManad[m] = { manad: m, total: 0, beviljade: 0, ansokta: 0 };
      byManad[m].total++;
      const fl = statusFlags(p.status);
      if (fl.bev) byManad[m].beviljade++;
      if (fl.ans) byManad[m].ansokta++;
      if (!aldsta || d < aldsta) aldsta = d;
      if (!senaste || d > senaste) senaste = d;
    }
    const data = Object.values(byManad).sort((a, b) => a.manad.localeCompare(b.manad));
    res.json({
      data,
      meta: { aldsta_data: aldsta, senaste_data: senaste, updated_at: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[analytics/per-manad]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3f) GET /api/analytics/per-kommun?lan=stockholms+län
app.get('/api/analytics/per-kommun', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const lanFilter = (req.query.lan || '').toLowerCase();
    const byKommun = {};
    for (const p of permits) {
      if (lanFilter && (p.lan || '').toLowerCase() !== lanFilter) continue;
      const k = p.municipality || 'Okänd';
      if (!byKommun[k]) byKommun[k] = { kommun: k, lan: p.lan || '', total: 0, beviljade: 0, senast_skrapad: null };
      byKommun[k].total++;
      if (statusFlags(p.status).bev) byKommun[k].beviljade++;
      const sa = p.created_at ? p.created_at.slice(0, 10) : null;
      if (sa && (!byKommun[k].senast_skrapad || sa > byKommun[k].senast_skrapad)) byKommun[k].senast_skrapad = sa;
    }
    const data = Object.values(byKommun).sort((a, b) => b.total - a.total).slice(0, 20);
    const antal_kommuner = Object.keys(byKommun).length;
    res.json({
      data,
      meta: { lan_filter: lanFilter || null, antal_kommuner, updated_at: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[analytics/per-kommun]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3g) GET /api/analytics/compare?kommuner=nacka,varmdo,taby
app.get('/api/analytics/compare', async (req, res) => {
  try {
    const raw = req.query.kommuner || '';
    const names = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (names.length < 2 || names.length > 4) {
      return res.status(400).json({ error: 'Ange 2–4 kommuner (kommaseparerade)' });
    }

    const permits = await getCachedPermits();
    const byKommun = {};
    for (const p of permits) {
      const k = (p.municipality || '').toLowerCase();
      if (!names.includes(k)) continue;
      const display = p.municipality || k;
      if (!byKommun[k]) byKommun[k] = { kommun: display, lan: p.lan || '', total: 0, beviljade: 0, ansokta: 0, senast_skrapad: null };
      byKommun[k].total++;
      const fl = statusFlags(p.status);
      if (fl.bev) byKommun[k].beviljade++;
      if (fl.ans) byKommun[k].ansokta++;
      const sa = p.created_at ? p.created_at.slice(0, 10) : null;
      if (sa && (!byKommun[k].senast_skrapad || sa > byKommun[k].senast_skrapad)) byKommun[k].senast_skrapad = sa;
    }
    // Add tackning_procent from län
    const data = Object.values(byKommun).map(d => {
      const lanKey = (d.lan || '').toLowerCase();
      const lanTot = KOMMUNER_PER_LAN[lanKey] || 0;
      // Count how many kommuner we have in this län
      const kommunerInLan = new Set(permits.filter(p => (p.lan || '').toLowerCase() === lanKey).map(p => p.municipality)).size;
      return { ...d, tackning_procent: lanTot ? Math.round((kommunerInLan / lanTot) * 1000) / 10 : 0 };
    });
    res.json({ data });
  } catch (err) {
    console.error('[analytics/compare]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3h) GET /api/analytics/approval-rate
app.get('/api/analytics/approval-rate', async (req, res) => {
  try {
    const permits = await getCachedPermits();
    const byKommun = {};
    for (const p of permits) {
      const k = p.municipality || 'Okänd';
      if (!byKommun[k]) byKommun[k] = { total: 0, beviljade: 0 };
      byKommun[k].total++;
      if (statusFlags(p.status).bev) byKommun[k].beviljade++;
    }
    const data = Object.entries(byKommun)
      .filter(([, d]) => d.total >= 5)
      .map(([kommun, d], i) => ({
        kommun,
        total: d.total,
        beviljade: d.beviljade,
        andel_beviljad: Math.round((d.beviljade / d.total) * 1000) / 10,
      }))
      .sort((a, b) => b.andel_beviljad - a.andel_beviljad)
      .map((d, i) => ({ rank: i + 1, ...d }));

    res.json({
      data,
      meta: {
        varning: 'Låg beviljningsgrad kan bero på att ärenden nyligen ansökts och ännu inte behandlats.',
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[analytics/approval-rate]', err);
    res.status(500).json({ error: err.message });
  }
});

// --- COMPANY PROFILE API ---

// Helper: extract authenticated user from JWT
async function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

const PROFILE_FIELDS = 'company_name, contact_name, phone, website, tagline, logo_url, project_images, email, plan, max_expires_at, pro_expires_at, trial_expires_at, branches, selected_kommuner, last_seen_at, saved_leads, categories, notis_frequency';

app.get('/api/profile', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Ej autentiserad' });

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/profile', async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Ej autentiserad' });

  const { company_name, contact_name, phone, website, tagline, logo_url, project_images } = req.body || {};

  if (!company_name || !company_name.trim()) {
    return res.status(400).json({ error: 'Företagsnamn är obligatoriskt' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Telefon är obligatoriskt' });
  }

  const updates = {
    company_name: company_name.trim(),
    contact_name: (contact_name || '').trim() || null,
    phone: phone.trim(),
    website: (website || '').trim() || null,
    tagline: (tagline || '').substring(0, 160).trim() || null,
  };

  // Only update image fields if explicitly provided
  if (logo_url !== undefined) updates.logo_url = logo_url || null;
  if (project_images !== undefined) updates.project_images = project_images || [];

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select(PROFILE_FIELDS)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  solceller: 'description.ilike.%solcell%,description.ilike.%solenergianlägg%,description.ilike.%solpanel%,atgarder.ilike.%solcell%',
  eldstad:   'description.ilike.%eldstad%,description.ilike.%rökkanal%,atgarder.ilike.%eldstad%',
  ventilation: 'description.ilike.%ventilation%,description.ilike.%vvs%,atgarder.ilike.%ventilation%',
  'altan-garage': 'description.ilike.%altan%,description.ilike.%carport%,description.ilike.%garage%,atgarder.ilike.%altan%',
};

const FILTER_PAGE_SIZE = 50;

app.get('/api/health', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    // Total permits count
    const { count: permitsTotal, error: e1 } = await supabase
      .from('permits_v2')
      .select('*', { count: 'exact', head: true });
    if (e1) throw e1;

    // Permits scraped today
    const { count: permitsIdag, error: e2 } = await supabase
      .from('permits_v2')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());
    if (e2) throw e2;

    // Total distinct kommuner (paginated to avoid 1000-row limit)
    const kommunerAllSet = new Set();
    let from3 = 0;
    while (true) {
      const { data, error } = await supabase
        .from('permits_v2')
        .select('municipality')
        .range(from3, from3 + 999);
      if (error) throw error;
      data.forEach(r => kommunerAllSet.add(r.municipality));
      if (data.length < 1000) break;
      from3 += 1000;
    }
    const kommunerTotal = kommunerAllSet.size;

    // Distinct kommuner scraped today (paginated)
    const kommunerDagSet = new Set();
    let from4 = 0;
    while (true) {
      const { data, error } = await supabase
        .from('permits_v2')
        .select('municipality')
        .gte('created_at', todayStart.toISOString())
        .range(from4, from4 + 999);
      if (error) throw error;
      data.forEach(r => kommunerDagSet.add(r.municipality));
      if (data.length < 1000) break;
      from4 += 1000;
    }
    const kommunerIdag = kommunerDagSet.size;

    // Most recent scrape
    const { data: latest, error: e5 } = await supabase
      .from('permits_v2')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (e5) throw e5;

    const senastSkrapad = latest?.[0]?.created_at || null;
    const timmarSedanScrape = senastSkrapad
      ? (now - new Date(senastSkrapad)) / (1000 * 60 * 60)
      : null;

    let scraperStatus = 'unknown';
    if (timmarSedanScrape !== null) {
      if (timmarSedanScrape > 48) scraperStatus = 'dead';
      else if (timmarSedanScrape > 26) scraperStatus = 'missed_schedule';
      else if (timmarSedanScrape > 24) scraperStatus = 'stale';
      else scraperStatus = 'healthy';
    }

    res.json({
      status: 'ok',
      permits_total: permitsTotal,
      permits_idag: permitsIdag,
      kommuner_total: kommunerTotal,
      kommuner_idag: kommunerIdag,
      senast_skrapad: senastSkrapad,
      timmar_sedan_scrape: timmarSedanScrape !== null ? Math.round(timmarSedanScrape * 10) / 10 : null,
      scraper_status: scraperStatus,
    });
  } catch (err) {
    console.error('[health]', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/api/permits', async (req, res) => {
  const { filter, days, page } = req.query;

  // No filter param → return dataset, optionally filtered by lan/kommun/dagar
  if (!filter) {
    try {
      const { lan, kommun } = req.query;
      const dagar = parseInt(req.query.dagar) || 30;
      const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
      const offset = parseInt(req.query.offset) || 0;
      const result = await getPermitsPaginated({ lan, kommun, dagar, limit, offset });
      return res.json(result);
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
      .from('permits_v2')
      .select('*', { count: 'exact' })
      .or(filterOr)
      .or(`created_at.gte.${cutoff},date.gte.${cutoff},created_at.is.null`)
      .order('created_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (req.query.kommun) {
      query = query.eq('municipality', req.query.kommun);
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
  const recent = permits.filter(p => p.date && p.date >= cutoff);
  // Dedup by diarienummer
  const seen = new Set();
  const deduped = recent.filter(p => {
    if (!p.case_number || seen.has(p.case_number)) return false;
    seen.add(p.case_number);
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
      const isNy = (p.description || '').toLowerCase().includes('nybyggnad');
      badgeClass = isNy ? 'b-ny' : 'b-till';
      badgeLabel = isNy ? 'Nybyggnad' : 'Tillbyggnad';
    }
    const status = (p.status || '').toLowerCase();
    const statusLabel = status === 'ansökt' ? 'Ansökt' : status === 'startbesked' ? 'Startbesked' : 'Beviljat';
    const statusCls = status === 'ansökt' ? 'status-ansökt' : status === 'startbesked' ? 'status-startbesked' : 'status-beviljat';
    const dateStr = p.date
      ? new Date(p.date + 'T12:00:00').toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })
      : '';
    return `<div class="card" style="border-left:4px solid var(--border,#ddd)">
  <div class="card-top"><span class="badge ${badgeClass}">${badgeLabel}</span><span class="card-date ${statusCls}">${dateStr ? statusLabel + ' ' + dateStr : ''}</span></div>
  <div class="card-address">${p.property || ''}</div>
  <div class="card-sub">${[p.description, p.case_number].filter(Boolean).join(' · ')}</div>
  <div class="card-footer"><span class="card-place">${p.municipality || ''}</span></div>
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

app.get('/insikt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'insikt.html'));
});

app.get('/analys', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analys.html'));
});

app.get('/tackning', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'coverage.html'));
});

app.get('/mitt-konto', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mitt-konto.html'));
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
