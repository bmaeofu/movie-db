# AGENTS.md – Filmdatenbank (movie-db)

Gemeinsame Filmdatenbank für Familie/Freunde im Heimnetz: kuratierte Sammlung (TMDB-Suche + manuelle Einträge), Bewertungen (App-Durchschnitt, TMDB-, IMDb-Wert), Watch-Status, Notizen, persönliche Listen, Filter/Facetten, Passwort-Login. Deployment als Docker-Container auf unRAID via Komodo.

## Stack & Struktur

- **npm workspaces:** Root (`package.json`), `server/` (Express + better-sqlite3, TypeScript strict, ESM/NodeNext – Importe brauchen `.js`-Endung), `client/` (React 18 + Vite + react-router-dom 6).
- **Datenbank:** SQLite über better-sqlite3 (synchron), `WAL`, `foreign_keys = ON`. Schema in `server/src/db.ts` (`initSchema` + `ensureColumn`-Migrationen für Bestands-DBs).
- **DI-Design:** `createDb(dbPath)`, `createTmdbClient({apiKey})`, `createOmdbClient({apiKey})`, `createApp(db, tmdb, {clientDistDir, omdb})` – Tests bauen Fakes für TMDB/OMDb.

## Kern-Konventionen

- **UI- und Fehlertexte auf Deutsch** (API-Fehler immer JSON `{ "error": string }`; Erfolg ohne Body → 204).
- **Commit-Messages auf Deutsch**, Konvention aus den letzten Commits: `feat:`, `fix:`, `test:`, `docs:`, `build:`, `chore:`.
- **TDD:** Tests zuerst (`npm run test -w server`), dann Implementierung. Neuer Code ohne `any` und ohne Inline-Casts (`as { … }` direkt am Zugriff) – Projekt-Regeln (ts-no-any, ts-no-inline-cast-access, ts-set-map) gelten verbindlich.
- **Git-Identity** (lokal nicht global gesetzt): `git -c user.name="omp" -c user.email="omp@local" commit -m "…"`.

## Commands

```bash
npm install
npm test                       # Vitest + supertest (Server)
npm run build -w server        # tsc → server/dist
npm run build -w client        # tsc --noEmit + vite → client/dist
npm run dev -w server          # tsx watch (braucht TMDB_API_KEY)
npm run dev -w client          # Vite :5173, Proxy /api → :3000
```

## Datenmodell (wichtig für Änderungen)

- **movies:** `tmdb_id` (PK; **Custom-Einträge = negative IDs**), `titel, jahr, medientyp('film'|'serie'), genres, poster_url, overview, land, regisseure, autoren, "cast" (JSON: {name, rolle}), tmdb_bewertung, tmdb_stimmen, imdb_bewertung, source('user'|'kodi'), tmdb_json`.
- **watch_status.status:** `'neu' | 'schauen' | 'gesehen' | 'kein_interesse'` – `'neu'` wird beim Hinzufügen eines Films automatisch für ALLE Benutzer gesetzt (`INSERT OR IGNORE`), bestehende Status bleiben.
- **users:** erster registrierter Nutzer = Admin; Admin kann User anlegen/umbenennen/Passwort zurücksetzen/löschen (Guards: letzter Admin unantastbar, kein Selbst-Löschen). Sessions in Tabelle `sessions` (Cookie `fdb_session`, HttpOnly, 30 Tage, Unix-Sekunden).
- **FK-Kaskaden:** ratings/watch_status/notes/sessions/lists löschen mit dem User; `collection.added_by` → nullable + SET NULL.

## SQLite-Gotchas

- **`cast` ist ein SQL-Schlüsselwort** – die Spalte heißt `"cast"` und MUSS in SQL immer gequotet werden (`m."cast"`, `"cast" = …`); in JS-Objektzugriffen (`movie.cast`) normal.
- CHECK-Constraints lassen sich nicht per `ALTER TABLE` ändern → Tabellen-Rebuild in `initSchema` (Muster: watch_status-'neu'-Migration).
- JSON-Spalten werden per `LIKE '%…%'` gefiltert (Facetten/Filter); `json_group_array` für Listen-IDs.

## API-Routen (Auswahl)

- `/api/auth/*` (status, register [Bootstrap→Admin], login, logout, me, **password**)
- `/api/users` (Admin: Liste, `PUT/DELETE /:id`)
- `/api/admin/backfill` (Admin; `?force=1` = alle, `?omdb_limit=N` begrenzt OMDb-Aufrufe/Tag; reichert land/regisseure/autoren/cast/Bewertungen nach)
- `/api/collection` (GET mit Filtern: `q, text, genre, land, regisseur, jahr, tmdb_min, imdb_min, medientyp, status, sort`; POST mit `{tmdb_id, medientyp, source?, tmdb_bewertung?, imdb_bewertung?}` + `?skip_omdb=1`; POST `/custom` für manuelle Einträge; GET `/facets` → `{laender, regisseure, jahre}`)
- `/api/movies/:tmdbId/{rating|watch-status|note}` (UPSERTs)

## Deployment (unRAID + Komodo)

- `compose.yaml`: Service/Container **`movie-db`**, Host-Port **8080** → Container 3000, Env `${TMDB_API_KEY}` + `${OMDB_API_KEY}`, Bind-Mount `/mnt/user/appdata/movie-db:/data` (DB-Datei liegt dort), `restart: unless-stopped`, Multi-Stage-Dockerfile (node:20-slim, `npm ci`, build → runtime `npm ci --omit=dev`, `WORKDIR /app/server`, `CMD node dist/index.js`).
- `index.ts`: `TMDB_API_KEY` Pflicht (sonst exit 1); `OMDB_API_KEY` optional (nur damit läuft der OMDb-Client für IMDb-Werte).
- Komodo-Stacks: Env-Variablen in den Stack-Einstellungen (nicht in .env); nach `git push` → Pull & Deploy.
- Bekannte Fallen: „Resource is busy" beim Rebuild → `docker stop movie-db && docker rm movie-db`, dann `docker compose up -d --build --force-recreate`.

## OMDb-Budget

OMDb-Free-Tier: **1000 Anfragen/Tag**. Deshalb: Adds mit `?skip_omdb=1` bei Massen-Importen, Backfills mit `?omdb_limit=900` über mehrere Tage; IMDb-Werte kommen alternativ aus der Kodi-MySQL-DB (siehe Scratch).

## Kodi-Import (Kontext)

- Kodi-Bibliothek liegt in **MySQL `MyVideos131` auf 192.168.178.75:3306** (root/kodi-db, Heimnetz) – Filme/uniqueid/rating-Tabellen; Dedupe über imdb_id/tmdb_id (gleiche Filme mehrfach in verschiedenen Ordnern möglich).
- Import-Skripte und Snapshot (`.superpowers/sdd/*`) sind gitignorierter Scratch (nicht committen!).
- Import läuft über `POST /api/collection` mit `source:"kodi"` + Bewertungs-Override + `?skip_omdb=1`.

## Verifikation

- Backend: `npm test` (aktuell 63 Tests) + `npx tsc -p server/tsconfig.json --noEmit`.
- Frontend: `npm run build -w client`.
- Live-Check gegen die laufende App: `http://192.168.178.75:8080/api/…` (Login z. B. roman / -none-).
