# Filmdatenbank

Gemeinsame Filmdatenbank für Familie und Freunde: kuratierte Sammlung (TMDB-Suche),
Bewertungen, Watch-Status, Notizen, Suche & Filter und persönliche Listen.
Läuft als Docker-Container im Heimnetz.

## Voraussetzungen

- Docker + Docker Compose
- Kostenloser TMDB-API-Key: <https://www.themoviedb.org/settings/api> (anmelden, Key anfordern)

## Setup (unRAID mit Komodo, empfohlen)

1. Repo auf den unRAID-Server übertragen oder direkt dort klonen.
2. In Komodo einen neuen **Compose-Stack** anlegen, der auf die `docker-compose.yml` dieses Repos zeigt.
3. Unter den Stack-Einstellungen die Env-Variable `TMDB_API_KEY` mit deinem Key setzen (Komodo-Einstellung „Environment“) – kein `.env`-File nötig. Der Key bleibt damit auf dem Server.
4. Stack starten (Komodo baut das Image und startet den Container).

Die App ist danach unter `http://<unraid-ip>:3000` erreichbar (in Komodo/Portainer einen Port-Forward auf Port 3000 des Containers setzen).

## Setup (alternativ, ohne Komodo)

```bash
cp .env.example .env
# TMDB_API_KEY in .env eintragen
docker compose up -d --build
```

## Erster Start

Beim ersten Aufruf wird der **erste Nutzer zum Admin** („Einrichtung starten").
Weitere Nutzer legt der Admin über „Nutzer anlegen" an.

## Entwicklung

```bash
npm install
# Windows PowerShell:
$env:TMDB_API_KEY="<key>"; npm run dev -w server   # Terminal 1
# Git Bash / Linux:
# TMDB_API_KEY=<key> npm run dev -w server
npm run dev -w client                               # Terminal 2
# Client: http://localhost:5173 (Proxy auf :3000)
```

## E2E-Smoke-Test

Der Playwright-Smoke (`e2e/`) braucht einen laufenden Server MIT echtem TMDB-Key (der Test durchsucht TMDB nach „Inception“):

```bash
cd e2e
npm install
npx playwright install chromium
BASE_URL=http://<server-ip>:3000 npx playwright test
```

Voraussetzung: frische Datenbank (Volume leeren oder neuen Stack mit frischem Volume starten).

## Daten & Backup

Die Datenbank liegt im Docker-Volume `fdb-data` (`/data/filmdatenbank.db`).
Backup: `docker compose cp filmdatenbank:/data/filmdatenbank.db ./backup.db`
