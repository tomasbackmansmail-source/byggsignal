require('dotenv').config();
const { execFile } = require('child_process');
const { savePermit } = require('./db');

// Note: Huddinge's server sends non-standard HTTP headers that Node.js's strict
// HTTP parser rejects. We use curl as a workaround.

const BASE_URL = 'https://www.huddinge.se';
const LISTING_URL = `${BASE_URL}/organisation-och-styrning/huddinge-kommuns-anslagstavla/`;

const SWEDISH_MONTHS = {
  januari: '01', februari: '02', mars: '03', april: '04',
  maj: '05', juni: '06', juli: '07', augusti: '08',
  september: '09', oktober: '10', november: '11', december: '12'
};

function fetchWithCurl(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', [
      '-s', '-L',
      '-A', 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
      '-H', 'Accept: text/html',
      '-H', 'Accept-Language: sv-SE,sv;q=0.9',
      url
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
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
    .replace(/&Auml;/g, 'Ä').replace(/&auml;/g, 'ä')
    .replace(/&Aring;/g, 'Å').replace(/&aring;/g, 'å')
    .replace(/&Ouml;/g, 'Ö').replace(/&ouml;/g, 'ö')
    .replace(/&eacute;/g, 'é').replace(/&Eacute;/g, 'É')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Parse "D månadsnamn YYYY" to "YYYY-MM-DD"
function parseSwedishDate(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})$/i);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = SWEDISH_MONTHS[m[2].toLowerCase()];
  const year = m[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

// Parse listing page and return links to "kungörelse om beslut" articles
function parseListingPage(html) {
  const results = [];

  // Find the news-list section with articles
  const newsSection = html.match(/id="news-list"[^>]*>([\s\S]{0,20000})/);
  if (!newsSection) return results;

  const sectionHtml = newsSection[1];
  const articleRe = /<article>([\s\S]{0,600}?)<\/article>/g;
  let match;

  while ((match = articleRe.exec(sectionHtml)) !== null) {
    const articleHtml = match[1];
    const decodedText = decodeHtml(stripTags(articleHtml));

    // Only "Kungörelse om beslut enligt plan- och bygglagen"
    if (!/Kung.?relse om beslut enligt plan- och bygglagen/i.test(decodedText)) continue;

    const hrefMatch = articleHtml.match(/href="([^"]+)"/);
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    const url = href.startsWith('http') ? href : BASE_URL + href;

    // Extract date from listing: "Publicerat den D månadsnamn YYYY"
    const dateMatch = articleHtml.match(/Publicerat den\s+([^.<]+)/i);
    const listingDate = dateMatch ? parseSwedishDate(dateMatch[1].trim()) : null;

    results.push({ url, listingDate });
  }

  return results;
}

// Parse an individual kungörelse page
function parseNoticePage(html, listingDate) {
  const contentMatch = html.match(/class="layout-content">([\s\S]{0,8000})/) ||
                       html.match(/id="main-article"[^>]*>([\s\S]{0,8000})/);
  if (!contentMatch) return null;

  const text = decodeHtml(stripTags(contentMatch[1]));

  // Ärendenummer: "MBF YYYY-NNNNNN"
  const diarieMatch = text.match(/[ÄA]rendenummer[:\s]*(MBF\s+\d{4}-\d+)/i);
  const diarienummer = diarieMatch ? diarieMatch[1].replace(/\s+/, ' ').trim() : null;

  // Fastighet: "Fastighet: X Y" — stop before Adress, Ärendenummer or double space
  const fastighetMatch = text.match(/Fastighet[:\s]+([\w\s\-]+?)(?=\s+(?:Adress|[ÄA]rendenummer|Vill)|\s{2,}|$)/i);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address: optional "Adress: X"
  const adressHuddingeMatch = text.match(/Adress[:\s]+([^\s].*?)(?=\s+[ÄA]rendenummer|\s{2,}|$)/i);
  const adress = adressHuddingeMatch ? adressHuddingeMatch[1].trim() : null;

  // Åtgärd: "Beslut om bygglov för X"
  const atgardMatch = text.match(/Beslut om\s+(.+?)(?=\s+Fastighet|\s+Frivilligt|[.]\s|\s{2,}|$)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Beslutsdatum: "Publicerat den D månadsnamn YYYY"
  const dateMatch = text.match(/Publicerat den\s+([^\n.]{5,25})/i);
  const beslutsdatum = (dateMatch ? parseSwedishDate(dateMatch[1].trim()) : null) || listingDate;

  return { diarienummer, fastighetsbeteckning, adress, atgard, beslutsdatum };
}

async function scrapeHuddinge() {
  console.error('Hämtar Huddinge kungörelser...');
  const listingHtml = await fetchWithCurl(LISTING_URL);
  const items = parseListingPage(listingHtml);
  console.error(`Hittade ${items.length} besluts-kungörelser.`);

  let saved = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const pageHtml = await fetchWithCurl(item.url);
      const permit = parseNoticePage(pageHtml, item.listingDate);

      if (!permit || !permit.diarienummer) {
        console.error(`  skip (no diarienummer): ${item.url.slice(-70)}`);
        skipped++;
        continue;
      }

      await savePermit({
        ...permit,
        status: 'beviljat',
        sourceUrl: item.url,
        kommun: 'Huddinge',
      });
      saved++;
      console.error(`  ok ${permit.diarienummer} — ${permit.fastighetsbeteckning || '?'}`);
    } catch (err) {
      console.error(`  x ${item.url.slice(-60)}: ${err.message}`);
      skipped++;
    }
  }

  console.error(`Klart: ${saved}/${items.length} Huddinge-poster sparade till Supabase.`);
}

scrapeHuddinge().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
