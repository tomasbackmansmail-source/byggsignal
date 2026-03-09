-- Lägg till beslutsdatum (kommunens officiella beslutsdatum, ej scrape-datum)
alter table permits
  add column if not exists beslutsdatum date;
