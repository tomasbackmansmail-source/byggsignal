require('dotenv').config();
const https = require('https');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const LISTING_URL = 'https://salem.se/anslagstavla.4.5f17fb541901008a8bd67abc.html';
const APPREGISTRY_KEY = '12.427d197819121133d7976aa0';

function fetchPage() {
  return new Promise((resolve, reject) => {
    https.get(LISTING_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractArticles(html) {
  // Find the AppRegistry call with the articles data
  const escapedKey = APPREGISTRY_KEY.replace(/\./g, '\\.');
  const re = new RegExp(
    `AppRegistry\\.registerInitialState\\('${escapedKey}',\\s*([\\s\\S]+?)\\);\\s*(?:AppRegistry|<\\/script)`,
    'g'
  );
  const m = re.exec(html);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1]);
    return json.articles || [];
  } catch(e) {
    return null;
  }
}

function parseSalemTitle(title) {
  // Extract åtgärd: text after "bygglov för" or "lov för"
  const atgardMatch = title.match(/(?:bygglov|lov)\s+f[öo]r\s+(.+?)(?:\s+Fastighet:|$)/is);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Extract fastighet and adress: "Fastighet: FASTBET (ADRESS)" or "Fastighet: FASTBET"
  const fastA = title.match(/Fastighet:\s*([^\s(]+(?:\s+\d+[:\d]*)?)\s*\(([^)]+)\)/i);
  const fastB = !fastA && title.match(/Fastighet:\s*([^\s]+(?:\s+\d+[:\d]*)?)/i);

  let fastighetsbeteckning = null;
  let adress = null;

  if (fastA) {
    fastighetsbeteckning = fastA[1].trim();
    adress = fastA[2].trim();
  } else if (fastB) {
    fastighetsbeteckning = fastB[1].trim();
  }

  // Extract diarienummer: DBnr, Dnr, BoM etc.
  const diarieMatch = title.match(/(?:DB(?:nr|Nr)|Dnr\.?|BoM)\s*:?\s*([A-Za-z0-9]+-\d{3,}(?:-\d+)?)/i);
  const diarienummer = diarieMatch ? diarieMatch[1].trim() : null;

  return { fastighetsbeteckning, adress, atgard, diarienummer };
}

async function scrapeSalem() {
  console.error('Hämtar Salem kungörelser...');
  const html = await fetchPage();
  const articles = extractArticles(html);

  if (!articles) {
    console.error('Kunde inte parsa AppRegistry-data från Salem.');
    return;
  }

  console.error(`Hittade ${articles.length} poster totalt.`);

  // Filter: Bygg- och miljönämnden + bygglov/nybyggnad/tillbyggnad
  const relevant = articles.filter(a =>
    a.instance === 'Bygg- och miljönämnden' &&
    /nybyggnad|tillbyggnad|bygglov/i.test(a.title)
  );

  console.error(`Varav ${relevant.length} relevanta bygglov-kungörelser.`);

  let saved = 0;
  for (const a of relevant) {
    const { fastighetsbeteckning, adress, atgard, diarienummer } = parseSalemTitle(a.title);

    if (!diarienummer) {
      console.error(`  skip (no diarienummer): ${a.title.slice(0, 60)}`);
      continue;
    }

    try {
      const typeTrimmed = (a.type || '').trim();
      const status = /Underrättelse|Grannehörande/i.test(typeTrimmed) ? 'ansökt' : 'beviljat';
      await savePermit({
        diarienummer,
        fastighetsbeteckning,
        adress,
        atgard,
        status,
        permit_type: parsePermitType(atgard),
        sourceUrl: LISTING_URL,
        kommun: 'Salem',
        beslutsdatum: a.publishDate || null,
      });
      saved++;
      console.error(`  ok ${diarienummer} — ${adress || fastighetsbeteckning || '?'}`);
    } catch (err) {
      console.error(`  x ${diarienummer}: ${err.message}`);
    }
  }
  console.error(`Klart: ${saved}/${relevant.length} Salem-poster sparade till Supabase.`);
}

scrapeSalem().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
