# Filmdatenbank

Gemeinsame Filmdatenbank für Familie und Freunde: kuratierte Sammlung (TMDB-Suche),
Bewertungen, Watch-Status, Notizen, Suche & Filter und persönliche Listen.
Läuft als Docker-Container im Heimnetz.

## Voraussetzungen

- Docker + Docker Compose
- Kostenloser TMDB-API-Key: <https://www.themoviedb.org/settings/api> (anmelden, Key anfordern)

## Setup

```bash
cp .env.example .env
# TMDB_API_KEY in .env eintragen
docker compose up -d --build
```

Die App ist danach unter `http://<heimnetz-ip>:3000` erreichbar.

## Erster Start

Beim ersten Aufruf wird der **erste Nutzer zum Admin** („Einrichtung starten").
Weitere Nutzer legt der Admin über „Nutzer anlegen" an.

## Entwicklung

```bash
npm install
TMDB_API_KEY=<key> npm run dev -w server   # Terminal 1
npm run dev -w client                       # Terminal 2
# Client: http://localhost:5173 (Proxy auf :3000)
```

## Tests

```bash
npm test            # Backend (Vitest + supertest)
# E2E-Smoke-Test: e2e/ Verzeichnis, Ausführung siehe Implementierungsplan Task 13
```

## Daten & Backup

Die Datenbank liegt im Docker-Volume `fdb-data` (`/data/filmdatenbank.db`).
Backup: `docker compose cp filmdatenbank:/data/filmdatenbank.db ./backup.db`
