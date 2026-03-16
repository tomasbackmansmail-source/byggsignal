/**
 * Laddar ner Boverkets plan- och byggenkaten (PBE) Excel-filer
 * och sparar strukturerad data i enrichment_boverket_pbe.
 *
 * Koers: node scripts/fetch-boverket-pbe.js
 *
 * Kraver: npm install xlsx
 */

require('dotenv').config();
const axios = require('axios');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Kanda nedladdnings-URL:er for PBE lov och byggande
const PBE_FILES = [
  { year: 2023, url: 'https://www.boverket.se/contentassets/14b9bc51c466458f801db12401ca9290/plan---och-byggenkaten-lov-och-byggande-2023.xlsx' },
  { year: 2022, url: 'https://www.boverket.se/contentassets/14b9bc51c466458f801db12401ca9290/plan---och-byggenkaten-lov-och-byggande-2022.xlsx' },
  { year: 2021, url: 'https://www.boverket.se/contentassets/14b9bc51c466458f801db12401ca9290/plan---och-byggenkaten-lov-och-byggande-2021.xlsx' },
  { year: 2020, url: 'https://www.boverket.se/contentassets/14b9bc51c466458f801db12401ca9290/plan---och-byggenkaten-lov-och-byggande-2020.xlsx' },
  { year: 2019, url: 'https://www.boverket.se/contentassets/14b9bc51c466458f801db12401ca9290/plan---och-byggenkaten-lov-och-byggande-2019.xlsx' },
  { year: 2018, url: 'https://www.boverket.se/contentassets/9c2de913b9d8491a98f08e4ffc9d27b7/plan--och-byggenkaten-lov-och-byggande-20183.xlsx' },
  { year: 2017, url: 'https://www.boverket.se/contentassets/9c2de913b9d8491a98f08e4ffc9d27b7/plan--och-byggenkaten-lov-och-byggande-2017.xlsx' },
  { year: 2016, url: 'https://www.boverket.se/contentassets/9c2de913b9d8491a98f08e4ffc9d27b7/plan--och-byggenkaten-lov-och-byggande-2016.xlsx' },
  { year: 2015, url: 'https://www.boverket.se/contentassets/9c2de913b9d8491a98f08e4ffc9d27b7/plan--och-byggenkaten-lov-och-byggande-2015.xlsx' },
  { year: 2014, url: 'https://www.boverket.se/contentassets/9c2de913b9d8491a98f08e4ffc9d27b7/plan--och-byggenkaten-lov-och-byggande-2014.xlsx' },
  { year: 2013, url: 'https://www.boverket.se/contentassets/9c2de913b9d8491a98f08e4ffc9d27b7/plan--och-byggenkaten-lov-och-byggande-2013.xlsx' },
];

const RATE_LIMIT_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadExcel(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: {
      'User-Agent': 'ByggSignal/1.0 (enrichment)',
    },
  });
  return res.data;
}

/**
 * Parsar PBE Excel-fil till rader.
 * Filerna varierar i format men foljer generellt:
 * - Forsta kolumn: kommun (namn eller kod+namn)
 * - Ovriga kolumner: metriker (rubrikrad overst)
 */
function parseExcel(buffer, year) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const rows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (data.length < 2) continue;

    // Hitta rubrikraden (forsta raden med "kommun" eller liknande i forsta kolumnen)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const firstCell = String(data[i][0] || '').toLowerCase().trim();
      if (firstCell.includes('kommun') || firstCell.includes('kod') || firstCell.includes('nr')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Anta att forsta raden ar rubrik
      headerRowIdx = 0;
    }

    const headers = data[headerRowIdx].map(h => String(h || '').trim());

    // Identifiera kolumner
    let codeCol = -1;
    let nameCol = -1;
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c].toLowerCase();
      if (h.includes('kommunkod') || h.includes('kod') || h === 'nr') {
        codeCol = c;
      }
      if (h.includes('kommunnamn') || h === 'kommun' || h.includes('municipality')) {
        nameCol = c;
      }
    }

    // Om vi inte hittade separata kolumner, anta att forsta kolumnen ar kommun
    if (nameCol === -1 && codeCol === -1) {
      nameCol = 0;
    }

    // Metric-kolumner: alla utom kod/namn-kolumner
    const metricCols = [];
    for (let c = 0; c < headers.length; c++) {
      if (c === codeCol || c === nameCol) continue;
      if (headers[c] && headers[c].length > 0) {
        metricCols.push({ idx: c, name: headers[c] });
      }
    }

    // Datarader
    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[nameCol !== -1 ? nameCol : 0]) continue;

      const municipalityName = String(row[nameCol !== -1 ? nameCol : 0] || '').trim();
      const municipalityCode = codeCol !== -1 ? String(row[codeCol] || '').trim().padStart(4, '0') : null;

      // Skippa summa/total-rader
      if (municipalityName.toLowerCase().includes('totalt') ||
          municipalityName.toLowerCase().includes('summa') ||
          municipalityName.toLowerCase().includes('riket')) {
        continue;
      }

      for (const metric of metricCols) {
        const rawValue = row[metric.idx];
        if (rawValue === null || rawValue === undefined || rawValue === '' || rawValue === '-') continue;

        const numValue = parseFloat(rawValue);
        if (isNaN(numValue)) continue;

        rows.push({
          municipality_code: municipalityCode,
          municipality_name: municipalityName,
          year: year,
          metric_name: `${sheetName}: ${metric.name}`,
          value: numValue,
        });
      }
    }
  }

  return rows;
}

async function main() {
  let totalRows = 0;
  let filesProcessed = 0;
  let filesFailed = 0;

  for (const file of PBE_FILES) {
    console.log(`\nLaddar ner PBE ${file.year}...`);
    console.log(`  URL: ${file.url}`);
    await sleep(RATE_LIMIT_MS);

    let buffer;
    try {
      buffer = await downloadExcel(file.url);
      console.log(`  Nedladdat: ${(buffer.byteLength / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error(`  KAN INTE LADDA NER: ${err.message}`);
      if (err.response) {
        console.error(`  HTTP status: ${err.response.status}`);
      }
      filesFailed++;
      continue;
    }

    let rows;
    try {
      rows = parseExcel(buffer, file.year);
      console.log(`  Parsade ${rows.length} datapunkter`);
    } catch (err) {
      console.error(`  FEL VID PARSNING: ${err.message}`);
      filesFailed++;
      continue;
    }

    if (rows.length === 0) {
      console.log('  Inga datapunkter hittades');
      continue;
    }

    // Ladda in i batchar
    const BATCH_SIZE = 500;
    let batchErrors = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('enrichment_boverket_pbe')
        .insert(batch);

      if (error) {
        console.error(`  FEL vid insert batch ${i}: ${error.message}`);
        batchErrors++;
      }
    }

    if (batchErrors === 0) {
      totalRows += rows.length;
      filesProcessed++;
      console.log(`  OK: ${rows.length} rader`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Klart!`);
  console.log(`  Filer bearbetade: ${filesProcessed}`);
  console.log(`  Filer misslyckade: ${filesFailed}`);
  console.log(`  Totalt rader: ${totalRows}`);

  const { count } = await supabase
    .from('enrichment_boverket_pbe')
    .select('*', { count: 'exact', head: true });

  console.log(`  Rader i enrichment_boverket_pbe: ${count}`);
}

main().catch(err => {
  console.error('FEL:', err.message);
  process.exit(1);
});
