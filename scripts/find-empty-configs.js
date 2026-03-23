#!/usr/bin/env node
require('dotenv').config({quiet:true});
const fs = require('fs');
const path = require('path');
// Get all config files and extract kommun names + platform
const configs = [];
function walkDir(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (entry.name.endsWith('.json')) configFiles.push(full);
  }
}
const configFiles = [];
walkDir('scrapers/configs');
for (const f of configFiles) {
  try {
    const c = JSON.parse(fs.readFileSync(f,'utf-8'));
    const dir = path.dirname(f).split('/').pop();
    let platform = 'sitevision';
    if (['wordpress','netpublicator','ciceron','pollux','limepark','meetingsplus'].includes(dir)) {
      platform = dir;
    }
    configs.push({kommun: c.kommun, file: f, platform});
  } catch(e) {}
}

// DB municipalities
const dbKommuner = new Set(['Arvidsjaur','Askersund','Bengtsfors','Bollebygd','Borås','Burlöv','Båstad','Eksjö','Emmaboda','Enköping','Falun','Flen','Gotland','Halmstad','Haninge','Huddinge','Härryda','Hässleholm','Håbo','Höganäs','Järfälla','Jönköping','Karlshamn','Katrineholm','Klippan','Knivsta','Kungsör','Kävlinge','Köping','Laxå','Leksand','Lidingö','Lindesberg','Ljungby','Lomma','Ludvika','Lund','Lysekil','Malmö','Malung-Sälen','Mariestad','Mark','Markaryd','Nacka','Nordanstig','Norrköping','Norrtälje','Nykvarn','Nyköping','Nynäshamn','Nässjö','Ockelbo','Orust','Oskarshamn','Oxelösund','Pajala','Perstorp','Piteå','Ronneby','Sala','Sandviken','Sigtuna','Simrishamn','Sjöbo','Sollefteå','Sollentuna','Solna','Stenungsund','Stockholm stad','Strängnäs','Strömstad','Sundbyberg','Sundsvall','Säffle','Säter','Södertälje','Tingsryd','Tomelilla','Trelleborg','Trosa','Täby','Uddevalla','Umeå','Upplands Väsby','Upplands-Bro','Uppsala','Uppvidinge','Vaggeryd','Vallentuna','Varberg','Vaxholm','Vingåker','Vänersborg','Vännäs','Värmdö','Västerås','Ystad','Älmhult','Älvkarleby','Örebro']);

const empty = configs.filter(c => !dbKommuner.has(c.kommun));
console.log('Configs with 0 data: ' + empty.length);
console.log(JSON.stringify(empty.map(c => ({kommun: c.kommun, file: c.file, platform: c.platform})), null, 2));
