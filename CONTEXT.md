# byggsignal — Kontext för ny chatt

## Nuläge

Sajten är live på byggsignal.se och fungerar för Mårten (Chair6).
Motorn levererar 10 758 permits totalt, 883 senaste 7 dagarna,
över 282/291 kommuner. Beta-fönstret löper ut 30 april — alla
inloggade får Pro gratis tills dess. Beslut: Stripe/intäkter är
parkerat. Beta är gratis. Mailen slås inte på förrän datan håller.

Strategin är: datakvalitet först, enrichment sedan, features sist.

CTO Engine arbetar idag (25 april) med en hash-incident där ~42
kommuner producerat 0 ärenden i 6 dagar pga ett hash-skip-problem.
Fix deployad (commit 81393cb), SQL-cleanup pågår. Effekt på oss:
permit-volymen ökar från måndag när dessa kommuner extraherar igen.
Återhämtning, inte ny feature.

Datakontrakt v0.1 förankrat 25 april. Läs `docs/data-contract-byggsignal.md`
(Lager 2: produktkvalitet) och motorns `floede-agent/docs/data-contract-engine.md`
(Lager 1: motorgarantier) innan du fattar beslut om datakvalitet,
NULL-trösklar eller UI-beteende vid null.

## Datakvalitet — baseline 22 april

Totalt: 10 075 permits (siffran från förra inventeringen — nu 10 758).
Aktiva kommuner senaste 7 dagar: 134 av 291.
Misstänkt trasiga: 120 kommuner. Göteborg 32 dagar utan, Uppsala 25,
Luleå 25.

Fältkvalitet:
- applicant: 0.34% ifylld
- address: 70% ifylld
- date NULL: 3%
- status NULL: 3%
- 3 ÅÄÖ-dubletter kvar att städa
- 21 kommuner med systematisk NULL på date

Detta är affärsproblemet. Bevakningsmail kan inte slås på förrän
applicant och adress är pålitliga — annars skickar vi värdelösa
leads till Mårten.

## Aktiva uppgifter

- **Notify-fixen är skriven men parkerad**. Bevakningsmail har inte
  skickats sedan 29 mars (Vercel-avvecklingen). Rotorsak: notify-
  rutten monterades aldrig i server.js. POST från motorn ger 404.
  Fix klar lokalt — väntar på att datan håller. Deploya INTE förrän
  CTO Engine signalerar att applicant/address är pålitliga.
- **branches-fältet används inte i notify-filtreringen**. Onboardingen
  samlar in branschval men src/notify.js matchar bara på
  selected_kommuner. När notify deployas: lägg till branches-filter.
- **Maildesign-mockup klar**: beviljat prioriterat, ansökt sekundärt,
  upphandlingar separat, applicant visas villkorat (bara när det
  faktiskt finns data). Implementera när notify deployas.
- **UI-hantering vid null** definierad i datakontraktets sektion 2.4.
  Ska implementeras när datakvaliteten håller. Berör hela frontenden
  — kort med NULL date/permit_type/status/address ska inte visas.
- **Kommun-avstängning från UI** definierad i datakontraktets sektion 2.5.
  Kommuner med >70% NULL på address/permit_type/status under 14 dagar
  döljs från default-filter. Implementeras parallellt med UI-null-hantering.
- **Bug 2 (NULL-fält på 21 kommuner)**: ägs av CTO Engine. Fas 0-
  research klar. Riktningsbeslut väntar på Tomas. Ligger efter
  hash-incidenten i CTO Engines prio.
- **source_url NULL för Stockholm/Norrtälje**: 80+56 rader senaste
  veckan. Odiagnostiserad. Ägs av CTO Engine. Inga frontend-
  workarounds.
- **Dubblerad route**: /stockholm/norrtalje finns två gånger i
  server.js (rad 1344 och 1380). Trivialt — fixa när du ändå rör
  server.js.

## Pilotkundstatus

- **Mårten (Chair6)**: Live, inga klagomål nyligen. Hans tidigare
  feedback (mars): privata bygglov ger inget utan flyer-distribution,
  kommersiella ger värde bara med kontaktuppgifter (applicant glest),
  upphandlingar är där pengarna finns men anbudsprofil saknas.
  Får inga bevakningsmail för tillfället — han vet inte om det.
- **Inga andra betalande kunder**.

## Senaste 5 besluten (nyaste överst)

- 2026-04-25: Datakontrakt v0.1 förankrat. Lager 1 (motor) och
  Lager 2 (ByggSignal-produkt) checkade in i respektive repo.
  Tröskelvärden, UI-beteende vid null, kommun-avstängning, stale-
  formler definierade. Trösklar revideras efter 30d data från
  source_quality_daily-tabellen (byggs av CTO Engine).
- 2026-04-25: CTO Engine deployade hash-incident-fix (commit 81393cb).
  Två nya motor-regler: (1) innehåll < 500 bytes hashas inte,
  (2) daily-run respekterar hash bara om config.verified === true.
  ~42 kommuner extraherar igen från måndag.
- 2026-04-22: Datakvalitet först, enrichment sedan, features sist.
  Stripe/intäkter parkerat. Mailen slås inte på förrän datan håller.
- 2026-04-22: Notify-bugg identifierad. Rotorsak: rutten monterades
  aldrig efter Vercel-avveckling. Fix skriven, parkerad.
- 2026-04-22: CTO Engine prio: rediscovery av 120 trasiga kommuner,
  ÅÄÖ-städning, date NULL-fix, sedan applicant via diariesystem.

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

Om Tomas inte säger något annat: vänta på CTO Engine. Datakvalitet
är prio 1, och den ligger på motor-sidan — rediscovery av 120
trasiga kommuner, ÅÄÖ-städning, date NULL-fix, applicant-enrichment.
Allt det måste landa innan notify deployas.

När CTO Engine signalerar att datan håller (mätt mot trösklarna
i datakontraktets sektion 2.2):
1. Deploya den parkerade notify-fixen
2. Lägg till branches-filter i src/notify.js
3. Implementera maildesign-mockupen
4. Implementera UI-hantering vid null (sektion 2.4)
5. Implementera kommun-avstängning (sektion 2.5)
6. Verifiera end-to-end med ett testmail till Mårten

Tills dess: småfixar i server.js är OK (dubblerad norrtalje-route,
trivial UI-polering). Inga större features. Inga frontend-workarounds
för datakvalitetsproblem.

## Kontext-tips till nästa chatt

- Klockan: använd bash `date -u`. Antag aldrig.
- Tomas kör SQL i Supabase (abnlmxkgdkyyvbagewgf) och klistrar
  resultat. Skriv kodboxar tydligt, en i taget.
- CC-prompter slutar alltid med
  git add -A && git commit -m "..." && git push
- En CC per repo. Skriv aldrig till floede-agent härifrån — det
  är CTO Engines repo.
- Motorn har egen CLAUDE.md och CONTEXT.md i floede-agent-repot.
  Bug 2, source_url-buggarna, hash-incidenten och datakvalitets-
  arbetet ägs där, inte här.
- Datakontraktet är källan till sanning för datakvalitetsfrågor.
  Lager 1 (motor): floede-agent/docs/data-contract-engine.md.
  Lager 2 (produkt): byggsignal/docs/data-contract-byggsignal.md.
