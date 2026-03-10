require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType, parseStatus } = require('./scripts/parse-helpers');

const BASE_URL = 'https://utskick.haninge.se/kungorelse';
const WEEKS_BACK = parseInt(process.env.WEEKS_BACK || '5');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse list items from the weekly view
// Each permit is a button with text: "2026-03-10\n\nBygglov \n\nÅBY 1:196, Åbylundsvägen 3, Västerhaninge"
function parseListItems(buttons) {
  return buttons.map(text => {
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    // lines[0] = date, lines[1] = type, lines[2] = property info
    const datum = lines[0] || null;
    const typ = lines[1] || null;
    const fastighet = lines[2] || null;
    return { datum, typ, fastighet };
  });
}

// Parse detail page fields from innerText
function parseDetailFields(text) {
  const fields = {};
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const labels = ['ärendemening', 'fastighet', 'ärendenummer', 'utfall', 'beslutsdatum', 'publicerat'];
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].toLowerCase().replace(/:$/, '');
    if (labels.includes(key) && i + 1 < lines.length) {
      fields[key] = lines[i + 1];
    }
  }
  return fields;
}

function parseFastighet(text) {
  if (!text) return { fastighetsbeteckning: null, adress: null };
  const parts = text.split(',').map(s => s.trim());
  const fastighetsbeteckning = parts[0] || null;
  const adress = parts.length >= 3 ? parts.slice(1, -1).join(', ') : (parts[1] || null);
  return { fastighetsbeteckning, adress };
}

async function scrapeHaninge() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });
  await page.setViewport({ width: 1280, height: 900 });

  let saved = 0;
  let skipped = 0;
  const seenDiarier = new Set();

  try {
    console.error('Hämtar Haninge kungörelser...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(5000);

    for (let week = 0; week < WEEKS_BACK; week++) {
      if (week > 0) {
        // Click previous week button (first button.btn.border = angle-left)
        const clicked = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button.btn.border')];
          if (btns[0]) { btns[0].click(); return true; }
          return false;
        });
        if (!clicked) {
          console.error(`  Kunde inte navigera bakåt vid vecka ${week}, stoppar.`);
          break;
        }
        await sleep(3000);
      }

      // Click "Visa fler" if present to show all items
      await page.evaluate(() => {
        const links = [...document.querySelectorAll('a, button')];
        const more = links.find(el => /visa fler/i.test(el.innerText || ''));
        if (more) more.click();
      });
      await sleep(1500);

      // Collect all permit buttons
      const buttonTexts = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button.btn.text-start.w-100')];
        return btns.map(b => (b.innerText || '').trim());
      });

      const items = parseListItems(buttonTexts);
      console.error(`  Vecka ${week + 1}: ${items.length} poster`);

      // Click each permit button to get detail page
      for (let i = 0; i < items.length; i++) {
        try {
          // Click the i-th permit button
          await page.evaluate((idx) => {
            const btns = [...document.querySelectorAll('button.btn.text-start.w-100')];
            if (btns[idx]) btns[idx].click();
          }, i);
          await sleep(2000);

          // Read detail page
          const detailText = await page.evaluate(() => document.body.innerText);
          const fields = parseDetailFields(detailText);

          const diarienummer = fields['ärendenummer'];
          if (!diarienummer || seenDiarier.has(diarienummer)) {
            if (!diarienummer) {
              console.error(`    x Post ${i}: inget ärendenummer`);
              skipped++;
            }
            // Click "Tillbaka" to return to list
            await page.evaluate(() => {
              const btns = [...document.querySelectorAll('button, a')];
              const back = btns.find(el => /tillbaka/i.test(el.innerText || ''));
              if (back) back.click();
            });
            await sleep(1500);
            continue;
          }
          seenDiarier.add(diarienummer);

          const fastighetRaw = fields['fastighet'];
          const { fastighetsbeteckning, adress } = parseFastighet(fastighetRaw);
          const atgard = fields['ärendemening'] || items[i]?.typ || null;
          const utfall = fields['utfall'] || '';
          const status = parseStatus(utfall + ' ' + (atgard || ''), 'beviljat');
          const beslutsdatum = fields['beslutsdatum'] || fields['publicerat'] || items[i]?.datum || null;

          await savePermit({
            diarienummer,
            fastighetsbeteckning,
            adress,
            atgard: atgard ? atgard.toLowerCase() : null,
            status,
            permit_type: parsePermitType(atgard),
            beslutsdatum,
            sourceUrl: BASE_URL,
            kommun: 'Haninge',
          });
          saved++;
          console.error(`    ✓ ${diarienummer} — ${adress || fastighetsbeteckning || '?'}`);

          // Click "Tillbaka" to return to list
          await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a')];
            const back = btns.find(el => /tillbaka/i.test(el.innerText || ''));
            if (back) back.click();
          });
          await sleep(1500);

          // Re-click "Visa fler" if needed
          await page.evaluate(() => {
            const links = [...document.querySelectorAll('a, button')];
            const more = links.find(el => /visa fler/i.test(el.innerText || ''));
            if (more) more.click();
          });
          await sleep(500);
        } catch (err) {
          console.error(`    x Post ${i}: ${err.message}`);
          skipped++;
          // Try to navigate back to list
          try {
            await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);
            // Re-navigate to correct week
            for (let w = 0; w < week; w++) {
              await page.evaluate(() => {
                const btns = [...document.querySelectorAll('button.btn.border')];
                if (btns[0]) btns[0].click();
              });
              await sleep(2000);
            }
          } catch (_) { /* ignore */ }
        }
      }
    }

    console.error(`Klart: ${saved} Haninge-poster sparade (${skipped} hoppade över).`);
  } finally {
    await browser.close();
  }
}

scrapeHaninge().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
