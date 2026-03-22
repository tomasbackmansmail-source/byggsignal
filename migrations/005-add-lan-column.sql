-- Migration 005: Add län column to permits_v2 and populate based on municipality
-- Maps all 290 Swedish municipalities to their respective counties (län)

ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS lan text;

-- Stockholms län (26 municipalities + variants)
UPDATE permits_v2 SET lan = 'Stockholms län'
WHERE municipality IN (
  'Botkyrka', 'Danderyd', 'Ekerö', 'Haninge', 'Huddinge', 'Järfälla',
  'Lidingö', 'Nacka', 'Norrtälje', 'Nykvarn', 'Nynäshamn', 'Salem',
  'Sigtuna', 'Sollentuna', 'Solna', 'Stockholm', 'Sundbyberg', 'Södertälje',
  'Tyresö', 'Täby', 'Upplands Väsby', 'Upplands-Bro', 'Vallentuna',
  'Vaxholm', 'Värmdö', 'Österåker',
  'Stockholm stad'
);

-- Uppsala län (8 municipalities)
UPDATE permits_v2 SET lan = 'Uppsala län'
WHERE municipality IN (
  'Enköping', 'Heby', 'Håbo', 'Knivsta', 'Tierp', 'Uppsala',
  'Älvkarleby', 'Östhammar'
);

-- Södermanlands län (9 municipalities)
UPDATE permits_v2 SET lan = 'Södermanlands län'
WHERE municipality IN (
  'Eskilstuna', 'Flen', 'Gnesta', 'Katrineholm', 'Nyköping',
  'Oxelösund', 'Strängnäs', 'Trosa', 'Vingåker'
);

-- Östergötlands län (13 municipalities)
UPDATE permits_v2 SET lan = 'Östergötlands län'
WHERE municipality IN (
  'Boxholm', 'Finspång', 'Kinda', 'Linköping', 'Mjölby', 'Motala',
  'Norrköping', 'Söderköping', 'Vadstena', 'Valdemarsvik', 'Ydre',
  'Åtvidaberg', 'Ödeshög'
);

-- Jönköpings län (13 municipalities)
UPDATE permits_v2 SET lan = 'Jönköpings län'
WHERE municipality IN (
  'Aneby', 'Eksjö', 'Gislaved', 'Gnosjö', 'Habo', 'Jönköping',
  'Mullsjö', 'Nässjö', 'Sävsjö', 'Tranås', 'Vaggeryd', 'Vetlanda',
  'Värnamo'
);

-- Kronobergs län (8 municipalities)
UPDATE permits_v2 SET lan = 'Kronobergs län'
WHERE municipality IN (
  'Alvesta', 'Lessebo', 'Ljungby', 'Markaryd', 'Tingsryd',
  'Uppvidinge', 'Växjö', 'Älmhult'
);

-- Kalmar län (12 municipalities)
UPDATE permits_v2 SET lan = 'Kalmar län'
WHERE municipality IN (
  'Borgholm', 'Emmaboda', 'Hultsfred', 'Högsby', 'Kalmar',
  'Mönsterås', 'Mörbylånga', 'Nybro', 'Oskarshamn', 'Torsås',
  'Vimmerby', 'Västervik'
);

-- Gotlands län (1 municipality)
UPDATE permits_v2 SET lan = 'Gotlands län'
WHERE municipality IN (
  'Gotland'
);

-- Blekinge län (5 municipalities)
UPDATE permits_v2 SET lan = 'Blekinge län'
WHERE municipality IN (
  'Karlshamn', 'Karlskrona', 'Olofström', 'Ronneby', 'Sölvesborg'
);

-- Skåne län (33 municipalities)
UPDATE permits_v2 SET lan = 'Skåne län'
WHERE municipality IN (
  'Bjuv', 'Bromölla', 'Burlöv', 'Båstad', 'Eslöv', 'Helsingborg',
  'Hässleholm', 'Höganäs', 'Hörby', 'Höör', 'Klippan', 'Kristianstad',
  'Kävlinge', 'Landskrona', 'Lomma', 'Lund', 'Malmö', 'Osby',
  'Perstorp', 'Simrishamn', 'Sjöbo', 'Skurup', 'Staffanstorp',
  'Svalöv', 'Svedala', 'Tomelilla', 'Trelleborg', 'Vellinge',
  'Ystad', 'Åstorp', 'Ängelholm', 'Örkelljunga', 'Östra Göinge'
);

-- Hallands län (6 municipalities)
UPDATE permits_v2 SET lan = 'Hallands län'
WHERE municipality IN (
  'Falkenberg', 'Halmstad', 'Hylte', 'Kungsbacka', 'Laholm', 'Varberg'
);

-- Västra Götalands län (49 municipalities)
UPDATE permits_v2 SET lan = 'Västra Götalands län'
WHERE municipality IN (
  'Ale', 'Alingsås', 'Bengtsfors', 'Bollebygd', 'Borås', 'Dals-Ed',
  'Essunga', 'Falköping', 'Färgelanda', 'Grästorp', 'Gullspång',
  'Göteborg', 'Götene', 'Herrljunga', 'Hjo', 'Härryda', 'Karlsborg',
  'Kungälv', 'Lerum', 'Lidköping', 'Lilla Edet', 'Lysekil',
  'Mariestad', 'Mark', 'Mellerud', 'Munkedal', 'Mölndal', 'Orust',
  'Partille', 'Skara', 'Skövde', 'Sotenäs', 'Stenungsund', 'Strömstad',
  'Svenljunga', 'Tanum', 'Tibro', 'Tidaholm', 'Tjörn', 'Tranemo',
  'Trollhättan', 'Töreboda', 'Uddevalla', 'Ulricehamn', 'Vara',
  'Vårgårda', 'Vänersborg', 'Åmål', 'Öckerö'
);

-- Värmlands län (16 municipalities)
UPDATE permits_v2 SET lan = 'Värmlands län'
WHERE municipality IN (
  'Arvika', 'Eda', 'Filipstad', 'Forshaga', 'Grums', 'Hagfors',
  'Hammarö', 'Karlstad', 'Kil', 'Kristinehamn', 'Munkfors',
  'Storfors', 'Sunne', 'Säffle', 'Torsby', 'Årjäng'
);

-- Örebro län (12 municipalities)
UPDATE permits_v2 SET lan = 'Örebro län'
WHERE municipality IN (
  'Askersund', 'Degerfors', 'Hallsberg', 'Hällefors', 'Karlskoga',
  'Kumla', 'Laxå', 'Lekeberg', 'Lindesberg', 'Ljusnarsberg',
  'Nora', 'Örebro'
);

-- Västmanlands län (10 municipalities)
UPDATE permits_v2 SET lan = 'Västmanlands län'
WHERE municipality IN (
  'Arboga', 'Fagersta', 'Hallstahammar', 'Kungsör', 'Köping',
  'Norberg', 'Sala', 'Skinnskatteberg', 'Surahammar', 'Västerås'
);

-- Dalarnas län (15 municipalities + variants)
UPDATE permits_v2 SET lan = 'Dalarnas län'
WHERE municipality IN (
  'Avesta', 'Borlänge', 'Falun', 'Gagnef', 'Hedemora', 'Leksand',
  'Ludvika', 'Malung-Sälen', 'Mora', 'Orsa', 'Rättvik',
  'Smedjebacken', 'Säter', 'Vansbro', 'Älvdalen',
  'Malung'
);

-- Gävleborgs län (10 municipalities)
UPDATE permits_v2 SET lan = 'Gävleborgs län'
WHERE municipality IN (
  'Bollnäs', 'Gävle', 'Hofors', 'Hudiksvall', 'Ljusdal',
  'Nordanstig', 'Ockelbo', 'Ovanåker', 'Sandviken', 'Söderhamn'
);

-- Västernorrlands län (7 municipalities)
UPDATE permits_v2 SET lan = 'Västernorrlands län'
WHERE municipality IN (
  'Härnösand', 'Kramfors', 'Sollefteå', 'Sundsvall', 'Timrå',
  'Ånge', 'Örnsköldsvik'
);

-- Jämtlands län (8 municipalities)
UPDATE permits_v2 SET lan = 'Jämtlands län'
WHERE municipality IN (
  'Berg', 'Bräcke', 'Härjedalen', 'Krokom', 'Ragunda',
  'Strömsund', 'Åre', 'Östersund'
);

-- Västerbottens län (15 municipalities)
UPDATE permits_v2 SET lan = 'Västerbottens län'
WHERE municipality IN (
  'Bjurholm', 'Dorotea', 'Lycksele', 'Malå', 'Nordmaling',
  'Norsjö', 'Robertsfors', 'Skellefteå', 'Sorsele', 'Storuman',
  'Umeå', 'Vilhelmina', 'Vindeln', 'Vännäs', 'Åsele'
);

-- Norrbottens län (14 municipalities)
UPDATE permits_v2 SET lan = 'Norrbottens län'
WHERE municipality IN (
  'Arjeplog', 'Arvidsjaur', 'Boden', 'Gällivare', 'Haparanda',
  'Jokkmokk', 'Kalix', 'Kiruna', 'Luleå', 'Pajala', 'Piteå',
  'Älvsbyn', 'Överkalix', 'Övertorneå'
);
