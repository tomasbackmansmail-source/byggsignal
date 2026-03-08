require('dotenv').config();
const axios = require('axios');
const { savePermit } = require('./db');

const TENANT_GUID = '8cc90cec-fba7-4ca0-9021-e9702c209213';
const BASE_URL = 'https://lexext.tyreso.se/Lex2PinBoardWasm/pinboard';
const SOURCE_URL = 'https://lexext.tyreso.se/Lex2PinBoardWasm';
const LOGIN = { username: 'Lex', password: 'lex', loginKind: 2 };
const PDFJS_PATH = require('path').join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const PDFJS_WORKER = require('path').join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

async function extractPdfText(base64Content) {
  const pdfjs = await import(PDFJS_PATH);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const buf = Buffer.from(base64Content, 'base64');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parsePdfText(text) {
  // "KRITAN 5 (JESSIE NAVINS VÄG 1), Ansökan om bygglov för nybyggnad av enbostadshus...  Diarienr: BYGG 2025-000609"
  const diarieMatch = text.match(/Diarienr:\s*(BYGG\s+\d{4}-\d+)/i);
  if (!diarieMatch) return null;
  const diarienummer = diarieMatch[1].replace(/\s+/g, ' ').trim();

  const atgardMatch = text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+(.+?)(?:\s+Bygglov,|\s+Diarienr:|$)/);
  let atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Fastighet + Adress: after 'www.tyreso.se' marker
  const faMatch = text.match(/www.tyreso.se\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s*\(([^)]+)\)/);
  const fastighetsbeteckning = faMatch ? faMatch[1].trim() : null;
  const adress = faMatch ? faMatch[2].trim() : null;

  return { diarienummer, atgard, fastighetsbeteckning, adress };
}

async function scrapeTypreso() {
  console.error('Hamtar Tyreso kungorelser...');

  const resp = await axios.post(BASE_URL + '/searchdocument', {
    tenantGuid: TENANT_GUID,
    login: LOGIN,
    documentSearch: {
      searchFromParameter: 'Visa_pa_anslagstavla_from',
      searchToParameter: 'Visa_pa_anslagstavla_tom'
    }
  });

  const docs = resp.data;
  console.error(`Hittade ${docs.length} kungörelser totalt.`);

  const beslutDocs = docs.filter(d =>
    /Kungörelse om beslut.*BYGG/i.test(d.description) ||
    /Kungörelse \(BYGG/i.test(d.description)
  );
  const ansokDocs = docs.filter(d =>
    /Underrättelse om ansökan.*BYGG/i.test(d.description) ||
    /Underrättelse om ansökan \[.*BYGG/i.test(d.description)
  );
  console.error(`Varav ${beslutDocs.length} beslut, ${ansokDocs.length} ansökningar.`);

  const permits = [];

  for (const doc of beslutDocs) {
    try {
      const text = await extractPdfText(doc.content.fileContent);
      const parsed = parsePdfText(text);
      if (!parsed || !parsed.atgard) continue;
      if (!/nybyggnad|tillbyggnad/i.test(parsed.atgard)) continue;
      permits.push({
        diarienummer: parsed.diarienummer,
        fastighetsbeteckning: parsed.fastighetsbeteckning,
        adress: parsed.adress,
        atgard: parsed.atgard,
        kommun: 'Tyresö',
        sourceUrl: SOURCE_URL,
        status: 'beviljat',
        beslutsdatum: doc.date ? new Date(doc.date).toISOString().split('T')[0] : parseDatum(text),
      });
    } catch (err) {
      console.error(`  Fel vid parsning av ${doc.description}: ${err.message}`);
    }
  }

  for (const doc of ansokDocs) {
    try {
      const text = await extractPdfText(doc.content.fileContent);
      const parsed = parsePdfText(text);
      if (!parsed || !parsed.atgard) continue;
      if (!/nybyggnad|tillbyggnad/i.test(parsed.atgard)) continue;
      permits.push({
        diarienummer: parsed.diarienummer,
        fastighetsbeteckning: parsed.fastighetsbeteckning,
        adress: parsed.adress,
        atgard: parsed.atgard,
        kommun: 'Tyresö',
        sourceUrl: SOURCE_URL,
        status: 'ansökt',
        beslutsdatum: doc.date ? new Date(doc.date).toISOString().split('T')[0] : parseDatum(text),
      });
    } catch (err) {
      console.error(`  Fel vid parsning av ${doc.description}: ${err.message}`);
    }
  }

  console.error(`Hittade ${permits.length} nybyggnad/tillbyggnad-poster.`);
  permits.forEach(p => console.error(`  -> ${p.diarienummer} | ${p.atgard}`));

  let saved = 0;
  for (const permit of permits) {
    try {
      await savePermit(permit);
      saved++;
      console.error(`  ok ${permit.diarienummer} -- ${permit.adress || permit.fastighetsbeteckning}`);
    } catch (err) {
      console.error(`  x ${permit.diarienummer}: ${err.message}`);
    }
  }
  console.error(`Klart: ${saved}/${permits.length} Tyreso-poster sparade till Supabase.`);
}

scrapeTypreso().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
