-- Nolla sentinel-värdet 1970-01-01 som sattes manuellt via fix-beslutsdatum.sql.
-- OBS: scraped_at har troligtvis en NOT NULL-constraint. Kör ALTER TABLE först.
-- Om kolonnen redan tillåter NULL kan ALTER-raden hoppas över.

-- Steg 1: Tillåt NULL i scraped_at
ALTER TABLE permits
  ALTER COLUMN scraped_at DROP NOT NULL;

-- Steg 2: Nolla sentinel-raderna
UPDATE permits
SET scraped_at = NULL
WHERE scraped_at = '1970-01-01T00:00:00+00:00';
