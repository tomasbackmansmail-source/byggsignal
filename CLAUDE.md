## Senast uppdaterat 2026-04-15

- RLS aktiverat på alla 16 tabeller i Supabase (permits_v2, procurements, municipalities, discovery_configs, profiles, agent_tasks, cpv_trade_mapping, discovery_runs, enrichment_boverket_pbe, enrichment_energideklarationer, enrichment_kolada, enrichment_planbestammelser, municipality_platforms, permits, privacy_requests, qc_runs)
- Policies: anon SELECT på permits_v2/procurements/municipalities, anon INSERT på privacy_requests, authenticated read/update own profile, service_role full access alla tabeller
- 14 felstavade discovery_configs-dubbletter borttagna (Finspang→Finspång, Kungsor→Kungsör, Mullsjo→Mullsjö, Nassjo→Nässjö, Rattvik→Rättvik, Stromsund→Strömsund, Timra→Timrå, Alvdalen→Älvdalen, Bollnas→Bollnäs, Borlange→Borlänge, Olofstrom→Olofström, Ostra Goinge→Östra Göinge, Soderhamn→Söderhamn, Vanersborg→Vänersborg)
- Session-deadlock fixad: setTimeout-dispatch i onAuthStateChange + noOp lock
- Stripe webhook fixad: STRIPE_SECRET_KEY env var i Railway
- Vercel avvecklat: Railway enda runtime, DNS via Cloudflare
- Status 2026-04-15: 9227 permits, 284/291 kommuner med data, 65 procurements, 3 profiler
