import { createRequire } from 'module';
import { getDocument } from './node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';

const require = createRequire(import.meta.url);
require('dotenv').config();

const puppeteer = require('puppeteer');
const https = require('https');
const http = require('http');
const { savePermit } = require('./db');

const LISTING_URL = 'https://www.taby.se/anslagstavla/';

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
  return fullText;
}

function parseDatum(text) {
  const m = text.match(/\bden\s+(\d{4}-\d{2}-\d{2})\b/)
    || text.match(/(?:Publice(?:rad|rat)|Beslutsdatum|Datum)[:\s]+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

function parseTabyText(text, sourceUrl) {
  // Format: "Beslut om bygglov för [åtgärd] har beviljats på fastigheten [FASTIGHET NUMBER:NUMBER] ([adress]), med diarienummer: BN YYYY-NNNNNN den [datum]."
  // Diarienummer may have space after dash: "BN 2025- 001051"
  const diariePat = /BN\s+\d{4}-\s*\d+/;
  const beslutMatch = text.match(/Beslut om\s+(.+?)\s+har beviljats på fastigheten\s+(.+?)\s*\((.+?)\),\s*med diarienummer:\s*(BN\s+[\d\s-]+\d)/i);

  if (!beslutMatch) {
    // Try alternate format without parenthesized address
    const altMatch = text.match(/Beslut om\s+(.+?)\s+har beviljats på fastigheten\s+(.+?),\s*med diarienummer:\s*(BN\s+[\d\s-]+\d)/i);
    if (altMatch) {
      const [, decision, fastighet, diarienummer] = altMatch;
      const atgard = decision.replace(/^bygglov för\s*/i, '').trim().toLowerCase();
      const dnr = diarienummer.replace(/\s+/g, '').replace('BN', 'BN ').trim();
      return { atgard, fastighetsbeteckning: fastighet.trim(), adress: null, diarienummer: dnr, sourceUrl };
    }
    return null;
  }

  const [, decision, fastighet, adress, diarienummer] = beslutMatch;
  const atgard = decision.replace(/^bygglov för\s*/i, '').trim().toLowerCase();

  // Normalize diarienummer: collapse internal spaces but keep "BN YYYY-NNNNNN"
  const dnr = diarienummer.replace(/\s+/g, '').replace('BN', 'BN ').trim();

  return {
    atgard,
    fastighetsbeteckning: fastighet.trim(),
    adress: adress.trim(),
    diarienummer: dnr,
    beslutsdatum: parseDatum(text),
    sourceUrl,
  };
}

async function getSamBeslutLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .filter(a => /sam-beslut-BN/i.test(a.innerText || a.href))
      .map(a => ({ text: a.innerText.trim(), href: a.href }))
      .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i)
  );
}

async function scrapeTaby() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Täby anslagstavla...');
    const links = await getSamBeslutLinks(page);
    console.error(`Hittade ${links.length} sam-beslut PDFer.`);

    const permits = [];
    for (const link of links) {
      try {
        const buffer = await fetchPdfBuffer(link.href);
        const text = await parsePdf(buffer);
        const permit = parseTabyText(text, link.href);
        if (permit) {
          permits.push({ ...permit, kommun: 'Täby' });
        }
      } catch (err) {
        console.error(`  ✗ ${link.text}: ${err.message}`);
      }
    }

    const bygglov = permits.filter(p =>
      p.atgard && /nybyggnad|tillbyggnad/i.test(p.atgard)
    );

    console.error(`Hittade ${permits.length} poster varav ${bygglov.length} nybyggnad/tillbyggnad.`);

    let saved = 0;
    for (const permit of bygglov) {
      try {
        await savePermit(permit);
        saved++;
        console.error(`  ✓ ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${bygglov.length} Täby-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeTaby().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
