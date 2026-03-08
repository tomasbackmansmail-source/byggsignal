-- Fix: Stockholm stads "registrerat"-poster → "ansökt"
--
-- "registrerat" var ett felaktigt fallback i scraper-stockholm-stad.js.
-- c.StartDate = datum ärendet registrerades (= ansökan inkommit), INTE beslutsdatum.
-- c.Description = åtgärdstyp, inte status — dessa poster är obehandlade ansökningar.
--
-- Poster med status='startbesked' berörs INTE (de har explicit "Startbesked" i beskrivningen).
--
UPDATE permits
SET status = 'ansökt'
WHERE status = 'registrerat'
  AND kommun = 'Stockholm stad';
