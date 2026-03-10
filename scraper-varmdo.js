require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType } = require('./scripts/parse-helpers');

const BASE_URL = 'https://digitaltutskick.varmdo.se/kungorelse';
const WEEKS_BACK = parseInt(process.env.WEEKS_BACK || '5');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse "FÅGELBRO 1:77, Vikstens backe 2, Värmdö" → { fastighetsbeteckning, adress }
function parseFastighet(text) {
  if (!text) return { fastighetsbeteckning: null, adress: null };
  const parts = text.split(',').map(s => s.trim());
  // First part is fastighetsbeteckning (ALL-CAPS + number:number)
  const fastighetsbeteckning = parts[0] || null;
  // Middle parts are street address (skip last part which is municipality)
  const adress = parts.length >= 3 ? parts.slice(1, -1).join(', ') : (parts[1] || null);
  return { fastighetsbeteckning, adress };
}

function mapStatus(utfall) {
  if (!utfall) return 'ansökt';
  if (/beviljat/i.test(utfall)) return 'beviljat';
  return 'ansökt';
}

// Scrape detail fields from a permit detail page
async function scrapeDetailPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);

  return page.evaluate(() => {
    const fields = {};
    // The detail page renders labeled rows — collect all label→value pairs
    document.querySelectorAll('*').forEach(el => {
      const text = el.innerText || '';
      // Match "Label: Value" patterns in text nodes or adjacent siblings
      const m = text.match(/^([^:]{2,40}):\s*(.+)$/);
      if (m && el.children.length === 0) {
        fields[m[1].trim().toLowerCase()] = m[2].trim();
      }
    });

    // Also try structured dt/dd or label+value pairs
    document.querySelectorAll('dt, th').forEach(label => {
      const key = (label.innerText || '').trim().toLowerCase().replace(/:$/, '');
      const value = (label.nextElementSibling?.innerText || '').trim();
      if (key && value) fields[key] = value;
    });

    // Try definition lists and table rows
    document.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td, th');
      if (cells.length >= 2) {
        const key = cells[0].innerText.trim().toLowerCase().replace(/:$/, '');
        const value = cells[1].innerText.trim();
        if (key && value) fields[key] = value;
      }
    });

    return fields;
  });
}

// Collect all "Bygglov" item links from the current week view
async function collectWeekLinks(page) {
  await sleep(2000);

  return page.evaluate(() => {
    const links = [];
    // Find all clickable items — look for elements containing "Bygglov" text
    // and exclude "Grannhörande"
    const candidates = document.querySelectorAll('a[href], [role="listitem"], li, .item, .card, article');
    candidates.forEach(el => {
      const text = el.innerText || '';
      if (!/bygglov/i.test(text)) return;

      // Prefer anchor href, otherwise look for child anchor
      let href = el.getAttribute('href');
      if (!href) {
        const a = el.querySelector('a[href]');
        href = a?.getAttribute('href');
      }
      if (!href) return;

      const fullUrl = href.startsWith('http') ? href : 'https://digitaltutskick.varmdo.se' + href;
      // Deduplicate
      if (!links.find(l => l.url === fullUrl)) {
        links.push({ url: fullUrl, text: text.replace(/\s+/g, ' ').trim().slice(0, 120) });
      }
    });
    return links;
  });
}

async function scrapeVarmdo() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });
  await page.setViewport({ width: 1280, height: 900 });

  let saved = 0;
  let skipped = 0;
  const seenUrls = new Set();

  try {
    console.error('Hämtar Värmdö kungörelser...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    for (let week = 0; week < WEEKS_BACK; week++) {
      if (week > 0) {
        // Click "<" (previous week) button
        try {
          const clicked = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a, [role="button"]')];
            const prev = btns.find(el => {
              const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
              return t === '<' || t === '‹' || t === '←' || /föregående|previous|prev/i.test(t);
            });
            if (prev) { prev.click(); return true; }
            return false;
          });
          if (!clicked) {
            console.error(`  Kunde inte hitta "<"-knapp vid vecka ${week}, stoppar.`);
            break;
          }
          await sleep(2500);
        } catch (err) {
          console.error(`  Fel vid navigering bakåt: ${err.message}`);
          break;
        }
      }

      const links = await collectWeekLinks(page);
      const newLinks = links.filter(l => !seenUrls.has(l.url));
      newLinks.forEach(l => seenUrls.add(l.url));

      console.error(`  Vecka ${week + 1}: ${links.length} total, ${newLinks.length} nya Bygglov-ärenden`);

      for (const link of newLinks) {
        try {
          const fields = await scrapeDetailPage(page, link.url);

          // Normalize field keys (handles slight label variations)
          const get = (...keys) => {
            for (const k of keys) {
              const found = Object.entries(fields).find(([fk]) => fk.includes(k));
              if (found?.[1]) return found[1];
            }
            return null;
          };

          const fastighetRaw = get('fastighet');
          const { fastighetsbeteckning, adress } = parseFastighet(fastighetRaw);

          const diarienummer = get('ärendenummer', 'diarienummer', 'ärende');
          if (!diarienummer) {
            console.error(`  x ${link.url.slice(-60)}: inget ärendenummer`);
            skipped++;
            continue;
          }

          const utfall = get('utfall', 'beslut', 'resultat');
          const status = mapStatus(utfall);

          // beslutsdatum: prefer "Beslutsdatum" field, fallback to "Publicerat"
          const rawBd = get('beslutsdatum') || get('publicerat');
          const beslutsdatum = rawBd ? rawBd.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null : null;

          const atgard = get('ärendemening', 'ärende', 'åtgärd', 'beskrivning');
          await savePermit({
            diarienummer,
            fastighetsbeteckning,
            adress,
            atgard,
            status,
            permit_type: parsePermitType(atgard),
            beslutsdatum,
            sourceUrl: link.url,
            kommun: 'Värmdö',
          });
          saved++;
          console.error(`  ✓ ${diarienummer} — ${adress || fastighetsbeteckning || '?'}`);

          // Navigate back to list for next iteration
          await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
          // Re-navigate to the correct week
          for (let w = 0; w < week; w++) {
            await page.evaluate(() => {
              const btns = [...document.querySelectorAll('button, a, [role="button"]')];
              const prev = btns.find(el => {
                const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
                return t === '<' || t === '‹' || t === '←' || /föregående|previous|prev/i.test(t);
              });
              if (prev) prev.click();
            });
            await sleep(2000);
          }
        } catch (err) {
          console.error(`  x ${link.url.slice(-60)}: ${err.message}`);
          skipped++;
        }
      }
    }

    console.error(`Klart: ${saved} Värmdö-poster sparade (${skipped} hoppade över).`);
  } finally {
    await browser.close();
  }
}

scrapeVarmdo().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
