#!/bin/bash

set -euo pipefail

# ============================================================
# movie-db Daten-Ergänzung aus TMDB/OMDb
# Füllt fehlende Felder (Jahr, Poster, Overview, Land, Regie,
# Autoren, Cast, Ratings, Laufzeit) – ohne vorhandene
# Kodi-Werte zu überschreiben.
# Soll NACH dem Kodi-Sync laufen.
# ============================================================

# --- Konfiguration ---
APP="http://192.168.178.75:11000"
USER="OMP"
PASS="ohmypi"

# OMDb-Freitier: 1000 Anfragen/Tag.
# Über den Wert wird gesteuert, wie viele IMDb-Werte pro Lauf
# über OMDb nachgezogen werden. Empfehlung: 900.
OMDB_LIMIT=900

# Log-Datei (persistenter Datenträger der App)
LOG_DIR="/mnt/user/appdata/movie-db/logs"
LOG_FILE="$LOG_DIR/kodi-enrich.log"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COOKIE="$TMP/cookie.txt"

echo "=========================================="
echo " movie-db Daten-Ergänzung (TMDB/OMDb)"
echo "=========================================="

# --- 1) Login (Admin erforderlich) ---
HTTP_CODE="$(curl -s -c "$COOKIE" -o "$TMP/login.json" -w "%{http_code}" \
    -X POST "$APP/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$USER\",\"password\":\"$PASS\"}")"

if [ "$HTTP_CODE" != "200" ]; then
    echo "FEHLER: Login fehlgeschlagen (HTTP $HTTP_CODE)."
    cat "$TMP/login.json"
    exit 1
fi

# --- 2) Ergänzung auslösen ---
echo "Starte Ergänzung (OMDb-Limit $OMDB_LIMIT) ..."
RESP="$(curl -s -b "$COOKIE" \
    -X POST "$APP/api/admin/enrich?omdb_limit=$OMDB_LIMIT" \
    -H "Content-Type: application/json" \
    -d "{}")"
echo "$RESP"

# --- 3) Ergebnis loggen ---
mkdir -p "$LOG_DIR"
echo "$(date '+%F %T') $RESP" >> "$LOG_FILE"
echo
echo "Log: $LOG_FILE"
