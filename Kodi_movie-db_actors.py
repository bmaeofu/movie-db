#!/bin/bash

set -euo pipefail

# ============================================================
# movie-db Schauspieler-Foto-Ergänzung aus Kodi
# Importiert fehlende Schauspieler-Fotos (actors-Tabelle) aus
# der Kodi-art-Tabelle (smb → /media, bzw. http-URL).
# ============================================================

# --- Konfiguration ---
APP="http://192.168.178.75:11000"
USER="OMP"
PASS="ohmypi"

# Log-Datei (persistenter Datenträger der App)
LOG_DIR="/mnt/user/appdata/movie-db/logs"
LOG_FILE="$LOG_DIR/kodi-actors.log"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COOKIE="$TMP/cookie.txt"

echo "=========================================="
echo " movie-db Schauspieler-Foto-Ergänzung"
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

# --- 2) Actor-Ergänzung auslösen (Streaming) ---
echo "Starte Schauspieler-Ergänzung ..."
mkdir -p "$LOG_DIR"
echo "=== $APP/api/admin/enrich-actors @ $(date '+%F %T') ===" >> "$LOG_FILE"
curl -N -s -b "$COOKIE" \
    -X POST "$APP/api/admin/enrich-actors" \
    -H "Content-Type: application/json" \
    -d "{}" \
    | tee -a "$LOG_FILE"
echo
echo "Log: $LOG_FILE"
