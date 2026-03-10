require('dotenv').config();
const puppeteer = require('puppeteer');
const { savePermit } = require('./db');
const { parsePermitType, parseStatus } = require('./scripts/parse-helpers');

const BASE_URL = 'https://digitaltutskick.varmdo.se/kungorelse';
const WEEKS_BACK = parseInt(process.env.WEEKS_BACK || '5');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

async function scrapeVarmdo() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });
  await page.setViewport({ width: 1280, height: 900 });

  let saved = 0;
  let skipped = 0;
  const seenDiarier = new Set();

  try {
    console.error('Hämtar Värmdö kungörelser...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(5000);

    for (let week = 0; week < WEEKS_BACK; week++) {
      if (week > 0) {
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

      // Click "Visa fler" if present
      await page.evaluate(() => {
        const links = [...document.querySelectorAll('a, button')];
        const more = links.find(el => /visa fler/i.test(el.innerText || ''));
        if (more) more.click();
      });
      await sleep(1500);

      // Collect permit button texts for logging
      const buttonTexts = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button.btn.text-start.w-100')];
        return btns.map(b => (b.innerText || '').trim());
      });

      const itemCount = buttonTexts.length;
      console.error(`  Vecka ${week + 1}: ${itemCount} poster`);

      for (let i = 0; i < itemCount; i++) {
        try {
          // Parse list item text for fallback data
          const lines = (buttonTexts[i] || '').split('\n').map(s => s.trim()).filter(Boolean);
          const listDatum = lines[0] || null;
          const listTyp = lines[1] || null;

          // Click the i-th permit button
          await page.evaluate((idx) => {
            const btns = [...document.querySelectorAll('button.btn.text-start.w-100')];
            if (btns[idx]) btns[idx].click();
          }, i);
          await sleep(2000);

          const detailText = await page.evaluate(() => document.body.innerText);
          const fields = parseDetailFields(detailText);

          const diarienummer = fields['ärendenummer'];
          if (!diarienummer || seenDiarier.has(diarienummer)) {
            if (!diarienummer) {
              console.error(`    x Post ${i}: inget ärendenummer`);
              skipped++;
            }
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
          const atgard = fields['ärendemening'] || listTyp || null;
          const utfall = fields['utfall'] || '';
          const status = parseStatus(utfall + ' ' + (atgard || ''), 'beviljat');
          const beslutsdatum = fields['beslutsdatum'] || fields['publicerat'] || listDatum || null;

          await savePermit({
            diarienummer,
            fastighetsbeteckning,
            adress,
            atgard: atgard ? atgard.toLowerCase() : null,
            status,
            permit_type: parsePermitType(atgard),
            beslutsdatum,
            sourceUrl: BASE_URL,
            kommun: 'Värmdö',
          });
          saved++;
          console.error(`    ✓ ${diarienummer} — ${adress || fastighetsbeteckning || '?'}`);

          // Click "Tillbaka"
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
          try {
            await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);
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

    console.error(`Klart: ${saved} Värmdö-poster sparade (${skipped} hoppade över).`);
  } finally {
    await browser.close();
  }
}

scrapeVarmdo().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
