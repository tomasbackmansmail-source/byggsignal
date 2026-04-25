# ByggSignal — Datakontrakt Lager 2: Produktkvalitet

> Detta dokument definierar vad ByggSignal som *produkt* lovar sina
> kunder. Tröskelvärden, NULL-procent och kvalitetsnivåer per kundsegment.
>
> Det här är affärsbeslut, inte tekniska invarianter. Frågor som
> "max 5% NULL source_url" hör hemma här, inte i Lager 1.
>
> **Ägare:** CEO + CTO ByggSignal gemensamt
> **Bygger på:** `floede-agent/docs/data-contract-engine.md` (Lager 1)
> **Version:** 0.1.0 (förankrad av CTO ByggSignal 2026-04-25)
> **Senast uppdaterad:** 2026-04-25

---

## 1. Produktlöfte

ByggSignal levererar bygglovsdata från svenska kommuners anslagstavlor
till hantverkare och byggbolag. Värdet ligger i att kunden får rätt
affärssignal i rätt fas — beviljat bygglov = budget låst, byggherren
söker leverantörer.

För att produkten ska vara trovärdig krävs att data:
1. Pekar tillbaka till källan (kunden ska kunna verifiera)
2. Har rätt typ och status (filtrering på fas är affärslogiken)
3. Speglar verkligheten i kommunen (täckning, frekvens)

---

## 2. Datakvalitet per fält

### 2.1 Fält som ALDRIG får vara null

Definierat i Lager 1 sektion 2.1 (tekniska invarianter). För ByggSignal:

- `municipality`
- `source_url`
- `raw_html_hash` (för poster skapade ≥ 2026-04-22)

### 2.2 Fält där null är acceptabelt

Posten sparas även om null. Null spårar i kvalitetsmätningen.
(`source_url` listas inte här — Lager 1 sektion 2.1 droppar poster
utan source_url, så fältet är tekniskt obligatoriskt.)

| Fält | Tröskel | Påverkan om över tröskel |
|------|---------|--------------------------|
| `case_number` | 50% NULL/7d | Kunden kan inte spåra ärendet hos kommunen — minskar trovärdighet |
| `address` | 30% NULL/7d | Kunden kan inte agera på signalen — adress är affärskritiskt |
| `property` | 70% NULL/7d | Filtrering på fastighetsbeteckning fungerar inte meningsfullt |
| `applicant` | Mäts separat* | Kommersiella bygglov saknar identifierad byggherre — minskar Pro-värde |
| `description` | 30% NULL/7d | Kortet blir innehållslöst — försämrar UX |
| `date` | 30% NULL/7d | Sortering och filter på fas fungerar inte |
| `permit_type` | 30% NULL/7d | Kunden kan inte filtrera på typ — kärnfunktion bryter |
| `status` | 30% NULL/7d | Kunden kan inte placera ärendet i pipeline — minskar affärsvärdet |

*`applicant` mäts separat: NULL-procent beräknas BARA på poster där
sökanden enligt källan är en organisation (innehåller markörer som AB,
BRF, kommun, region, stiftelse, förening). Privatpersoner exkluderas
från nämnaren — de ska alltid vara null pga GDPR. Tröskeln för denna
delmängd: 30% NULL/7d. Idag har vi 0.34% applicant ifylld totalt — vi
vet inte hur stor andel av ärenden som BORDE ha applicant. Den siffran
måste mätas först innan tröskeln är meningsfull.

**Källa över tröskel** = flagga `degraded` i `discovery_configs`.
**Källa över tröskel 7 dagar i rad** = trigga rediscovery + mejla CTO ByggSignal.

**Notera:** Trösklarna är utgångsvärden. När `source_quality_daily`
samlat 30 dagars data ska de revideras mot faktisk fördelning per
kommun, inte mot förväntningar.

### 2.3 Per-vertikal-aggregat

Hela vertikalen är `degraded` om >30% av aktiva källor är `degraded`.
Det är en kritisk affärssignal — produkten levererar inte vad vi lovar.
Larm går till CEO.

### 2.4 UI-hantering vid null

Frontenden måste veta hur den ska bete sig när fält är null. Det är
produktbeslut, inte tekniskt.

| Fält null | UI-beteende |
|-----------|-------------|
| `address` | Kortet visas inte (eller markeras "adress saknas, klicka för att se hos kommunen") |
| `applicant` | Applicant-raden döljs, kortet annars normalt |
| `date` | Kortet visas inte (kan inte sortera utan datum) |
| `property` | Fältet döljs, kortet annars normalt |
| `permit_type` | Kortet visas inte (vi kan inte klassificera) |
| `status` | Kortet visas inte (vi kan inte placera i pipeline) |
| `case_number` | Fältet döljs, kortet annars normalt |
| `description` | Fältet döljs, kortet annars normalt |

Implementeras av frontend när notify-fixen och datakvaliteten är på plats.

### 2.5 Tröskel för att stänga av kommun från UI

Om en kommun har >70% NULL på `address` ELLER `permit_type` ELLER `status`
under 14 dagar i rad: kommunen döljs från default-filtren tills motorn
fixat. Synlig via "visa alla kommuner"-toggle.

`case_number` och `description` ingår inte i avstängningsregeln — de
påverkar trovärdighet men inte handlingsbarhet. En kommun kan vara
användbar även utan dem.

Anledning: Mårten ska inte se tomma kort och tappa förtroende för
produkten. Bättre att tysta en kommun som inte levererar än att
visa skräp.

---

## 3. Källrytm — per kommun, inte globalt

Lager 1 säger: motorn reflekterar källans faktiska rytm. Här definierar
vi rytm per kommun.

### 3.1 Stale-tröskel per kommun

Beräknas från `source_quality_daily` rolling 30d MEDIAN (inte medelvärde).
Median är robustare mot tystnadsperioder — Stockholm efter en två-veckors
tystnad får inte artificiellt låg "rytm".

**Krav på historik**: Kommunen får egen stale-tröskel först efter
14 dagars historik. Innan dess: default 7 dagar.

**Formel:**
- daglig publicering (median >0.7/dag): stale = 5 dagar
- regelbunden (median 0.2-0.7/dag): stale = 7 dagar
- gles (median 0.05-0.2/dag): stale = 14 dagar
- mycket gles (median <0.05/dag): stale = 30 dagar

Anledning till 5 dagar (inte 3) för dagliga: Stockholm publicerar
dagligen vardagar. Tystnad fredag-måndag är 4 dagar utan att något
är fel. Tröskel 5 dagar undviker rediscovery efter varje normal
helg-tystnad.

### 3.2 Aktiva-zero-larm

Vardag (mån-fre): om >30 aktiva kommuner gett 0 poster idag → larm.
"Aktiv" = ≥5 poster senaste 30 dagarna.

Helger (lör-sön) larmar inte. Anledning: om en kommun publicerar lördag
är det bonus, inte krav. Att börja larma på helger genererar falska
positiva och stör arbetshelger.

(Befintlig regel från 2026-04-25 — flyttas hit som affärsregel.)

---

## 4. Storkund-segment

Storkundsegment (>5000 kr/mån) definieras när första prospekt visar
intresse. Sannolikt strängare trösklar och SLA. Inte i scope för v0.1.

---

## 5. Dataflöde och escalering

### 5.1 Per post

Lager 1 sektion 2 definierar tekniska kontroller. Inga affärslarm
på post-nivå.

### 5.2 Per källa

Daily-run skriver till `source_quality_daily`. QC läser tabellen och:

- 1 dag över tröskel → loggning
- 3 dagar över tröskel → markera `degraded`
- 7 dagar över tröskel → trigga rediscovery + mejla CTO ByggSignal

### 5.3 Per vertikal

Om >30% av aktiva källor är `degraded` → kritisk alert till CEO.

---

## 6. Datakontrakt mot kund (publicerat)

ByggSignal publicerar inte detta dokument externt. Däremot publicerar
vi en förenklad version på byggsignal.se under "Om data":

> ByggSignal samlar bygglovsdata från svenska kommuners officiella
> anslagstavlor. Vi länkar alltid tillbaka till källan så du kan
> verifiera. Vi sparar aldrig privatpersoners namn (GDPR).
>
> Datakvalitet varierar mellan kommuner — vissa publicerar mer
> information än andra. Om du upptäcker fel data, mejla hej@byggsignal.se
> så åtgärdar vi.

---

## 7. Beslut och pågående arbete

### 7.1 Trösklar revideras efter 30d data

Trösklarna i sektion 2.2 är utgångsvärden. När `source_quality_daily`
samlat 30 dagars data ska de revideras mot faktisk fördelning per
kommun. Mätning av `applicant`-fältet kräver särskild eftertanke (se
fotnot i 2.2).

### 7.2 Versionering tillsammans med kod

När v0.1 är låst checkas dokumenten in i båda repon:
- Lager 1 i `floede-agent/docs/data-contract-engine.md`
- Lager 2 ByggSignal i `byggsignal/docs/data-contract-byggsignal.md`

Versioneras tillsammans med koden, inte som lösa filer.
