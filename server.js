require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

app.get('/api/permits', async (req, res) => {
  try {
    const permits = await getAllPermits();
    res.json(permits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function ssrPermitCards(permits) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recent = permits.filter(p => p.beslutsdatum && p.beslutsdatum >= cutoff);
  return recent.map(p => {
    const isNy = (p.atgard || '').toLowerCase().includes('nybyggnad');
    const dateStr = p.beslutsdatum
      ? new Date(p.beslutsdatum + 'T12:00:00').toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })
      : '';
    return `<div class="card" style="border-left:4px solid var(--border,#ddd)">
  <div class="card-top"><span class="badge ${isNy ? 'b-ny' : 'b-till'}">${isNy ? 'Nybyggnad' : 'Tillbyggnad'}</span><span class="card-date">${dateStr}</span></div>
  <div class="card-address">${p.adress || p.fastighetsbeteckning || ''}</div>
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
