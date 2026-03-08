// Engångsskript: hämtar alla Stockholm stad-ärenden från 2024-01-01 till idag,
// månad för månad (API:et har ett tak på ~1200 poster per anrop).
// Dubbletter hanteras av upsert ON CONFLICT diarienummer.
//
// Kör en gång: node backfill-stockholm.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchMonth(from, to) {
  return new Promise((resolve, reject) => {
    const params = `ExtendedAddress=false&Description=&CaseStartDateFrom=${from}&CaseStartDateTo=${to}&Page=1`;
    const url = `https://etjanster.stockholm.se/byggochplantjansten/arendeochhandlingar?${params}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(/var CaseSearchResultsViewModel = ({[\s\S]*?});\s/);
        if (!m) return resolve(null);
        try { resolve(JSON.parse(m[1])); } catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

function inferStatus(description) {
  if (!description) return 'ansökt';
  const d = description.toLowerCase();
  if (d.includes('startbesked'))                             return 'startbesked';
  if (d.includes('kungörelse') || d.includes('tidsbegränsat lov')) return 'beviljat';
  if (d.includes('ansökan') || d.includes('inkommit'))       return 'ansökt';
  if (d.includes('förhandsbesked'))                          return 'förhandsbesked';
  if (d.includes('rivningslov'))                             return 'rivningslov';
  if (d.includes('marklov'))                                 return 'marklov';
  return 'ansökt';
}

const RELEVANT_KEYWORDS = [
  'nybyggnad', 'tillbyggnad', 'rivningslov', 'rivning',
  'attefalls', 'komplementbyggnad', 'fasadändring',
  'marklov', 'förhandsbesked', 'startbesked', 'eldstad',
];

function isRelevant(description) {
  if (!description) return false;
  const d = description.toLowerCase();
  return RELEVANT_KEYWORDS.some(kw => d.includes(kw));
}

// Returnerar sista dag i en given månad
function lastDay(year, month) {
  return new Date(year, month, 0).getDate(); // month är 1-baserat, dag 0 = sista i föregående
}

// Generera lista av [from, to] per månad från startYear/startMonth till och med idag
function monthWindows(startYear, startMonth) {
  const windows = [];
  const now = new Date();
  let y = startYear, m = startMonth;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = lastDay(y, m);
    const to   = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    windows.push([from, to]);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return windows;
}

async function backfill() {
  const windows = monthWindows(2024, 1);
  console.log(`Backfill Stockholm stad: ${windows.length} månader (${windows[0][0]} → ${windows[windows.length-1][1]})\n`);

  let totalSaved = 0;
  let totalSkipped = 0;

  for (const [from, to] of windows) {
    process.stdout.write(`  ${from} – ${to} ... `);
    const vm = await fetchMonth(from, to);

    if (!vm) {
      console.log('MISSLYCKADES (null)');
      await sleep(3000);
      continue;
    }

    const cases = vm.BuildCases.CaseSearchDetails;
    const relevant = cases.filter(c => isRelevant(c.Description));
    process.stdout.write(`${cases.length} ärenden, ${relevant.length} relevanta ... `);

    let saved = 0;
    let skipped = 0;
    for (const c of relevant) {
      const { error } = await sb.from('permits').upsert({
        kommun: 'Stockholm stad',
        adress: c.RealEstateAddress || null,
        fastighetsbeteckning: c.RealEstateName || null,
        atgard: c.Description || null,
        diarienummer: c.Name || null,
        beslutsdatum: c.StartDate ? new Date(c.StartDate).toISOString().split('T')[0] : null,
        status: inferStatus(c.Description),
        source_url: 'etjanster.stockholm.se',
      }, { onConflict: 'diarienummer', ignoreDuplicates: false });

      if (error) { skipped++; }
      else        { saved++; }
    }

    console.log(`sparat ${saved}, fel ${skipped}`);
    totalSaved  += saved;
    totalSkipped += skipped;

    // Var snäll mot servern — 1s paus mellan månader
    await sleep(1000);
  }

  console.log(`\nKlart! Totalt: ${totalSaved} sparade, ${totalSkipped} fel.`);
}

backfill().catch(console.error);
