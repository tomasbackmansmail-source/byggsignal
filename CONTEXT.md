# byggsignal — Kontext för ny chatt

## Nuläge

Sajten är live på byggsignal.se och fungerar för Mårten (Chair6).
Motorn levererar 10 758 permits totalt, 883 senaste 7 dagarna,
över 282 kommuner. Beta-fönstret löper ut 30 april — alla inloggade
får Pro gratis tills dess.

CTO Engine arbetar idag (25 april) med en hash-incident där ~42
kommuner producerat 0 ärenden i 6 dagar pga ett hash-skip-problem.
Fix deployad (commit 81393cb), SQL-cleanup pågår. Effekt på oss:
permit-volymen ökar från måndag när dessa kommuner extraherar igen.
Det är återhämtning, inte ny feature.

Tre öppna problem på motor-sidan som påverkar oss:
1. Notify-endpointen — fungerande status oklar
2. Bug 2 (NULL-fält på 21 kommuner) — väntar på riktningsbeslut
3. source_url NULL för Stockholm + Norrtälje — odiagnostiserad

Bara 3 profiles i databasen — ingen volym än. Det är fönstret att
rätta till saker innan kunder börjar betala.

## Aktiva uppgifter

- **Notify-endpoint — verifiera om den fungerar**: Min grep i
  server.js hittade ingen route för /api/cron/notify. Motorn POST:ar
  dit efter Phase 4. Om endpointen saknas har bevakningsmail inte
  gått ut sedan Vercel-cronen togs bort. CTO Engine kollar
  Railway-loggar efter dagens motor-cron och rapporterar status
  (200/401/404). Om den failar: lägg till wrapper i server.js
  som anropar src/notify.js bakom Bearer CRON_SECRET. Detta är
  produktrelevant — bevakningsmail är hela retention-mekanismen
  för Mårten och kommande kunder.
- **Beta-fönster stänger 30 april**: 5 dagar bort. När det stänger
  faller alla från gratis-Pro till sin valda plan. Profiles med
  plan=trial/free får inte längre Pro-features. Verifiera före
  30 april att Stripe webhook + plan-fält + expiry-logik fungerar.
- **Bug 2 (NULL-fält)**: 21 kommuner producerar permits med null
  på date/property/applicant. Ägs av CTO Engine. Påverkar oss
  genom tomma kort eller filtrerad data. Riktningsbeslut väntar
  på Tomas. Ligger efter hash-incidenten i prio.
- **source_url NULL för Stockholm/Norrtälje**: 80+56 rader senaste
  veckan. Odiagnostiserad. Ägs av CTO Engine. Inga frontend-
  workarounds.
- **Dubblerad route**: /stockholm/norrtalje finns två gånger i
  server.js (rad 1344 och 1380). Trivialt — fixa när du ändå
  rör server.js.

## Pilotkundstatus

- **Mårten (Chair6)**: Live, inga klagomål nyligen. Hans tidigare
  feedback (mars): privata bygglov ger inget utan flyer-distribution,
  kommersiella ger värde bara med kontaktuppgifter (applicant glest),
  upphandlingar är där pengarna finns men anbudsprofil saknas. Bug 2
  har inte triggat klagomål än.
- **Inga andra betalande kunder**. Beta-fönstret t.o.m. 30 april.

## Senaste 5 besluten (nyaste överst)

- 2026-04-25: CTO Engine deployade hash-incident-fix (commit 81393cb).
  Två nya motor-regler att veta om: (1) innehåll < 500 bytes hashas
  inte, (2) daily-run respekterar hash bara om config.verified === true.
  ~42 kommuner extraherar igen från måndag.
- 2026-04-22: Motorn refaktorerade subpage-hantering. source_url
  sätts deterministiskt per subpage. raw_html_hash-format ändrat —
  vi använder inte fältet, ingen regression här.
- 2026-04-15: Migration från Vercel till Railway slutförd. Vercel-
  artefakter (vercel.json, api/cron/scrape) finns kvar men används inte.
- 2026-04: Notify flyttat från Vercel cron 17:00 till HTTP-trigger
  från motorn efter daily-run. Endpoint-funktionalitet ej verifierad.
- 2026-03: Stripe-priser fastlåsta — Bas 195/390 kr, Pro 750/1500 kr,
  earlybird 50% till 1 maj. Payment Links skapas manuellt av Tomas.

## Kända knepiga saker just nu

- **Motor-cron 04:00 UTC** (06:00 CEST). Permits dyker upp på
  morgonen, inte mitt på dagen.
- **GitHub auto-deploy till Railway är opålitlig**. Alla deploys
  via railway up --service byggsignal-web.
- **Repot innehåller ~25 legacy scraper-filer** som inte används
  men ligger i roten. Skrev till legacy-tabellen permits. Sajten
  läser från permits_v2. Rör inte, men förvirrande.
- **CommonJS, inte ESM**. require, inte import. Motorns repo är
  ESM — blanda inte.
- **profiles har bara 3 rader**. Förvänta dig inte volymdata —
  testning kräver att vi loggar in själva.
- **public/index.html innehåller hårdkodad anon key**. Det är OK
  (publik nyckel) men kräver att RLS är påslagen på alla tabeller.
- **CTO-chattar kan inte klona git repos** — de hänger. All
  kodläsning sker via filer Tomas klistrar in eller laddar upp,
  eller via lokala bash-kommandon.

## Nästa konkreta steg

Om Tomas inte säger något annat: börja med notify-endpointen.
Den blockerar produktupplevelsen (bevakningsmail) och beta-fönstret
stänger om 5 dagar — vi vill ha mailen flygande innan kunder ska
konvertera.

1. Vänta på CTO Engines rapport om motorns POST till /api/cron/notify
   ger 200, 401 eller 404 efter dagens daily-run.
2. Om den failar: skriv en wrapper i server.js som anropar
   src/notify.js bakom Bearer CRON_SECRET. Verifiera end-to-end
   med ett testmail.
3. Därefter: gå igenom Stripe webhook + plan-fält + expiry-logik
   inför 30 april.

Parallellt och ägs av CTO Engine: Bug 2, source_url-buggarna och
hash-incidenten ägs där, inte här.

## Kontext-tips till nästa chatt

- Klockan: använd bash `date -u`. Antag aldrig.
- Tomas kör SQL i Supabase (abnlmxkgdkyyvbagewgf) och klistrar
  resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med
  git add -A && git commit -m "..." && git push
- En CC per repo. Skriv aldrig till floede-agent härifrån — det
  är CTO Engines repo.
- Motorn har egen CLAUDE.md och CONTEXT.md i floede-agent-repot.
  Bug 2, source_url-buggarna och hash-incidenten ägs där, inte här.
