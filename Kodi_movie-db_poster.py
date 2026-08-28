#!/bin/bash

set -euo pipefail

# ============================================================
# movie-db Poster-Ergänzung aus Kodi
# Trägt fehlende Poster (poster_url IS NULL) für Kodi-Filme aus
# der Kodi-art-Tabelle nach (smb → /media).
# ============================================================

# --- Konfiguration ---
APP="http://192.168.178.75:11000"
USER="OMP"
PASS="ohmypi"

# Log-Datei (persistenter Datenträger der App)
LOG_DIR="/mnt/user/appdata/movie-db/logs"
LOG_FILE="$LOG_DIR/kodi-poster.log"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COOKIE="$TMP/cookie.txt"

echo "=========================================="
echo " movie-db Poster-Ergänzung (Kodi)"
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

# --- 2) Poster-Ergänzung auslösen (Streaming) ---
echo "Starte Poster-Ergänzung ..."
mkdir -p "$LOG_DIR"
echo "=== $APP/api/admin/enrich-posters @ $(date '+%F %T') ===" >> "$LOG_FILE"
curl -N -s -b "$COOKIE" \
    -X POST "$APP/api/admin/enrich-posters" \
    -H "Content-Type: application/json" \
    -d "{}" \
    | tee -a "$LOG_FILE"
echo
echo "Log: $LOG_FILE"
