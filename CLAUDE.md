## Senast uppdaterat 2026-03-30

- Supabase auth deadlock fixad: setTimeout-dispatch i onAuthStateChange + noOp lock i createClient
- Stripe webhook fixad: STRIPE_SECRET_KEY (versaler) satt i Railway byggsignal-web
- Tomma kort dolda: filterPermits filtrerar bort ärenden utan description+address+date
- Dynamiskt län-filter: alla 21 län med kommun-chips från /api/coverage, buildDynamicLanData()
- Applicant visas för alla Bas+Pro, inte bara industri/flerbostads
- Property-extraction tillagd i floede-agent prompt + field_mapping
- Municipality-normalisering i floede-agent: strip kommun/stad suffix vid insert
- Notify-trigger: floede-agent Phase 4 anropar NOTIFY_URL efter extraction
- railway.toml skapad, legacy railway.json borttagen
- Vercel avvecklat: Railway är enda runtime, DNS via Cloudflare
- 14 felstavade discovery_configs-dubbletter borttagna (ÅÄÖ-problem)
- Enrichment scope-dokument levererat: diariesystem-lookup, $65 budget godkänd
- PoIT-research: bygglovskungörelser saknar sökande, diariesystem bekräftad som enda källa
- Kommunkartan spärrad för scraping — ingen ny import möjlig
