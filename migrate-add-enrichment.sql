-- Lägg till berikningskolumner i permits-tabellen
alter table permits
  add column if not exists atgarder text,
  add column if not exists fastighetstyp text,
  add column if not exists beskrivning_kort text;
