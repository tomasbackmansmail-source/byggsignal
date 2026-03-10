require('dotenv').config();
const https = require('https');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const BASE_URL = 'https://www.nynashamn.se';
const LISTING_URL = `${BASE_URL}/service/organisation--styrning/anslagstavlan`;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9'
      }
    }, res => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : BASE_URL + res.headers.location;
        return fetchUrl(redirectUrl).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Parse listing page and return links to individual lov-notices
function parseListingPage(html) {
  const results = [];

  // Find the "kungorelse-av-beslut-i-lov-och-forhandsbesked" and
  // "kungorelse-av-underrattelse-i-lov-och-forhandsbesked" sections
  // by looking for sv-channel-item elements with href matching those paths
  const itemRe = /<li class="sv-channel-item"[^>]*>([\s\S]{0,1500}?)<\/li>/g;
  let match;

  while ((match = itemRe.exec(html)) !== null) {
    const itemHtml = match[1];

    // Only items linking to lov/forhandsbesked sections
    const hrefMatch = itemHtml.match(/href="([^"]*(?:kungorelse-av-beslut-i-lov|kungorelse-av-underrattelse-i-lov|kungorelseavbeslutilov|kungorelseavunderrattelseilov)[^"]*)"/);
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    const url = href.startsWith('http') ? href : BASE_URL + href;

    // Extract description text
    const textContent = decodeHtml(stripTags(itemHtml));

    // Only building permit related items
    if (!/bygglov|rivningslov|marklov|förhandsbesked|forhandsbesked|nybyggnad|tillbyggnad/i.test(textContent)) continue;

    results.push({ url, text: textContent });
  }

  return results;
}

// Parse an individual notice page
function parseNoticePage(html, url) {
  // Find main content text
  const mainMatch = html.match(/id="Mittenspalt"[^>]*>([\s\S]{0,15000})/);
  if (!mainMatch) return null;

  const text = decodeHtml(stripTags(mainMatch[1]));

  // Ärendenummer: "SBN YYYY-NNNNNN" or Diarienummer: "SBN/YYYY/NNNN/NNN"
  const diarieMatch = text.match(/(?:[ÄA]rendenummer|Diarienummer)[:\s]*(SBN[\s\/]\S+)/i);
  const diarienummer = diarieMatch ? diarieMatch[1].replace(/\s+/, ' ').trim() : null;

  // Fastighet: often "FASTIGHETSBETECKNING: X X:Y (ADRESS)" or "Fastighetsbeteckning: X Y:Z"
  const fastighetMatch = text.match(/Fastighetsbeteckning[:\s]*([A-ZÅÄÖ0-9][A-ZÅÄÖ0-9\s\-]+\d+:\d+)/i);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: often in parentheses after fastighet
  const adressMatch = text.match(/\(([A-ZÅÄÖ][^)]{3,50})\)/i);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Åtgärd: "beslut om bygglov för X" or "fattat beslut om X"
  const atgardMatch = text.match(/(?:beslut om\s+(?:bygglov\s+f[öo]r\s+)?|fattat beslut om\s+)([^\n.]{5,150})/i)
    || text.match(/[Bb]yggl[ou]v\s+f[öo]r\s+([^\n.]{5,100})/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Beslutsdatum: "Publiceringsdatum: YYYY-MM-DD till YYYY-MM-DD" — use first date
  const datumMatch = text.match(/Publiceringsdatum[:\s]+(\d{4}-\d{2}-\d{2})/i);
  const beslutsdatum = datumMatch ? datumMatch[1] : null;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum };
}

async function scrapeNynashamn() {
  console.error('Hämtar Nynäshamn kungörelser...');
  const listingHtml = await fetchUrl(LISTING_URL);
  const items = parseListingPage(listingHtml);
  console.error(`Hittade ${items.length} lov-kungörelser.`);

  let saved = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const pageHtml = await fetchUrl(item.url);
      const permit = parseNoticePage(pageHtml, item.url);

      if (!permit || !permit.diarienummer) {
        console.error(`  skip (no diarienummer): ${item.url.slice(-70)}`);
        skipped++;
        continue;
      }

      const status = /underrattelse|underrättelse/i.test(item.url) ? 'ansökt' : 'beviljat';
      await savePermit({
        ...permit,
        status,
        permit_type: parsePermitType(permit.atgard),
        sourceUrl: item.url,
        kommun: 'Nynäshamn',
      });
      saved++;
      console.error(`  ok ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning || '?'}`);
    } catch (err) {
      console.error(`  x ${item.url.slice(-60)}: ${err.message}`);
      skipped++;
    }
  }

  console.error(`Klart: ${saved}/${items.length} Nynäshamn-poster sparade till Supabase.`);
}

scrapeNynashamn().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
