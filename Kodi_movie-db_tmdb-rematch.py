#!/bin/bash

set -euo pipefail

# ============================================================
# movie-db: Filme mit erloschener TMDB-ID neu zuordnen
#
# Läuft NACH dem Enrich (der setzt movies.tmdb_fehler = '404').
# 1) meldet die Neusuche ins Log (Vorschläge, unklare Fälle, Fundstellen)
# 2) wendet automatisch nur die sicheren Namensraum-Fixes an:
#    gleiche ID, nur der Typ war falsch (Film statt Serie) – Kodi bleibt unberührt
# 3) ID-Umzüge werden bewusst NICHT automatisch angewendet:
#    dabei müssen Kodi-NFO und Kodi-`uniqueid` mitgezogen werden (Handarbeit
#    über den Button "Vorschläge anwenden" in der Wartung).
#
# Aufruf:  Kodi_movie-db_tmdb-rematch.py [--dry]
#          --dry meldet nur, ohne etwas zu ändern
# ============================================================

# --- Konfiguration ---
APP="${APP:-http://192.168.178.75:11000}"
USER="${USER:-OMP}"
PASS="${PASS:-ohmypi}"

# LOG_DIR lässt sich für lokale Testläufe überschreiben
LOG_DIR="${LOG_DIR:-/mnt/user/appdata/movie-db/logs}"
LOG_FILE="$LOG_DIR/tmdb-rematch.log"

DRY=0
if [ "${1:-}" = "--dry" ]; then DRY=1; fi

# unRAID liefert python3; lokal heißt das Binary teils nur python
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
    echo "FEHLER: python3 nicht gefunden."
    exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COOKIE="$TMP/cookie.txt"

echo "=========================================="
echo " movie-db TMDB-Neusuche (404er prüfen)"
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

# --- 2) Bericht holen ---
HTTP_CODE="$(curl -s -b "$COOKIE" -o "$TMP/bericht.json" -w "%{http_code}" \
    "$APP/api/admin/tmdb-rematch")"

if [ "$HTTP_CODE" != "200" ]; then
    echo "FEHLER: Neusuche fehlgeschlagen (HTTP $HTTP_CODE)."
    cat "$TMP/bericht.json"
    exit 1
fi

"$PY" - "$TMP/bericht.json" "$TMP/medientyp" <<'PY'
import json
import sys

bericht = json.load(open(sys.argv[1], encoding="utf-8"))
namensraum = [v for v in bericht["vorschlaege"] if v["art"] == "medientyp"]
umzuege = [v for v in bericht["vorschlaege"] if v["art"] == "id"]

print(f"geprüft: {bericht['geprüft']} | Vorschläge: {len(bericht['vorschlaege'])}"
      f" | unklar: {len(bericht['unklar'])} | ohne Treffer: {len(bericht['nichts'])}")
for v in namensraum:
    print(f"  Namensraum: {v['alt']} „{v['titel']}“ ({v['jahr']}) → {v['medientyp']}")
for v in umzuege:
    print(f"  Umzug: {v['alt']} → {v['neu']} „{v['titel']}“ ({v['jahr']}) — manuell, Kodi mitziehen")
for u in bericht["unklar"]:
    kandidaten = ", ".join(f"{k['medientyp']} {k['id']}" for k in u["kandidaten"])
    print(f"  unklar: {u['tmdb_id']} „{u['titel']}“ — {kandidaten}")

with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write(str(len(namensraum)))
PY

MEDIENTYP="$(cat "$TMP/medientyp")"
echo "Namensraum-Fixes: $MEDIENTYP | Umzüge bleiben manuell | Log: $LOG_FILE"

# --- 3) Sichere Fixes anwenden ---
mkdir -p "$LOG_DIR"
{
    echo "=== $APP/api/admin/tmdb-rematch @ $(date '+%F %T') ==="
    cat "$TMP/bericht.json"
    echo
} >> "$LOG_FILE"

if [ "$DRY" = "1" ]; then
    echo "Dry-Run: keine Änderung."
    exit 0
fi

if [ "$MEDIENTYP" = "0" ]; then
    echo "Nichts automatisch zu ändern."
    exit 0
fi

HTTP_CODE="$(curl -s -b "$COOKIE" -o "$TMP/ergebnis.json" -w "%{http_code}" \
    -X POST "$APP/api/admin/tmdb-rematch" \
    -H "Content-Type: application/json" \
    -d '{"nur_medientyp":true}')"

if [ "$HTTP_CODE" != "200" ]; then
    echo "FEHLER: Anwenden fehlgeschlagen (HTTP $HTTP_CODE)."
    cat "$TMP/ergebnis.json"
    exit 1
fi

"$PY" - "$TMP/ergebnis.json" <<'PY'
import json
import sys

ergebnis = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"angewendet: {len(ergebnis['typ_geaendert'])} Namensraum-Fixes"
      f" | Umzüge: {len(ergebnis['merges'])} | übersprungen: {len(ergebnis['uebersprungen'])}")
PY
