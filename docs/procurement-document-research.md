# Research: Upphandlingsdokument-tillgänglighet

Datum: 2026-03-24

## KommersAnnons (eLite + Stockholm)

- **URL-mönster:** `kommersannons.se/eLite/Notice/NoticeOverview.aspx?ProcurementId=XXXXX`
  och `kommersannons.se/stockholm/Notice/NoticeOverview.aspx?ProcurementId=XXXXX`
- **Annonsida utan inloggning:** Ja — titel, CPV-kod, deadline, förfarandetyp, län visas publikt
- **Kontaktperson/belopp på annonsidan:** Nej — finns inte i overview-vyn
- **PDF/dokument utan inloggning:** Nej — "Upphandlingsdokument" och "Bilagor" kräver inloggning
- **Dokument-URL-struktur:** `Request/Request.aspx?ProcurementId=XXXXX` (bakom auth)
- **Registrering:** Gratis konto kan skapas, men Antirios TOS (punkt 3.3) förbjuder automatiserad åtkomst

**Vad vi KAN scrapa utan inloggning:** Grunddata från annonsidan — beskrivning, CPV, deadline, förfarandetyp. Detta har vi redan.

**Vad vi INTE kan nå:** Förfrågningsunderlag (PDF), bilagor, kontaktperson, belopp.

## e-Avrop

- **URL-mönster:** `e-avrop.com/{kommun}/visa/upphandling.aspx?id=XXXXX`
- **Annonsida utan inloggning:** Nej — sidan redirectar till inloggning
- **PDF/dokument utan inloggning:** Nej — allt bakom auth
- **Registrering:** Gratis konto kan skapas

**Vad vi KAN scrapa utan inloggning:** Ingenting — hela sidan kräver inloggning.

**Vad vi INTE kan nå:** All detaljerad data inklusive beskrivning, dokument, kontakt.

## TED (Tenders Electronic Daily)

- **URL-mönster:** `ted.europa.eu/en/search/result?q=Stockholm`
- **Annonsida utan inloggning:** Ja — helt publikt
- **Dokument:** Ja — EU-annonser publiceras med full text och bilagor
- **Begränsning:** Bara upphandlingar över EU:s tröskelvärden (~2.3 MSEK för tjänster, ~5.5 MSEK för bygg). Majoriteten av kommunala byggjobb ligger under tröskelvärdena.

## Kommunernas egna hemsidor

Testade: stockholm.se, nacka.se, huddinge.se, solna.se, sundbyberg.se

- **stockholm.se/upphandling:** SSL-certifikatproblem vid scraping
- **nacka.se:** 404 på upphandlingssidan — hänvisar troligen till KommersAnnons
- **huddinge.se:** Blockerar requests (header-validering)
- **solna.se/upphandling:** 404
- **sundbyberg.se:** 404

**Slutsats:** De flesta kommuner publicerar inte upphandlingar på egna hemsidor utan hänvisar till KommersAnnons eller e-Avrop.

## Slutsats och rekommendation

### Vad vi kan göra nu (utan godkännande):
1. **Berika från annonsidorna på KommersAnnons** — scrapa mer detaljerad text från publika overview-sidor (beskrivning, förfarandetyp, CPV-detaljer). Begränsad nytta.
2. **TED-integration** — för större upphandlingar (>EU-tröskelvärde). Full data publikt. Begränsat antal relevanta annonser.

### Vad som kräver godkännande/avtal:
1. **KommersAnnons API/dokument** — kontakta Antirio för API-avtal eller bulk-access
2. **e-Avrop API** — kontakta e-Avrop för leverantörs-API

### Rekommenderad väg framåt:
1. **Kortsiktigt:** Fokusera på att berika upphandlingskorten med data vi redan har (trade_category, deadline-countdown, kommun-filter). Det ger mest värde utan extern dependency.
2. **Medellång sikt:** Kontakta Antirio (KommersAnnons) om API-avtal. De har sannolikt ett leverantörs-API.
3. **Långsiktigt:** TED-integration för stora upphandlingar, eventuellt e-Avrop-avtal.
