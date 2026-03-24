-- Migration 009: CPV → trade_category mapping for procurements
-- Run in Supabase SQL Editor

-- Step 1: Add trade_category column
ALTER TABLE procurements
ADD COLUMN IF NOT EXISTS trade_category text;

-- Step 2: Create CPV mapping table
CREATE TABLE IF NOT EXISTS cpv_trade_mapping (
  cpv_prefix text PRIMARY KEY,
  trade_category text NOT NULL
);

INSERT INTO cpv_trade_mapping (cpv_prefix, trade_category) VALUES
-- Bygg (huvudkategori)
('45000000', 'Bygg'),
('45100000', 'Mark'),
('45110000', 'Rivning'),
('45111000', 'Rivning'),
('45200000', 'Bygg'),
('45210000', 'Bygg'),
('45211000', 'Bygg'),
('45220000', 'Bygg'),
('45230000', 'Mark'),
('45233000', 'Mark'),
('45260000', 'Tak'),
('45261000', 'Tak'),
('45300000', 'Installation'),
('45310000', 'El'),
('45311000', 'El'),
('45312000', 'El'),
('45315000', 'El'),
('45320000', 'Isolering'),
('45330000', 'VVS'),
('45331000', 'VVS'),
('45332000', 'VVS'),
('45340000', 'Stängsel'),
('45400000', 'Bygg'),
('45410000', 'Puts'),
('45420000', 'Snickeri'),
('45421000', 'Snickeri'),
('45430000', 'Golv'),
('45431000', 'Golv'),
('45432000', 'Golv'),
('45440000', 'Måleri'),
('45441000', 'Glas'),
('45442000', 'Måleri'),
('45443000', 'Fasad'),
('45450000', 'Bygg'),
-- Arkitekt- och byggtjänster
('71000000', 'Konsult'),
('71200000', 'Arkitekt'),
('71300000', 'Konsult'),
('71500000', 'Konsult'),
('71520000', 'Besiktning'),
-- Hiss
('42416000', 'Hiss'),
('45313000', 'Hiss'),
-- Trädgård/Landskap
('77300000', 'Landskap'),
('77310000', 'Landskap')
ON CONFLICT (cpv_prefix) DO UPDATE SET trade_category = EXCLUDED.trade_category;

-- Step 3: Populate trade_category from CPV mapping (longest prefix match)
UPDATE procurements p
SET trade_category = m.trade_category
FROM cpv_trade_mapping m
WHERE p.category IS NOT NULL
  AND p.category LIKE m.cpv_prefix || '%'
  AND p.trade_category IS NULL;

-- Step 4: Fallback — title matching for remaining NULLs
UPDATE procurements
SET trade_category = CASE
  WHEN LOWER(title) LIKE '%måleri%' OR LOWER(title) LIKE '%målning%' THEN 'Måleri'
  WHEN LOWER(title) LIKE '%el %' OR LOWER(title) LIKE '%elinstallation%' OR LOWER(title) LIKE '%belysning%' THEN 'El'
  WHEN LOWER(title) LIKE '%vvs%' OR LOWER(title) LIKE '%ventilation%' OR LOWER(title) LIKE '%rör%' OR LOWER(title) LIKE '%värme%' THEN 'VVS'
  WHEN LOWER(title) LIKE '%tak%' OR LOWER(title) LIKE '%taktäckning%' THEN 'Tak'
  WHEN LOWER(title) LIKE '%golv%' OR LOWER(title) LIKE '%golvläggning%' THEN 'Golv'
  WHEN LOWER(title) LIKE '%mark%' OR LOWER(title) LIKE '%schakt%' OR LOWER(title) LIKE '%asfalt%' THEN 'Mark'
  WHEN LOWER(title) LIKE '%hiss%' THEN 'Hiss'
  WHEN LOWER(title) LIKE '%fasad%' THEN 'Fasad'
  WHEN LOWER(title) LIKE '%rivning%' OR LOWER(title) LIKE '%demontering%' THEN 'Rivning'
  WHEN LOWER(title) LIKE '%konsult%' OR LOWER(title) LIKE '%projektering%' THEN 'Konsult'
  WHEN LOWER(title) LIKE '%arkitekt%' THEN 'Arkitekt'
  WHEN LOWER(title) LIKE '%landskap%' OR LOWER(title) LIKE '%trädgård%' OR LOWER(title) LIKE '%grönyta%' THEN 'Landskap'
  WHEN LOWER(title) LIKE '%snickeri%' OR LOWER(title) LIKE '%fönster%' OR LOWER(title) LIKE '%dörr%' THEN 'Snickeri'
  WHEN LOWER(title) LIKE '%isolering%' THEN 'Isolering'
  WHEN LOWER(title) LIKE '%styr%' OR LOWER(title) LIKE '%automation%' THEN 'Styr'
  WHEN LOWER(title) LIKE '%bygg%' OR LOWER(title) LIKE '%ombygg%' OR LOWER(title) LIKE '%renovering%' THEN 'Bygg'
  ELSE 'Övrigt bygg'
END
WHERE trade_category IS NULL;

-- Step 5: Verify
SELECT trade_category, COUNT(*) as antal
FROM procurements
GROUP BY trade_category
ORDER BY antal DESC;
