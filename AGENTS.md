# AGENTS.md – Filmdatenbank (movie-db)

Gemeinsame Filmdatenbank für Familie/Freunde im Heimnetz: kuratierte Sammlung (TMDB-Suche + manuelle Einträge), TMDB-/IMDb-Wert, persönliche Listen, Filter/Facetten. Läuft als Container im Stack der Hauptanwendung **Avior-Mediamanagement**; deren Anmeldung (lokal oder OIDC/authentik) ist die einzige, es gibt hier keinen Login. Bewertung, Watch-Status und Notizen gehören dem Konto und liegen in der Hauptanwendung.

## Stack & Struktur

- **npm workspaces:** Root (`package.json`), `server/` (Express + better-sqlite3, TypeScript strict, ESM/NodeNext – Importe brauchen `.js`-Endung), `client/` (React 18 + Vite + react-router-dom 6).
- **Datenbank:** SQLite über better-sqlite3 (synchron), `WAL`, `foreign_keys = ON`. Schema in `server/src/db.ts` (`initSchema` + `ensureColumn`-Migrationen für Bestands-DBs).
- **DI-Design:** `createDb(dbPath)`, `createTmdbClient({apiKey})`, `createOmdbClient({apiKey})`, `createApp(db, tmdb, {clientDistDir, omdb})` – Tests bauen Fakes für TMDB/OMDb.

## Kern-Konventionen

- **UI- und Fehlertexte auf Deutsch** (API-Fehler immer JSON `{ "error": string }`; Erfolg ohne Body → 204).
- **Commit messages in English**, convention from recent commits: `feat:`, `fix:`, `test:`, `docs:`, `build:`, `chore:`.
- **TDD:** Tests zuerst (`npm run test -w server`), dann Implementierung. Neuer Code ohne `any` und ohne Inline-Casts (`as { … }` direkt am Zugriff) – Projekt-Regeln (ts-no-any, ts-no-inline-cast-access, ts-set-map) gelten verbindlich.
- **Git identity:** commits use the repository's configured identity (`git config user.name` / `user.email`) — do not override the author per commit.

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

- **movies:** `tmdb_id` (PK; **Custom-Einträge = negative IDs**), `titel, jahr, medientyp('film'|'serie'), genres, poster_url, overview, land, regisseure, autoren, "cast" (JSON: {name, rolle}), tmdb_bewertung, tmdb_stimmen, imdb_bewertung, source('user'|'kodi'), tmdb_json, datei_pfade` (JSON: `/media/…`-Pfade der Mediendateien; vom Kodi-Sync gefüllt, mehrere pro Film möglich).
- **users:** nur noch Besitz-Marker für `lists.owner_id` und `collection.added_by`; `password_hash` steht auf `'!'`. Angelegt/verknüpft wird ein Datensatz beim ersten Aufruf über `ensureUser()` (`server/src/users.ts`): stabil über `oidc_sub` (Kopfzeile `x-user-id`), sonst über gleichen Namen oder gleichen Teil der E-Mail-Adresse vor dem @. `is_admin` folgt bei jedem Aufruf der Gruppe `ADMIN_GROUP`.
- **Marken (Bewertung, Watch-Status, Notiz):** liegen NICHT mehr hier, sondern in der Hauptanwendung (`movie_user_data`: `username, tmdb_id, rating 1–5, status neu|schauen|gesehen|kein_interesse, note`). Diese App kennt nur `tmdb_id`; die Marken kommen per `GET /api/me/user-data` der Hauptanwendung und werden im Client zusammengeführt (`client/src/userdata.ts`).
- **FK-Kaskaden:** `lists`/`list_items` löschen mit dem User; `collection.added_by` → nullable + SET NULL.

## SQLite-Gotchas

- **`cast` ist ein SQL-Schlüsselwort** – die Spalte heißt `"cast"` und MUSS in SQL immer gequotet werden (`m."cast"`, `"cast" = …`); in JS-Objektzugriffen (`movie.cast`) normal.
- `initSchema` löscht die alten Marken-Tabellen (`ratings`, `watch_status`, `notes`) und `sessions`; neue Spalten kommen über `ensureColumn`, `users.oidc_sub` hat einen Unique-Index (mehrere `NULL` sind erlaubt).
- JSON-Spalten werden per `LIKE '%…%'` gefiltert (Facetten/Filter); `json_group_array` für Listen-IDs.

## API-Routen (Auswahl)

- `/api/auth/status` und `/api/auth/me` (nur noch Abfragen; kein Login, keine Nutzerverwaltung)
- Jede Anfrage braucht die Kopfzeilen `x-user-id`, `x-user-name`, `x-user-email`, `x-user-groups` (vom Proxy der Hauptanwendung); ohne `x-user-id` → 401
- `/api/admin/backfill` (Admin; `?force=1` = alle, `?omdb_limit=N` begrenzt OMDb-Aufrufe/Tag; reichert land/regisseure/autoren/cast/Bewertungen nach)
- `/api/collection` (GET mit Filtern: `q, text, genre, land, regisseur, jahr, tmdb_min, imdb_min, medientyp, sort`; Marken-Filter kommen als `ids`/`exclude_ids` und die Sortierung `bewertung` als `order_ids` vom Proxy, der sie aus den Marken der Hauptanwendung berechnet; POST mit `{tmdb_id, medientyp, source?, tmdb_bewertung?, imdb_bewertung?}` + `?skip_omdb=1`; POST `/custom` für manuelle Einträge; GET `/facets` → `{laender, regisseure, jahre}`)
- `/api/movies/:tmdbId/play` (Wiedergabe-URLs aus `datei_pfade`; ohne gespeicherten Pfad Live-Abfrage der Kodi-DB; Ziele/Templates in `server/src/playback.ts`)

## Deployment (unRAID + Komodo)

- Deployment ist jetzt Teil des Stacks der Hauptanwendung: `compose.yaml` dort baut `./vendor/movie-db` als Submodule, Env `TMDB_API_KEY`, `OMDB_API_KEY`, `ADMIN_GROUP`, `MEDIA_DIR`, Bind-Mount `/mnt/user/appdata/avior_mediamanagement/movie-db:/data`, kein Host-Port (`expose 3000`); erreichbar nur über den Proxy unter `/movie-db/`. Das eigene `compose.yaml` dieses Repos bleibt für Standalone-Läufe.
- `index.ts`: `TMDB_API_KEY` Pflicht (sonst exit 1); `OMDB_API_KEY` optional (nur damit läuft der OMDb-Client für IMDb-Werte).
- Komodo-Stacks: Env-Variablen in den Stack-Einstellungen (nicht in .env); nach `git push` → Pull & Deploy.
- Bekannte Fallen: „Resource is busy" beim Rebuild → `docker stop movie-db && docker rm movie-db`, dann `docker compose up -d --build --force-recreate`.

## OMDb-Budget

OMDb-Free-Tier: **1000 Anfragen/Tag**. Deshalb: Adds mit `?skip_omdb=1` bei Massen-Importen, Backfills mit `?omdb_limit=900` über mehrere Tage; IMDb-Werte kommen alternativ aus der Kodi-MySQL-DB (siehe Scratch).

## Kodi-Import (Kontext)

- Kodi-Bibliothek liegt in **MySQL `MyVideos131` auf 192.168.178.75:3306** (root/kodi-db, Heimnetz) – Filme/uniqueid/rating-Tabellen; Dedupe über imdb_id/tmdb_id (gleiche Filme mehrfach in verschiedenen Ordnern möglich).
- Import-Skripte und Snapshot (`.superpowers/sdd/*`) sind gitignorierter Scratch (nicht committen!).
- Import läuft über `POST /api/collection` mit `source:"kodi"` + Bewertungs-Override + `?skip_omdb=1`.

- **Synchronisationsregel:** Ein movie-db-Eintrag darf ohne Gegenstück in der Kodi-Datenbank existieren, wenn `source != "kodi"` (z. B. manuell/TMDB-kuratiert). Ein Eintrag mit `source = "kodi"` muss dagegen einem aktuell vorhandenen Kodi-Film entsprechen; verwaiste `source="kodi"`-Einträge sind zu prüfen und zu bereinigen.

## Verifikation

- Backend: `npm test` (aktuell 63 Tests) + `npx tsc -p server/tsconfig.json --noEmit`.
- Frontend: `npm run build -w client`.
- Live-Check gegen die laufende App: `http://192.168.178.75:10015/movie-db/` (Anmeldung über Avior-Mediamanagement).
