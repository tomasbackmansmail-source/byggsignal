#!/usr/bin/env node
/**
 * identify-platform.js
 *
 * Identifies the underlying platform for Swedish municipality bulletin boards.
 * Uses plain fetch (no Puppeteer) to grab HTML and matches fingerprints.
 *
 * Usage:
 *   node scrapers/identify-platform.js
 */

const URLS = [
  { kommun: 'Knivsta',     url: 'https://www.knivsta.se/politik-och-organisation/anslagstavla' },
  { kommun: 'Salem',       url: 'https://salem.se/anslagstavla.4.5f17fb541901008a8bd67abc.html' },
  { kommun: 'Danderyd',    url: 'https://meetingsplus.danderyd.se/digital-bulletin-board' },
  { kommun: 'Norrtälje',   url: 'https://forum.norrtalje.se/digital-bulletin-board' },
  { kommun: 'Sollentuna',  url: 'https://www.sollentuna.se/kommun--politik/offentlighet-och-sekretess/anslagstavla-officiell/' },
  { kommun: 'Järfälla',    url: 'https://www.jarfalla.se/kommunochpolitik/politikochnamnder/anslagstavla.4.3cbad1981604650ddf392cc7.html' },
  { kommun: 'Nacka',       url: 'https://www.nacka.se/kommun--politik/delta-och-paverka/anslagstavla-officiell/kungorelser/' },
  { kommun: 'Botkyrka',    url: 'https://www.botkyrka.se/kommun-och-politik/digital-anslagstavla' },
  { kommun: 'Södertälje',  url: 'https://www.sodertalje.se/kommun-och-politik/anslagstavla/' },
  { kommun: 'Huddinge',    url: 'https://www.huddinge.se/organisation-och-styrning/huddinge-kommuns-anslagstavla/' },
];

const FINGERPRINTS = [
  {
    platform: 'sitevision',
    test: (_url, html) =>
      /AppRegistry\.registerInitialState/i.test(html) ||
      /sv-channel-item/i.test(html) ||
      /sv-portlet/i.test(html),
  },
  {
    platform: 'meetingsplus',
    test: (url, _html) => /digital-bulletin-board/i.test(url),
  },
  {
    platform: 'netpublicator',
    test: (_url, html) =>
      /netpublicator\.com/i.test(html) ||
      /data-npid/i.test(html),
  },
  {
    platform: 'digitaltutskick',
    test: (url, _html) => /digitaltutskick/i.test(url),
  },
];

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ByggSignal/1.0)',
      'Accept': 'text/html',
      'Accept-Language': 'sv-SE,sv;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function identify(url, html) {
  const matches = [];
  for (const fp of FINGERPRINTS) {
    if (fp.test(url, html)) matches.push(fp.platform);
  }
  return matches.length > 0 ? matches.join(', ') : 'okänd';
}

async function main() {
  console.log('Platform-identifiering av anslagstavlor\n');
  console.log(`${'Kommun'.padEnd(14)} ${'Plattform'.padEnd(16)} URL`);
  console.log(`${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(50)}`);

  for (const { kommun, url } of URLS) {
    try {
      const html = await fetchHtml(url);
      const platform = identify(url, html);
      console.log(`${kommun.padEnd(14)} ${platform.padEnd(16)} ${url}`);
    } catch (err) {
      console.log(`${kommun.padEnd(14)} ${'FEL'.padEnd(16)} ${url}  (${err.message})`);
    }
  }
}

main().catch(err => {
  console.error('Fel:', err.message);
  process.exit(1);
});
