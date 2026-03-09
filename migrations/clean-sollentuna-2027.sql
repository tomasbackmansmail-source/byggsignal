-- Rensa Sollentuna-poster med fejkdatum 2027-12-31.
-- Scrapern plockade upp anmälans utgångsdatum ("Datum: 2027-12-31")
-- som beslutsdatum istället för det faktiska beslutet.
-- Dessa poster är värdelösa — ta bort och kör om scrapern.

DELETE FROM permits
WHERE kommun = 'Sollentuna'
  AND scraped_at > '2027-01-01';
