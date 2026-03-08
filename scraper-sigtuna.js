require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const SIGTUNA_URL = 'https://www.sigtuna.se/kommun-och-politik/handlingar-beslut-och-rattssakerhet/anslagstavla.html';

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseSigtunaText(text) {
  const permits = [];
  const beslutsdatum = parseDatum(text);

  // Format 1: "Kungörelse bygglov" with "Ärendet avser" and "Fastighet"
  // "Ärendet avser: Bygglov för [åtgärd] Fastighet: FASTIGHET BYGG.YYYY.NNNN"
  const pattern1 = /[Ää]rendet avser:\s+(?:Bygglov\s+f[öo]r\s+)?([^\n]+?)\s*Fastighet:\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s+(BYGG\.\d{4}\.\d+)/g;
  for (const m of text.matchAll(pattern1)) {
    const [, atgard, fastighet, diarienummer] = m;
    permits.push({
      diarienummer: diarienummer.trim(),
      fastighetsbeteckning: fastighet.trim(),
      adress: null,
      atgard: atgard.trim().toLowerCase().replace(/^bygglov\s+f[öo]r\s+/i, ''),
      kommun: 'Sigtuna',
      sourceUrl: SIGTUNA_URL,
      beslutsdatum,
    });
  }

  // Format 2: Separate "Ärendet avser" and "Ärendenummer" fields (with newlines)
  const pattern2 = /[Ää]rendet avser:\s+(?:Bygglov\s+f[öo]r\s+)?([^\n]+)\s*Fastighet:\s+([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s*[Ää]rendenummer:\s+(BYGG\.\d{4}\.\d+)/g;
  for (const m of text.matchAll(pattern2)) {
    const [, atgard, fastighet, diarienummer] = m;
    if (!permits.find(p => p.diarienummer === diarienummer.trim())) {
      permits.push({
        diarienummer: diarienummer.trim(),
        fastighetsbeteckning: fastighet.trim(),
        adress: null,
        atgard: atgard.trim().toLowerCase().replace(/^bygglov\s+f[öo]r\s+/i, ''),
        kommun: 'Sigtuna',
        sourceUrl: SIGTUNA_URL,
        beslutsdatum,
      });
    }
  }

  // Format 3: Remiss/grannehörande with Fastighetsbeteckning and Ärendenummer
  const pattern3 = /(?:Tidsbegränsat\s+)?[Bb]yggl[ou]v\s+f[öo]r\s+([^\n]+)\s*Fastighetsbeteckning:\s*([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+(?::\d+)?)\s*[Ää]rendenummer:\s+(BYGG\.\d{4}\.\d+)/g;
  for (const m of text.matchAll(pattern3)) {
    const [, atgard, fastighet, diarienummer] = m;
    if (!permits.find(p => p.diarienummer === diarienummer.trim())) {
      permits.push({
        diarienummer: diarienummer.trim(),
        fastighetsbeteckning: fastighet.trim(),
        adress: null,
        atgard: atgard.trim().toLowerCase(),
        kommun: 'Sigtuna',
        sourceUrl: SIGTUNA_URL,
        beslutsdatum,
      });
    }
  }

  return permits;
}

async function scrapeSigtuna() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hamtar Sigtuna kungorelser...');
    await page.goto(SIGTUNA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const text = await page.evaluate(() => document.body.innerText);
    const permits = parseSigtunaText(text);

    const bygglov = permits.filter(p =>
      p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard)
    );

    console.error(`Hittade ${permits.length} poster varav ${bygglov.length} nybyggnad/tillbyggnad.`);
    permits.forEach(p => console.error(`  -> ${p.diarienummer} | ${p.atgard}`));

    let saved = 0;
    for (const permit of bygglov) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ok ${permit.diarienummer} -- ${permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Sigtuna-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeSigtuna().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
