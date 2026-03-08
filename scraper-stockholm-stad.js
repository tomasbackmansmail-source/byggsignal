const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = 'https://abnlmxkgdkyyvbagewgf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFibmxteGtnZGt5eXZiYWdld2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTA0MjIsImV4cCI6MjA4ODM2NjQyMn0.WZX-_07Ky1jR4oz3ICPXPgwuSge-jUACfI4DWWQ3es8';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function fetchAll(fromDate) {
  return new Promise((resolve, reject) => {
    const params = `ExtendedAddress=false&Description=&CaseStartDateFrom=${fromDate}&Page=1`;
    const url = `https://etjanster.stockholm.se/byggochplantjansten/arendeochhandlingar?${params}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(/var CaseSearchResultsViewModel = ({[\s\S]*?});\s/);
        if (!m) return resolve(null);
        try { resolve(JSON.parse(m[1])); } catch(e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

// API:et har inget statusfält — härleds från beskrivningen
function inferStatus(description) {
  if (!description) return 'registrerat';
  const d = description.toLowerCase();
  if (d.includes('startbesked')) return 'startbesked';
  if (d.includes('kungörelse') || d.includes('tidsbegränsat lov')) return 'beviljat';
  if (d.includes('ansökan') || d.includes('inkommit')) return 'ansökt';
  if (d.includes('förhandsbesked')) return 'förhandsbesked';
  if (d.includes('rivningslov')) return 'rivningslov';
  if (d.includes('marklov')) return 'marklov';
  return 'registrerat';
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

async function scrape() {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const dateStr = fromDate.toISOString().split('T')[0];
  console.log(`Scraping Stockholm stad från ${dateStr} (90 dagar)...\n`);

  const vm = await fetchAll(dateStr);
  if (!vm) {
    console.log('Kunde inte hämta/parsa data från Stockholm stad.');
    return;
  }

  const cases = vm.BuildCases.CaseSearchDetails;
  const relevant = cases.filter(c => isRelevant(c.Description));
  console.log(`Hittade ${cases.length} ärenden totalt, ${relevant.length} relevanta\n`);

  // Breakdown by keyword
  const byKw = {};
  for (const kw of RELEVANT_KEYWORDS) {
    const n = relevant.filter(c => c.Description && c.Description.toLowerCase().includes(kw)).length;
    if (n > 0) byKw[kw] = n;
  }
  console.log('Fördelning:', JSON.stringify(byKw));

  let saved = 0;
  let skipped = 0;

  for (const c of relevant) {
    const status = inferStatus(c.Description);
    const { error } = await sb.from('permits').upsert({
      kommun: 'Stockholm stad',
      adress: c.RealEstateAddress || null,
      fastighetsbeteckning: c.RealEstateName || null,
      atgard: c.Description || null,
      diarienummer: c.Name || null,
      beslutsdatum: c.StartDate ? new Date(c.StartDate).toISOString().split('T')[0] : null,
      status,
      source_url: 'etjanster.stockholm.se'
    }, { onConflict: 'diarienummer', ignoreDuplicates: false });

    if (error) { console.log(`  x ${c.Name}: ${error.message}`); skipped++; }
    else { saved++; }
  }

  console.log(`\nSparade: ${saved}`);
  console.log(`Hoppade över (fel): ${skipped}`);
  console.log('\nKlart!');
}

scrape().catch(console.error);
