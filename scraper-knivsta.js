require('dotenv').config();
const https = require('https');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const LISTING_URL = 'https://www.knivsta.se/politik-och-organisation/anslagstavla';
// AppRegistry key that holds the anslagstavla data (announcements, appropriations, meetings)
const APPREGISTRY_KEY = '12.583c5e8d16e44bc8c8f29870';

function fetchPage(url) {
  url = url || LISTING_URL;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'sv-SE,sv;q=0.9'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractAnnouncements(html) {
  const escapedKey = APPREGISTRY_KEY.replace(/\./g, '\\.');
  const re = new RegExp(
    `AppRegistry\\.registerInitialState\\('${escapedKey}',\\s*([\\s\\S]+?)\\);\\s*(?:AppRegistry|<\\/script)`,
    'g'
  );
  const m = re.exec(html);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1]);
    return json.announcements || [];
  } catch (e) {
    return null;
  }
}

function parseKnivstaAnnouncement(a) {
  const titleText = a.title || '';
  const freeText = a.freeText || '';
  const combined = titleText + ' ' + freeText;

  // Diarienummer: "BMK YYYY-NNNNNN" in freeText
  const diarieMatch = combined.match(/BMK\s+(\d{4}-\d+)/i);
  const diarienummer = diarieMatch ? `BMK ${diarieMatch[1]}` : null;

  // Fastighet: from title, e.g. "...byggnad, Marma 5:20"
  // Pattern: last occurrence of WORD digit:digit at end of title
  const fastighetMatch = titleText.match(/,\s+([A-ZÅÄÖ][a-zåäö]+(?:\s+[A-ZÅÄÖ]?[a-zåäö]*)*\s+\d+:\d+)\s*$/i);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Åtgärd: text after "bygglov för" or "tidsbegränsat bygglov för" in title
  const atgardMatch = titleText.match(/[Bb]yggl[ou]v\s+f[öo]r\s+(.+?)(?:,\s+[A-ZÅÄÖ]|$)/i);
  const atgard = atgardMatch ? atgardMatch[1].trim().toLowerCase() : null;

  // Published date is in ISO format YYYY-MM-DD
  const beslutsdatum = a.published || null;

  return { diarienummer, fastighetsbeteckning, atgard, beslutsdatum };
}

async function scrapeKnivsta() {
  console.error('Hämtar Knivsta kungörelser...');
  const html = await fetchPage();
  const announcements = extractAnnouncements(html);

  if (!announcements) {
    console.error('Kunde inte parsa AppRegistry-data från Knivsta.');
    return;
  }

  console.error(`Hittade ${announcements.length} kungörelser totalt.`);

  // Filter: Bygg- och miljönämnd + bygglov/rivningslov/marklov
  const relevant = announcements.filter(a =>
    a.organ === 'Bygg- och miljönämnd' &&
    /bygglov|rivningslov|marklov|förhandsbesked|tidsbegränsat/i.test(a.title)
  );

  console.error(`Varav ${relevant.length} relevanta bygglov-kungörelser.`);

  let saved = 0;
  for (const a of relevant) {
    const { diarienummer, fastighetsbeteckning, atgard, beslutsdatum } = parseKnivstaAnnouncement(a);

    if (!diarienummer) {
      console.error(`  skip (no diarienummer): ${a.title.slice(0, 80)}`);
      continue;
    }

    try {
      await savePermit({
        diarienummer,
        fastighetsbeteckning,
        adress: null,
        atgard,
        status: 'beviljat',
        permit_type: parsePermitType(atgard || a.title),
        sourceUrl: 'https://www.knivsta.se' + (a.uri || ''),
        kommun: 'Knivsta',
        beslutsdatum,
      });
      saved++;
      console.error(`  ok ${diarienummer} — ${fastighetsbeteckning || a.title.slice(0, 60)}`);
    } catch (err) {
      console.error(`  x ${diarienummer}: ${err.message}`);
    }
  }
  console.error(`Klart: ${saved}/${relevant.length} Knivsta-poster sparade till Supabase.`);
}

scrapeKnivsta().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
