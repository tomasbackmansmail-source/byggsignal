-- Nolla scraped_at för poster som fick dagens datum vid scraping
-- (de som scraped_at = samma dag som de skapades, minus Stockholm stad som hade rätt datum)
-- Sätt scraped_at = NULL är ej möjligt (NOT NULL constraint).
-- Istället: sätt scraped_at till ett "okänt" sentinel-datum (1970-01-01)
-- för poster där scraped_at är inom de senaste 30 dagarna och inte är Stockholm stad.
-- Kör INTE denna utan att dubbelkolla vilka rader som påverkas!

-- Förhandsgranskning (kör detta först):
-- SELECT id, diarienummer, kommun, scraped_at
-- FROM permits
-- WHERE scraped_at >= now() - interval '30 days'
--   AND scraped_at::date != '1970-01-01'
--   AND kommun != 'Stockholm stad'
-- ORDER BY scraped_at DESC;

-- Nolla (sätt sentinel) för poster med scrape-datum utan känt beslutsdatum:
UPDATE permits
SET scraped_at = '1970-01-01T00:00:00Z'
WHERE scraped_at >= now() - interval '30 days'
  AND scraped_at::date >= CURRENT_DATE - 1
  AND kommun NOT IN ('Salem', 'Haninge', 'Värmdö', 'Stockholm stad');

-- Notering: Salem, Haninge, Värmdö och Stockholm stad har redan
-- rätt datum i scraped_at efter scraper-fixarna ovan.
-- Övriga kommuner: nästa scraper-körning sätter rätt datum om det
-- finns på källsidan, annars sparas DEFAULT now() igen.
