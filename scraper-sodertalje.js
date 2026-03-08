require('dotenv').config();
const puppeteer = require('puppeteer');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.sodertalje.se';
const ANSLAGSTAVLA_URL = `${BASE_URL}/kommun-och-politik/anslagstavla/`;

async function getPdfLinks(page) {
  await page.goto(ANSLAGSTAVLA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      if (!href) return;
      const url = href.startsWith('http') ? href : base + href;
      if (!/kungorelse.*\.pdf$/i.test(url)) return;
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      results.push({ title: text || href, url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

async function parsePdfFromUrl(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'Accept-Language': 'sv-SE,sv;q=0.9' },
  });
  const data = await pdfParse(Buffer.from(response.data));
  return data.text;
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseSodertaljePermits(text, sourceUrl) {
  const permits = [];

  // Split text into sections by diarienummer or fastighet patterns
  // Södertälje often lists: Fastighet, Åtgärd, Diarienummer in that order
  const diariePattern = /(?:Dnr|diarienr|diarienummer|ärendenr|ärendenummer)[:\s]+([A-Z]+[\s\-]?\d{4}[\s\-]\d+)/gi;
  const matches = [...text.matchAll(diariePattern)];

  for (const match of matches) {
    const diarienummer = match[1].replace(/\s+/g, ' ').trim();
    const chunkStart = Math.max(0, match.index - 600);
    const chunk = text.slice(chunkStart, match.index + 200);

    const fastighetMatch = chunk.match(/([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/);
    const atgardMatch = chunk.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]+)/i)
      || chunk.match(/[Nn]ybyggnad|[Tt]illbyggnad/i);

    const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;
    let atgard = null;
    if (atgardMatch) {
      atgard = (atgardMatch[1] || atgardMatch[0]).trim().toLowerCase();
    }

    permits.push({ diarienummer, fastighetsbeteckning, adress: null, atgard, beslutsdatum: parseDatum(chunk) });
  }

  // Fallback: find by fastighet if no diarienummer matched
  if (permits.length === 0) {
    const fastighetPattern = /([A-ZÅÄÖ][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/g;
    for (const match of text.matchAll(fastighetPattern)) {
      const chunk = text.slice(match.index, match.index + 600);
      const atgardMatch = chunk.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]+)/i);
      if (!atgardMatch) continue;

      const fastighet = match[1].trim();
      permits.push({
        diarienummer: `SODERTALJE-${fastighet.replace(/\s+/g, '-')}`,
        fastighetsbeteckning: fastighet,
        adress: null,
        atgard: atgardMatch[1].trim().toLowerCase(),
        beslutsdatum: parseDatum(chunk),
      });
    }
  }

  return permits.map(p => ({ ...p, sourceUrl }));
}

async function sodertaljeScrape() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Södertälje PDF-kungörelser...');
    const pdfLinks = await getPdfLinks(page);
    console.error(`Hittade ${pdfLinks.length} PDF-kungörelser.`);

    const allPermits = [];
    for (const link of pdfLinks) {
      try {
        console.error(`  → Laddar ned ${link.url}`);
        const text = await parsePdfFromUrl(link.url);
        const permits = parseSodertaljePermits(text, link.url);
        allPermits.push(...permits.map(p => ({ ...p, kommun: 'Södertälje' })));
      } catch (err) {
        console.error(`  ✗ ${link.url}: ${err.message}`);
      }
    }

    const bygglov = allPermits.filter(p =>
      p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard)
    );

    console.error(`Hittade ${allPermits.length} poster varav ${bygglov.length} nybyggnad/tillbyggnad.`);

    let saved = 0;
    for (const permit of bygglov) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Södertälje-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

sodertaljeScrape().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
