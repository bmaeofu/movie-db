#!/bin/bash

set -euo pipefail

# ============================================================
# Kodi → movie-db Sync
# Ruft den serverseitigen Full-Sync auf. Der Server liest die
# Kodi-MySQL direkt, importiert fehlende Filme vollständig
# (ohne TMDB) mit source="kodi", added_at (Datum) und
# Watch-Status "neu" für alle Benutzer.
# ============================================================

# --- Konfiguration ---
APP="http://192.168.178.75:11000"
USER="OMP"
PASS="ohmypi"

# Log-Datei (persistenter Datenträger der App)
LOG_DIR="/mnt/user/appdata/movie-db/logs"
LOG_FILE="$LOG_DIR/kodi-sync.log"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COOKIE="$TMP/cookie.txt"

echo "=========================================="
echo " Kodi → movie-db Sync"
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

# --- 2) Serverseitigen Full-Sync auslösen ---
echo "Starte Kodi-Full-Sync ..."
RESP="$(curl -s -b "$COOKIE" \
    -X POST "$APP/api/admin/kodi-full-sync" \
    -H "Content-Type: application/json" \
    -d "{}")"
echo "$RESP"

# --- 3) Ergebnis loggen ---
mkdir -p "$LOG_DIR"
echo "$(date '+%F %T') $RESP" >> "$LOG_FILE"
echo
echo "Log: $LOG_FILE"
