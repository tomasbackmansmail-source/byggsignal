#!/usr/bin/env node
// scripts/backfill-stockholm.js
// Backfill Stockholm stad bygglov 2020-01 till 2024-12 månadsvis.

require('dotenv').config();
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { parsePermitType } = require('./parse-helpers');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchWindow(from, to) {
  return new Promise((resolve, reject) => {
    const params = `ExtendedAddress=false&Description=&CaseStartDateFrom=${from}&CaseStartDateTo=${to}&Page=1`;
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

function inferStatus(description) {
  if (!description) return null;
  const d = description.toLowerCase();
  if (d.includes('startbesked')) return 'startbesked';
  if (d.includes('kungörelse')) return 'beviljat';
  if (d.includes('ansökan') || d.includes('inkommit') || d.includes('underrättelse')) return 'ansökt';
  return null;
}

async function backfill() {
  const startYear = 2020;
  const endYear = 2024;
  let totalNew = 0;
  let totalExisting = 0;
  let totalAll = 0;

  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const m = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      const from = `${year}-${m}-01`;
      const to = `${year}-${m}-${String(lastDay).padStart(2, '0')}`;

      const vm = await fetchWindow(from, to);
      if (!vm || !vm.BuildCases || !vm.BuildCases.CaseSearchDetails) {
        console.log(`${year}-${m}: Ingen data`);
        await sleep(2000);
        continue;
      }

      const cases = vm.BuildCases.CaseSearchDetails;
      const relevant = cases.filter(c => isRelevant(c.Description));

      // Check which already exist
      const diarienummer = relevant.map(c => c.Name).filter(Boolean);
      const { data: existing } = await sb.from('permits')
        .select('diarienummer, beslutsdatum')
        .in('diarienummer', diarienummer.length ? diarienummer : ['__none__']);
      const existingMap = new Map((existing || []).map(r => [r.diarienummer, r.beslutsdatum]));

      let newCount = 0;
      let existingCount = 0;

      for (const c of relevant) {
        const alreadyExists = existingMap.has(c.Name);
        const apiBd = c.StartDate ? new Date(c.StartDate).toISOString().split('T')[0] : null;
        const beslutsdatum = existingMap.get(c.Name) || apiBd;

        const { error } = await sb.from('permits').upsert({
          kommun: 'Stockholm stad',
          adress: c.RealEstateAddress || null,
          fastighetsbeteckning: c.RealEstateName || null,
          atgard: c.Description || null,
          diarienummer: c.Name || null,
          beslutsdatum,
          scraped_at: beslutsdatum ? new Date(beslutsdatum).toISOString() : new Date().toISOString(),
          status: inferStatus(c.Description),
          permit_type: parsePermitType(c.Description),
          source_url: 'etjanster.stockholm.se'
        }, { onConflict: 'diarienummer', ignoreDuplicates: false });

        if (!error) {
          if (alreadyExists) existingCount++;
          else newCount++;
        }
      }

      totalNew += newCount;
      totalExisting += existingCount;
      totalAll += relevant.length;

      console.log(`${year}-${m}: ${relevant.length} ärenden, ${newCount} nya, ${existingCount} redan fanns`);
      await sleep(2000);
    }
  }

  console.log(`\nBackfill klar: ${totalNew} nya ärenden från 2020-2024 (${totalExisting} redan fanns, ${totalAll} totalt)`);
}

backfill().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
