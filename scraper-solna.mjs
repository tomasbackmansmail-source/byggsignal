import { createRequire } from 'module';
import { getDocument } from './node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';

const require = createRequire(import.meta.url);
require('dotenv').config();

const puppeteer = require('puppeteer');
const https = require('https');
const http = require('http');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.solna.se';
const LISTING_URL = `${BASE_URL}/anslagstavla/`;

async function fetchPdfBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'Accept': 'application/pdf', 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPdfBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function parsePdf(buffer) {
  const data = new Uint8Array(buffer);
  const pdfDoc = await getDocument({ data, verbosity: 0 }).promise;
  let fullText = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => item.str).join(' ') + '\n';
  }
  // Remove hyphenation artifacts from line breaks (e.g. "Emmylunds- vägen" → "Emmylundsvägen")
  return fullText.replace(/-\s+/g, '');
}

function parseDatum(text) {
  const m = text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Anslagsdatum|Anslaget|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/(?:Gäller\s+fr[åa]n)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseSolnaText(text, sourceUrl) {
  const permits = [];
  // Diarienummer format: BYGG YYYY–NNNNNN (en-dash) or BYGG YYYY-NNNNNN (hyphen)
  // Pattern: "[type] för [åtgärd], [address] (BYGG YYYY–NNNNNN)."
  const pattern = /([A-ZÅÄÖ][a-zåäö]+(?:\s+[a-zåäö]+)?lov)\s+för\s+(.+?)\s*\(BYGG\s+([\d–\-]+)\)/gi;

  for (const m of text.matchAll(pattern)) {
    const [, type, rest, dnrSuffix] = m;
    // Normalize diarienummer (replace en-dash with hyphen)
    const diarienummer = `BYGG ${dnrSuffix.replace(/–/g, '-')}`;

    // "rest" may be "[åtgärd], [address]" or just "[åtgärd]"
    // Split on last comma+space before something that looks like a street
    const commaIdx = rest.lastIndexOf(', ');
    let atgard, adress;

    if (commaIdx > 0) {
      const possibleAddr = rest.slice(commaIdx + 2);
      // If it looks like a street address (has digit or is a known area)
      if (/\d/.test(possibleAddr) || /vägen|gatan|gränd|torget|väg|torg/i.test(possibleAddr)) {
        atgard = rest.slice(0, commaIdx).trim().toLowerCase();
        adress = possibleAddr.trim();
      } else {
        atgard = rest.trim().toLowerCase();
        adress = null;
      }
    } else {
      atgard = rest.trim().toLowerCase();
      adress = null;
    }

    permits.push({
      diarienummer,
      fastighetsbeteckning: null, // Solna doesn't provide fastighet in this format
      adress,
      atgard,
      kommun: 'Solna',
      sourceUrl,
      beslutsdatum: parseDatum(text),
    });
  }

  return permits;
}

async function getPdfLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .filter(a => /underr.ttar.*ans.kningar|ans.kningar.*avvikelser/i.test(a.innerText + a.href))
      .filter(a => a.href.endsWith('.pdf'))
      .map(a => ({ text: a.innerText.trim(), href: a.href }))
      .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i)
  );
}

async function scrapeSolna() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Solna anslagstavla...');
    const links = await getPdfLinks(page);
    console.error(`Hittade ${links.length} PDF-kungörelser.`);

    const allPermits = [];
    for (const link of links) {
      try {
        const buffer = await fetchPdfBuffer(link.href);
        const text = await parsePdf(buffer);
        const permits = parseSolnaText(text, link.href);
        allPermits.push(...permits);
      } catch (err) {
        console.error(`  ✗ ${link.text}: ${err.message}`);
      }
    }

    // Deduplicate by diarienummer
    const unique = [...new Map(allPermits.map(p => [p.diarienummer, p])).values()];
    const bygglov = unique.filter(p =>
      p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard)
    );

    console.error(`Hittade ${unique.length} unika poster varav ${bygglov.length} nybyggnad/tillbyggnad.`);

    let saved = 0;
    for (const permit of bygglov) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.adress || permit.atgard}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Solna-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeSolna().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
