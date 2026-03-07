require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');

const BASE_URL = 'https://www.huddinge.se';
const LISTING_URL = `${BASE_URL}/organisation-och-styrning/huddinge-kommuns-anslagstavla/anslag/`;

async function getBygglovLinks(page) {
  await page.goto(LISTING_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  const links = await page.evaluate((base) => {
    const results = [];
    document.querySelectorAll('a').forEach(el => {
      const text = el.innerText.trim().replace(/\s+/g, ' ');
      const href = el.getAttribute('href');
      if (!href) return;
      // Must be a beslut page (not "möjlighet att lämna synpunkter")
      if (!/Kungörelse om beslut enligt plan- och bygglagen/i.test(text)) return;
      const url = href.startsWith('http') ? href : base + href;
      results.push({ title: text.split('\n')[0].trim(), url });
    });
    return [...new Map(results.map(l => [l.url, l])).values()];
  }, BASE_URL);

  return links;
}

function parseHuddingeText(text) {
  // Description: "Beslut om bygglov för [åtgärd]"
  const beslutMatch = text.match(/Beslut om\s+(.+?)(?:\n|Fastighet|$)/i);
  let atgard = beslutMatch ? beslutMatch[1].trim().toLowerCase() : null;
  // Remove trailing period
  if (atgard) atgard = atgard.replace(/\.\s*$/, '').trim();

  // Fastighet (may have extra spaces) — use ^ multiline to match line start
  const fastighetMatch = text.match(/^Fastighet:\s+(.+)/im);
  const fastighetsbeteckning = fastighetMatch ? fastighetMatch[1].trim() : null;

  // Address (optional) — ^ prevents matching inside "Besöksadress:"
  const adressMatch = text.match(/^Adress:\s+(.+)/im);
  const adress = adressMatch ? adressMatch[1].trim() : null;

  // Diarienummer: "MBF 2026-000314" — first occurrence, line start only
  const diarieMatch = text.match(/^Ärendenummer:\s+(MBF\s+\d{4}-\d+)/im);
  const diarienummer = diarieMatch ? diarieMatch[1].replace(/\s+/g, ' ').trim() : null;

  return { atgard, fastighetsbeteckning, adress, diarienummer };
}

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  const text = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });

  return parseHuddingeText(text);
}

async function scrapeHuddinge() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

  try {
    console.error('Hämtar Huddinge kungörelser...');
    const links = await getBygglovLinks(page);
    console.error(`Hittade ${links.length} beslut-kungörelser.`);

    const permits = [];
    for (const link of links) {
      try {
        const permit = await scrapePage(page, link.url);
        if (permit.diarienummer) {
          permits.push({ ...permit, sourceUrl: link.url, kommun: 'Huddinge' });
        }
      } catch (err) {
        console.error(`  ✗ ${link.url}: ${err.message}`);
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
    console.error(`Klart: ${saved}/${bygglov.length} Huddinge-poster sparade till Supabase.`);
  } finally {
    await browser.close();
  }
}

scrapeHuddinge().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
