create table if not exists permits (
  id              bigint primary key generated always as identity,
  diarienummer    text unique not null,
  fastighetsbeteckning text,
  adress          text,
  atgard          text,
  kommun          text,
  source_url      text,
  scraped_at      timestamptz not null default now()
);
