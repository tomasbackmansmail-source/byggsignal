require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const ANSLAGSTAVLA_URL = 'https://www.sodertalje.se/kommun-och-politik/anslagstavla/';

async function scrapeSodertalje() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Södertälje anslagstavla...');
    await page.goto(ANSLAGSTAVLA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Open all collapsed <details> elements so their content becomes readable
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach(d => { d.open = true; });
    });
    await new Promise(r => setTimeout(r, 300));

    const permits = await page.evaluate((sourceUrl) => {
      const results = [];

      const SWEDISH_MONTHS = {
        januari: '01', februari: '02', mars: '03', april: '04',
        maj: '05', juni: '06', juli: '07', augusti: '08',
        september: '09', oktober: '10', november: '11', december: '12'
      };
      function parseSvDate(str) {
        const m = str.match(/(\d{1,2})\s+([a-z\u00e5\u00e4\u00f6]+)\s+(\d{4})/i);
        if (!m) return null;
        const mon = SWEDISH_MONTHS[m[2].toLowerCase()];
        if (!mon) return null;
        return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
      }

      document.querySelectorAll('details').forEach(d => {
        const summary = d.querySelector('summary');
        const body = d.querySelector('.panel-body, .show-hide-section__body');
        if (!summary || !body) return;

        const summaryText = summary.innerText.replace(/expand_less|expand_more/g, '').trim();
        const bodyText = body.innerText.trim();

        // Must have diarienummer
        const diarieMatch = bodyText.match(/Diarienummer:\s*(BL\s+\d{4}-\d+)/i);
        if (!diarieMatch) return;
        const diarienummer = diarieMatch[1].trim();

        // Determine status from summary
        const isDecision = /^Beslut/i.test(summaryText);
        const status = isDecision ? 'beviljat' : 'ansökt';

        // Atgard: first line of body is typically "Ansökan/Beslut om X för Y"
        const atgardMatch = bodyText.match(/^\s*(?:Ans[öo]kan|Beslut)\s+om\s+\S+\s+f[öo]r\s+([^\n]+)/im)
          || bodyText.match(/^\s*([^\n]{5,80})/);
        const rawAtgard = atgardMatch ? atgardMatch[1] : null;
        const atgard = rawAtgard
          ? rawAtgard.trim().toLowerCase().replace(/\.$/, '')
          : null;

        // beslutsdatum: prio 1 = "Beslutsdatum: YYYY-MM-DD" in body, prio 2 = Swedish date in summary
        const bodyDateMatch = bodyText.match(/Beslutsdatum:\s*(\d{4}-\d{2}-\d{2})/i);
        const beslutsdatum = (bodyDateMatch ? bodyDateMatch[1] : null) || parseSvDate(summaryText);

        // Parse fastighetsbeteckning and adress from summary
        // Summary format: "Ansökan om bygglov, FASTBET, Adress" or "Beslut om bygglov, FASTBET, Adress"
        const afterType = summaryText.replace(/^(?:Ans[öo]kan|Beslut)\s+om\s+\S+,?\s*/i, '');
        const parts = afterType.split(',').map(s => s.trim()).filter(Boolean);
        const fastighetsbeteckning = parts[0] || null;
        const adress = parts.slice(1).join(', ').trim() || null;

        results.push({
          diarienummer,
          fastighetsbeteckning,
          adress,
          atgard,
          status,
          beslutsdatum,
          kommun: 'Södertälje',
          sourceUrl,
        });
      });

      return results;
    }, ANSLAGSTAVLA_URL);

    console.error(`Hittade ${permits.length} poster.`);

    let saved = 0;
    for (const permit of permits) {
      try {
        await savePermit({ ...permit, permit_type: parsePermitType(permit.atgard) });
        saved++;
        console.error(`  ok ${permit.diarienummer} — ${permit.adress || permit.fastighetsbeteckning || '?'}`);
      } catch (err) {
        console.error(`  x ${permit.diarienummer}: ${err.message}`);
      }
    }
    console.error(`Klart: ${saved}/${permits.length} Södertälje-poster sparade.`);
  } finally {
    await browser.close();
  }
}

scrapeSodertalje().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
