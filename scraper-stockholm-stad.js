require('dotenv').config();
const https = require('https');
const { savePermit } = require('./db');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchPage(fromDate, page) {
  return new Promise((resolve, reject) => {
    const params = `ExtendedAddress=false&Description=bygglov&CaseStartDateFrom=${fromDate}&Page=${page}`;
    const url = `https://etjanster.stockholm.se/byggochplantjansten/arendeochhandlingar?${params}`;
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)', 'Accept': 'text/html', 'Accept-Language': 'sv-SE,sv;q=0.9' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseListProps(html) {
  const m = html.match(/data-type='list' data-props='([^']+)'/);
  if (!m) return null;
  const decoded = m[1]
    .replace(/&amp;#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
  try { return JSON.parse(decoded); } catch { return null; }
}

function extractField(row, heading) {
  const cell = row.find(c => c.heading === heading);
  return cell ? cell.content : null;
}

async function scrapeStockholmStad() {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 14);
  const dateStr = fromDate.toISOString().split('T')[0];
  console.error(`Hämtar Stockholm stad från ${dateStr}...`);

  let page = 1;
  let saved = 0;
  let total = 0;
  let processed = 0;

  while (true) {
    console.error(`  Sida ${page}...`);
    const html = await fetchPage(dateStr, page);
    const listData = parseListProps(html);
    if (!listData || !listData.rows || listData.rows.length === 0) {
      console.error('  Inga fler resultat.');
      break;
    }

    const headingMatch = listData.heading.match(/Visar (\d+)-(\d+) av (\d+)/);
    if (headingMatch) {
      const shown_to = parseInt(headingMatch[2]);
      total = parseInt(headingMatch[3]);
      console.error(`  ${total} totalt`);
      processed = shown_to;
    }

    for (const row of listData.rows) {
      const atgard = extractField(row, 'Ärendemening');
      const diarienummer = extractField(row, 'Diarienummer');
      const fastighetsbeteckning = extractField(row, 'Fastighetsbeteckning');
      const adress = extractField(row, 'Adress');
      const datum = extractField(row, 'Ärendestart');

      if (!atgard || !/nybyggnad|tillbyggnad/i.test(atgard)) continue;

      try {
        await savePermit({
          diarienummer,
          fastighetsbeteckning,
          adress,
          atgard: atgard.toLowerCase(),
          kommun: 'Stockholm stad',
          sourceUrl: 'https://etjanster.stockholm.se/byggochplantjansten/arendeochhandlingar',
          status: 'beviljat',
        });
        saved++;
        console.error(`  ✓ ${diarienummer} — ${adress || fastighetsbeteckning}`);
      } catch (err) {
        console.error(`  ✗ ${diarienummer}: ${err.message}`);
      }
    }

    if (processed >= total) break;
    page++;
    await sleep(1500);
  }

  console.error(`Klart: ${saved} Stockholm stad-poster sparade till Supabase.`);
}

scrapeStockholmStad().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
