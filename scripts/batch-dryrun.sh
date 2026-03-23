#!/bin/bash
# Batch dry-run all configs with 0 data in DB
# Outputs: KOMMUN|PLATFORM|COUNT lines for configs that found data

cd /Users/tomasbackman/byggsignal

SCRAPER_MAP="sitevision:scrapers/scrape-sitevision.js
wordpress:scrapers/scrape-wordpress.js
netpublicator:scrapers/scrape-netpublicator.js
ciceron:scrapers/scrape-ciceron.js
pollux:scrapers/scrape-pollux.js
limepark:scrapers/scrape-limepark.js
meetingsplus:scrapers/scrape-meetingsplus.js"

get_scraper() {
  echo "$SCRAPER_MAP" | grep "^$1:" | cut -d: -f2
}

# All empty configs - platform|file pairs
CONFIGS=(
"sitevision|scrapers/configs/ale.json"
"sitevision|scrapers/configs/alvdalen.json"
"sitevision|scrapers/configs/aneby.json"
"sitevision|scrapers/configs/arboga.json"
"sitevision|scrapers/configs/are.json"
"sitevision|scrapers/configs/arvika.json"
"sitevision|scrapers/configs/berg.json"
"sitevision|scrapers/configs/bjurholm.json"
"sitevision|scrapers/configs/bjuv.json"
"sitevision|scrapers/configs/bollnas.json"
"sitevision|scrapers/configs/boxholm.json"
"sitevision|scrapers/configs/bracke.json"
"sitevision|scrapers/configs/eda.json"
"sitevision|scrapers/configs/eskilstuna.json"
"sitevision|scrapers/configs/essunga.json"
"sitevision|scrapers/configs/fagersta.json"
"sitevision|scrapers/configs/filipstad.json"
"sitevision|scrapers/configs/finspang.json"
"sitevision|scrapers/configs/forshaga.json"
"sitevision|scrapers/configs/gallivare.json"
"sitevision|scrapers/configs/gislaved.json"
"sitevision|scrapers/configs/gnesta.json"
"sitevision|scrapers/configs/gnosjo.json"
"sitevision|scrapers/configs/gotene.json"
"sitevision|scrapers/configs/grastorp.json"
"sitevision|scrapers/configs/grums.json"
"sitevision|scrapers/configs/gullspang.json"
"sitevision|scrapers/configs/hagfors.json"
"sitevision|scrapers/configs/hallsberg.json"
"sitevision|scrapers/configs/harnosand.json"
"sitevision|scrapers/configs/heby.json"
"sitevision|scrapers/configs/hellefors.json"
"sitevision|scrapers/configs/herjedalen.json"
"sitevision|scrapers/configs/herrljunga.json"
"sitevision|scrapers/configs/hjo.json"
"sitevision|scrapers/configs/hofors.json"
"sitevision|scrapers/configs/hudiksvall.json"
"sitevision|scrapers/configs/hylte.json"
"sitevision|scrapers/configs/jokkmokk.json"
"sitevision|scrapers/configs/kalix.json"
"sitevision|scrapers/configs/kalmar.json"
"sitevision|scrapers/configs/karlsborg.json"
"sitevision|scrapers/configs/karlskoga.json"
"sitevision|scrapers/configs/kil.json"
"sitevision|scrapers/configs/kiruna.json"
"sitevision|scrapers/configs/kramfors.json"
"sitevision|scrapers/configs/krokom.json"
"sitevision|scrapers/configs/kumla.json"
"sitevision|scrapers/configs/kungalv.json"
"sitevision|scrapers/configs/laholm.json"
"sitevision|scrapers/configs/landskrona.json"
"sitevision|scrapers/configs/lekeberg.json"
"sitevision|scrapers/configs/lerum.json"
"sitevision|scrapers/configs/lessebo.json"
"sitevision|scrapers/configs/lidkoping.json"
"sitevision|scrapers/configs/lilla-edet.json"
"sitevision|scrapers/configs/ljusnarsberg.json"
"sitevision|scrapers/configs/lulea.json"
"sitevision|scrapers/configs/mjolby.json"
"sitevision|scrapers/configs/molndal.json"
"sitevision|scrapers/configs/mora.json"
"sitevision|scrapers/configs/mullsjo.json"
"sitevision|scrapers/configs/munkedal.json"
"sitevision|scrapers/configs/nora.json"
"sitevision|scrapers/configs/nordmaling.json"
"sitevision|scrapers/configs/ockero.json"
"sitevision|scrapers/configs/olofstrom.json"
"sitevision|scrapers/configs/orkelljunga.json"
"sitevision|scrapers/configs/ornskoldsvik.json"
"sitevision|scrapers/configs/osby.json"
"sitevision|scrapers/configs/ostersund.json"
"sitevision|scrapers/configs/osthammar.json"
"sitevision|scrapers/configs/ostra-goinge.json"
"sitevision|scrapers/configs/ovanaker.json"
"sitevision|scrapers/configs/overkalix.json"
"sitevision|scrapers/configs/ragunda.json"
"sitevision|scrapers/configs/savsjo.json"
"sitevision|scrapers/configs/skara.json"
"sitevision|scrapers/configs/skurup.json"
"sitevision|scrapers/configs/smedjebacken.json"
"sitevision|scrapers/configs/soderhamn.json"
"sitevision|scrapers/configs/soderkoping.json"
"sitevision|scrapers/configs/solvesborg.json"
"sitevision|scrapers/configs/sotenas.json"
"sitevision|scrapers/configs/storfors.json"
"sitevision|scrapers/configs/surahammar.json"
"sitevision|scrapers/configs/svedala.json"
"sitevision|scrapers/configs/svenljunga.json"
"sitevision|scrapers/configs/tanum.json"
"sitevision|scrapers/configs/tibro.json"
"sitevision|scrapers/configs/tidaholm.json"
"sitevision|scrapers/configs/tierp.json"
"sitevision|scrapers/configs/timra.json"
"sitevision|scrapers/configs/tjorn.json"
"sitevision|scrapers/configs/toreboda.json"
"sitevision|scrapers/configs/torsby.json"
"sitevision|scrapers/configs/tranemo.json"
"sitevision|scrapers/configs/trollhattan.json"
"sitevision|scrapers/configs/ulricehamn.json"
"sitevision|scrapers/configs/vara.json"
"sitevision|scrapers/configs/vargarda.json"
"sitevision|scrapers/configs/varnamo.json"
"sitevision|scrapers/configs/vastervik.json"
"sitevision|scrapers/configs/vaxjo.json"
"sitevision|scrapers/configs/vetlanda.json"
"sitevision|scrapers/configs/ydre.json"
"ciceron|scrapers/configs/ciceron/amal.json"
"ciceron|scrapers/configs/ciceron/angelholm.json"
"ciceron|scrapers/configs/ciceron/boden.json"
"ciceron|scrapers/configs/ciceron/degerfors.json"
"ciceron|scrapers/configs/ciceron/falkoping.json"
"ciceron|scrapers/configs/ciceron/haparanda.json"
"ciceron|scrapers/configs/ciceron/kungsbacka.json"
"ciceron|scrapers/configs/ciceron/linkoping.json"
"ciceron|scrapers/configs/ciceron/ljusdal.json"
"ciceron|scrapers/configs/ciceron/robertsfors.json"
"ciceron|scrapers/configs/ciceron/svalov.json"
"ciceron|scrapers/configs/ciceron/torsas.json"
"ciceron|scrapers/configs/ciceron/vansbro.json"
"limepark|scrapers/configs/limepark/kristianstad.json"
"limepark|scrapers/configs/limepark/vindeln.json"
"meetingsplus|scrapers/configs/meetingsplus/ange.json"
"meetingsplus|scrapers/configs/meetingsplus/danderyd.json"
"netpublicator|scrapers/configs/netpublicator/arjang.json"
"netpublicator|scrapers/configs/netpublicator/astorp.json"
"netpublicator|scrapers/configs/netpublicator/atvidaberg.json"
"netpublicator|scrapers/configs/netpublicator/borlange.json"
"netpublicator|scrapers/configs/netpublicator/bromolla.json"
"netpublicator|scrapers/configs/netpublicator/hallstahammar.json"
"netpublicator|scrapers/configs/netpublicator/hammaro.json"
"netpublicator|scrapers/configs/netpublicator/hultsfred.json"
"netpublicator|scrapers/configs/netpublicator/karlskrona.json"
"netpublicator|scrapers/configs/netpublicator/karlstad.json"
"netpublicator|scrapers/configs/netpublicator/kinda.json"
"netpublicator|scrapers/configs/netpublicator/kristinehamn.json"
"netpublicator|scrapers/configs/netpublicator/odeshog.json"
"netpublicator|scrapers/configs/netpublicator/vimmerby.json"
"pollux|scrapers/configs/pollux/flen.json"
"pollux|scrapers/configs/pollux/hoganas.json"
"pollux|scrapers/configs/pollux/vanersborg.json"
"wordpress|scrapers/configs/wordpress/alingsas.json"
"wordpress|scrapers/configs/wordpress/alvesta.json"
"wordpress|scrapers/configs/wordpress/arjeplog.json"
"wordpress|scrapers/configs/wordpress/borgholm.json"
"wordpress|scrapers/configs/wordpress/eslov.json"
"wordpress|scrapers/configs/wordpress/gagnef.json"
"wordpress|scrapers/configs/wordpress/gavle.json"
"wordpress|scrapers/configs/wordpress/helsingborg.json"
"wordpress|scrapers/configs/wordpress/hoor.json"
"wordpress|scrapers/configs/wordpress/horby.json"
"wordpress|scrapers/configs/wordpress/monsteras.json"
"wordpress|scrapers/configs/wordpress/morbylanga.json"
"wordpress|scrapers/configs/wordpress/motala.json"
"wordpress|scrapers/configs/wordpress/munkfors.json"
"wordpress|scrapers/configs/wordpress/nybro.json"
"wordpress|scrapers/configs/wordpress/overtornea.json"
"wordpress|scrapers/configs/wordpress/skinnskatteberg.json"
"wordpress|scrapers/configs/wordpress/staffanstorp.json"
"wordpress|scrapers/configs/wordpress/vadstena.json"
"wordpress|scrapers/configs/wordpress/valdemarsvik.json"
)

RESULTS_FILE="/tmp/dryrun-results.txt"
> "$RESULTS_FILE"

TOTAL=${#CONFIGS[@]}
SUCCESS=0
FAILED=0
I=0

for entry in "${CONFIGS[@]}"; do
  I=$((I + 1))
  PLATFORM=$(echo "$entry" | cut -d'|' -f1)
  CONFIG_FILE=$(echo "$entry" | cut -d'|' -f2)
  KOMMUN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8')).kommun)" 2>/dev/null)
  SCRAPER=$(get_scraper "$PLATFORM")

  echo "[$I/$TOTAL] Dry-run: $KOMMUN ($PLATFORM)..." >&2

  # Run with 30s timeout, capture both stdout and stderr
  OUTPUT=$(timeout 30 node "$SCRAPER" --dry-run --config "$CONFIG_FILE" 2>&1) || true

  # Count permits found - look for JSON output or "permits" count in output
  COUNT=$(echo "$OUTPUT" | grep -oE '[0-9]+ (permit|ärende|bygglov|poster)' | head -1 | grep -oE '^[0-9]+' || true)

  # Also try counting JSON array items or "Dry-run" lines
  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    COUNT=$(echo "$OUTPUT" | grep -c '"diarienummer"' || true)
  fi

  if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ] 2>/dev/null; then
    echo "FOUND|$KOMMUN|$PLATFORM|$COUNT|$CONFIG_FILE" >> "$RESULTS_FILE"
    echo "  ✓ Found $COUNT permits!" >&2
    SUCCESS=$((SUCCESS + 1))
  else
    echo "EMPTY|$KOMMUN|$PLATFORM|0|$CONFIG_FILE" >> "$RESULTS_FILE"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=== DRY-RUN RESULTS ==="
echo "Total configs tested: $TOTAL"
echo "Found data: $SUCCESS"
echo "Still empty: $FAILED"
echo ""
echo "=== CONFIGS WITH DATA ==="
grep "^FOUND" "$RESULTS_FILE" | sort -t'|' -k4 -rn || echo "(none)"
