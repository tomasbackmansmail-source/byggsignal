-- Enrichment-tabeller for externa datakallor
-- Kors med: node scripts/run-migration.js (kraver SUPABASE_DB_URL)
-- Eller kopiera SQL:en till Supabase SQL Editor

-- Kolada (SKR/RKA) nyckeltal for bygglov
CREATE TABLE IF NOT EXISTS enrichment_kolada (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_code  text NOT NULL,
  municipality_name  text NOT NULL,
  kpi_id             text NOT NULL,
  year               integer NOT NULL,
  value              numeric,
  fetched_at         timestamptz DEFAULT now(),
  UNIQUE (municipality_code, kpi_id, year)
);

-- Boverket plan- och byggenkaten
CREATE TABLE IF NOT EXISTS enrichment_boverket_pbe (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_code  text,
  municipality_name  text,
  year               integer,
  metric_name        text,
  value              numeric,
  fetched_at         timestamptz DEFAULT now()
);

-- Boverket energideklarationer (kraver API-nyckel)
CREATE TABLE IF NOT EXISTS enrichment_energideklarationer (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kommun             text,
  fastighetsbeteckning text,
  adress             text,
  postnummer         text,
  postort            text,
  energiklass        text,
  primarenergital    numeric,
  energiprestanda    numeric,
  radonmatning       text,
  ventilationskontroll text,
  utford_datum       date,
  fetched_at         timestamptz DEFAULT now()
);

-- Boverket planbestammelsekatalogen
CREATE TABLE IF NOT EXISTS enrichment_planbestammelser (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bestammelse_kod    text,
  bestammelse_uuid   text,
  namn               text,
  kategori           text,
  underkategori      text,
  beskrivning        text,
  raw_json           jsonb,
  fetched_at         timestamptz DEFAULT now()
);

-- Index for vanliga queries
CREATE INDEX IF NOT EXISTS idx_kolada_municipality ON enrichment_kolada (municipality_code);
CREATE INDEX IF NOT EXISTS idx_kolada_kpi ON enrichment_kolada (kpi_id);
CREATE INDEX IF NOT EXISTS idx_kolada_year ON enrichment_kolada (year);
CREATE INDEX IF NOT EXISTS idx_pbe_municipality ON enrichment_boverket_pbe (municipality_code);
CREATE INDEX IF NOT EXISTS idx_pbe_year ON enrichment_boverket_pbe (year);
CREATE INDEX IF NOT EXISTS idx_energi_kommun ON enrichment_energideklarationer (kommun);
CREATE INDEX IF NOT EXISTS idx_plan_kod ON enrichment_planbestammelser (bestammelse_kod);
