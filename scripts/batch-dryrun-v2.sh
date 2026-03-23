#!/bin/bash
# Batch dry-run all configs with 0 data in DB
# Captures actual parseable permits count from output

cd /Users/tomasbackman/byggsignal

RESULTS_FILE="/tmp/dryrun-results-v2.txt"
> "$RESULTS_FILE"

run_config() {
  local PLATFORM="$1"
  local CONFIG_FILE="$2"
  local KOMMUN="$3"
  local SCRAPER=""

  case "$PLATFORM" in
    sitevision) SCRAPER="scrapers/scrape-sitevision.js" ;;
    wordpress) SCRAPER="scrapers/scrape-wordpress.js" ;;
    netpublicator) SCRAPER="scrapers/scrape-netpublicator.js" ;;
    ciceron) SCRAPER="scrapers/scrape-ciceron.js" ;;
    pollux) SCRAPER="scrapers/scrape-pollux.js" ;;
    limepark) SCRAPER="scrapers/scrape-limepark.js" ;;
    meetingsplus) SCRAPER="scrapers/scrape-meetingsplus.js" ;;
  esac

  OUTPUT=$(timeout 45 node "$SCRAPER" --dry-run --config "$CONFIG_FILE" 2>&1) || true

  # Extract parsed/permit count from various output formats
  # Ciceron: "X total, Y permits"
  # SiteVision: "X ärenden, Y lyckades parsas"
  # WordPress: "X permits found" or similar
  # Netpublicator: similar patterns

  local PARSED=0

  # Try ciceron format: "N permits"
  local P=$(echo "$OUTPUT" | grep -oE '[0-9]+ permits' | tail -1 | grep -oE '^[0-9]+')
  [ -n "$P" ] && PARSED=$P

  # Try sitevision format: "N lyckades parsas"
  if [ "$PARSED" -eq 0 ] 2>/dev/null; then
    P=$(echo "$OUTPUT" | grep -oE '[0-9]+ lyckades parsas' | grep -oE '^[0-9]+')
    [ -n "$P" ] && PARSED=$P
  fi

  # Try generic: count lines with diarienummer pattern (BN/DN/LOV followed by numbers)
  if [ "$PARSED" -eq 0 ] 2>/dev/null; then
    P=$(echo "$OUTPUT" | grep -cE '(BN|DN|LOV|SBN|MBN|BMN|BYN) [0-9]{4}-[0-9]+' || true)
    [ -n "$P" ] && PARSED=$P
  fi

  # Try: count "beviljat" or "startbesked" occurrences (typical status words)
  if [ "$PARSED" -eq 0 ] 2>/dev/null; then
    P=$(echo "$OUTPUT" | grep -cE 'beviljat|startbesked|Saved|saved' || true)
    [ -n "$P" ] && PARSED=$P
  fi

  echo "$KOMMUN|$PLATFORM|$PARSED|$CONFIG_FILE"

  if [ "$PARSED" -gt 0 ] 2>/dev/null; then
    echo "FOUND|$KOMMUN|$PLATFORM|$PARSED|$CONFIG_FILE" >> "$RESULTS_FILE"
    echo "  ✓ $KOMMUN: $PARSED permits found" >&2
  else
    echo "EMPTY|$KOMMUN|$PLATFORM|0|$CONFIG_FILE" >> "$RESULTS_FILE"
  fi
}

I=0
TOTAL=160

# Ciceron configs (most likely to find data based on Kungsbacka test)
for f in scrapers/configs/ciceron/*.json; do
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (ciceron)" >&2
  run_config ciceron "$f" "$KOMMUN"
done

# Netpublicator configs
for f in scrapers/configs/netpublicator/arjang.json scrapers/configs/netpublicator/astorp.json scrapers/configs/netpublicator/atvidaberg.json scrapers/configs/netpublicator/borlange.json scrapers/configs/netpublicator/bromolla.json scrapers/configs/netpublicator/hallstahammar.json scrapers/configs/netpublicator/hammaro.json scrapers/configs/netpublicator/hultsfred.json scrapers/configs/netpublicator/karlskrona.json scrapers/configs/netpublicator/karlstad.json scrapers/configs/netpublicator/kinda.json scrapers/configs/netpublicator/kristinehamn.json scrapers/configs/netpublicator/odeshog.json scrapers/configs/netpublicator/vimmerby.json; do
  [ -f "$f" ] || continue
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (netpublicator)" >&2
  run_config netpublicator "$f" "$KOMMUN"
done

# Pollux configs (without already-in-DB: mark is in DB via separate check)
for f in scrapers/configs/pollux/flen.json scrapers/configs/pollux/hoganas.json scrapers/configs/pollux/vanersborg.json; do
  [ -f "$f" ] || continue
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (pollux)" >&2
  run_config pollux "$f" "$KOMMUN"
done

# Limepark configs
for f in scrapers/configs/limepark/kristianstad.json scrapers/configs/limepark/vindeln.json; do
  [ -f "$f" ] || continue
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (limepark)" >&2
  run_config limepark "$f" "$KOMMUN"
done

# MeetingsPlus configs
for f in scrapers/configs/meetingsplus/ange.json scrapers/configs/meetingsplus/danderyd.json; do
  [ -f "$f" ] || continue
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (meetingsplus)" >&2
  run_config meetingsplus "$f" "$KOMMUN"
done

# WordPress configs (the ones with 0 data)
for f in scrapers/configs/wordpress/alingsas.json scrapers/configs/wordpress/alvesta.json scrapers/configs/wordpress/arjeplog.json scrapers/configs/wordpress/borgholm.json scrapers/configs/wordpress/eslov.json scrapers/configs/wordpress/gagnef.json scrapers/configs/wordpress/gavle.json scrapers/configs/wordpress/helsingborg.json scrapers/configs/wordpress/hoor.json scrapers/configs/wordpress/horby.json scrapers/configs/wordpress/monsteras.json scrapers/configs/wordpress/morbylanga.json scrapers/configs/wordpress/motala.json scrapers/configs/wordpress/munkfors.json scrapers/configs/wordpress/nybro.json scrapers/configs/wordpress/overtornea.json scrapers/configs/wordpress/skinnskatteberg.json scrapers/configs/wordpress/staffanstorp.json scrapers/configs/wordpress/vadstena.json scrapers/configs/wordpress/valdemarsvik.json; do
  [ -f "$f" ] || continue
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (wordpress)" >&2
  run_config wordpress "$f" "$KOMMUN"
done

# SiteVision configs (the bulk - 106 configs)
for f in scrapers/configs/ale.json scrapers/configs/alvdalen.json scrapers/configs/aneby.json scrapers/configs/arboga.json scrapers/configs/are.json scrapers/configs/arvika.json scrapers/configs/berg.json scrapers/configs/bjurholm.json scrapers/configs/bjuv.json scrapers/configs/bollnas.json scrapers/configs/boxholm.json scrapers/configs/bracke.json scrapers/configs/eda.json scrapers/configs/eskilstuna.json scrapers/configs/essunga.json scrapers/configs/fagersta.json scrapers/configs/filipstad.json scrapers/configs/finspang.json scrapers/configs/forshaga.json scrapers/configs/gallivare.json scrapers/configs/gislaved.json scrapers/configs/gnesta.json scrapers/configs/gnosjo.json scrapers/configs/gotene.json scrapers/configs/grastorp.json scrapers/configs/grums.json scrapers/configs/gullspang.json scrapers/configs/hagfors.json scrapers/configs/hallsberg.json scrapers/configs/harnosand.json scrapers/configs/heby.json scrapers/configs/hellefors.json scrapers/configs/herjedalen.json scrapers/configs/herrljunga.json scrapers/configs/hjo.json scrapers/configs/hofors.json scrapers/configs/hudiksvall.json scrapers/configs/hylte.json scrapers/configs/jokkmokk.json scrapers/configs/kalix.json scrapers/configs/kalmar.json scrapers/configs/karlsborg.json scrapers/configs/karlskoga.json scrapers/configs/kil.json scrapers/configs/kiruna.json scrapers/configs/kramfors.json scrapers/configs/krokom.json scrapers/configs/kumla.json scrapers/configs/kungalv.json scrapers/configs/laholm.json scrapers/configs/landskrona.json scrapers/configs/lekeberg.json scrapers/configs/lerum.json scrapers/configs/lessebo.json scrapers/configs/lidkoping.json scrapers/configs/lilla-edet.json scrapers/configs/ljusnarsberg.json scrapers/configs/lulea.json scrapers/configs/mjolby.json scrapers/configs/molndal.json scrapers/configs/mora.json scrapers/configs/mullsjo.json scrapers/configs/munkedal.json scrapers/configs/nora.json scrapers/configs/nordmaling.json scrapers/configs/ockero.json scrapers/configs/olofstrom.json scrapers/configs/orkelljunga.json scrapers/configs/ornskoldsvik.json scrapers/configs/osby.json scrapers/configs/ostersund.json scrapers/configs/osthammar.json scrapers/configs/ostra-goinge.json scrapers/configs/ovanaker.json scrapers/configs/overkalix.json scrapers/configs/ragunda.json scrapers/configs/savsjo.json scrapers/configs/skara.json scrapers/configs/skurup.json scrapers/configs/smedjebacken.json scrapers/configs/soderhamn.json scrapers/configs/soderkoping.json scrapers/configs/solvesborg.json scrapers/configs/sotenas.json scrapers/configs/storfors.json scrapers/configs/surahammar.json scrapers/configs/svedala.json scrapers/configs/svenljunga.json scrapers/configs/tanum.json scrapers/configs/tibro.json scrapers/configs/tidaholm.json scrapers/configs/tierp.json scrapers/configs/timra.json scrapers/configs/tjorn.json scrapers/configs/toreboda.json scrapers/configs/torsby.json scrapers/configs/tranemo.json scrapers/configs/trollhattan.json scrapers/configs/ulricehamn.json scrapers/configs/vara.json scrapers/configs/vargarda.json scrapers/configs/varnamo.json scrapers/configs/vastervik.json scrapers/configs/vaxjo.json scrapers/configs/vetlanda.json scrapers/configs/ydre.json; do
  [ -f "$f" ] || continue
  KOMMUN=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf-8')).kommun" 2>/dev/null)
  I=$((I+1)); echo "[$I/$TOTAL] $KOMMUN (sitevision)" >&2
  run_config sitevision "$f" "$KOMMUN"
done

echo "" >&2
echo "=== FINAL RESULTS ===" >&2
FOUND=$(grep -c "^FOUND" "$RESULTS_FILE" 2>/dev/null || echo 0)
EMPTY=$(grep -c "^EMPTY" "$RESULTS_FILE" 2>/dev/null || echo 0)
echo "Found data: $FOUND" >&2
echo "Still empty: $EMPTY" >&2
echo "" >&2
echo "=== CONFIGS WITH DATA ===" >&2
grep "^FOUND" "$RESULTS_FILE" | sort -t'|' -k4 -rn >&2 || echo "(none)" >&2

cat "$RESULTS_FILE"
