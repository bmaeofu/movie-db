# Filmdatenbank – Design-Spec

**Datum:** 2026-08-04
**Status:** Genehmigt (Brainstorming abgeschlossen)

## 1. Ziel

Eine gemeinsame Filmdatenbank für Familie und Freunde: eine kuratierte Sammlung ausgewählter Filme und Serien, in der jeder Nutzer Bewertungen abgeben, den Watch-Status pflegen, Notizen schreiben und eigene Listen führen kann. Die App läuft als Docker-Container im Heimnetz.

## 2. Entscheidungen (aus dem Brainstorming)

| Thema | Entscheidung |
|---|---|
| Form | Web-App |
| Zweck | Gemeinsame Liste für Familie/Freunde |
| Dateneingabe | Suche über TMDB-API (kein manuelles Anlegen) |
| Features | Bewertungen, Watch-Status, Notizen, Suche & Filter, persönliche Listen |
| Auth | Login mit Passwort |
| Hosting | Docker-Container im Heimnetz |
| Stack | Node.js/TypeScript: Express-API + better-sqlite3 + React (Vite) |

## 3. Architektur

Ein einziger Docker-Container:

```
┌─────────────────────────────────────────────┐
│  Container "filmdatenbank"                  │
│                                             │
│  ┌──────────────┐   ┌───────────────────┐  │
│  │ React-Frontend│──▶│ Express-API      │  │
│  │ (Vite-Build) │   │ (TypeScript)     │  │
│  └──────────────┘   │                   │  │
│                     │  ┌─────────────┐  │  │
│                     │  │ SQLite-DB   │──┼──┼──▶ Volume
│                     │  │ (better-    │  │  │
│                     │  │  sqlite3)   │  │  │
│                     │  └─────────────┘  │  │
│                     │  ┌─────────────┐  │  │
│                     │  │ TMDB-Proxy  │──┼──┼──▶ api.themoviedb.org
│                     │  │ (+ Cache)   │  │  │
│                     │  └─────────────┘  │  │
│                     └───────────────────┘  │
└─────────────────────────────────────────────┘
```

- **Frontend:** React (Vite), statisch vom Express-Server ausgeliefert. Kein separater Webserver.
- **Backend:** Express + TypeScript. Auth über Session-Cookies, Passwörter bcrypt-gehasht.
- **Daten:** SQLite-Datei auf einem Docker-Volume; überlebt Container-Neustarts.
- **TMDB:** API-Key liegt nur im Container (`.env`). Suchen laufen über den Backend-Proxy; Treffer werden in SQLite gecacht.
- **Deployment:** `docker-compose.yml`, ein Service, Port 3000, `.env` mit `TMDB_API_KEY` und Admin-Passwort.

## 4. Datenmodell (SQLite)

```
users         id, name (unique), password_hash, is_admin (0/1)
movies        tmdb_id (PK), titel, jahr, medientyp ('film'|'serie'),
              genres (JSON-Array), poster_url, overview,
              tmdb_json (Roh-Cache), zuletzt_aktualisiert
collection    tmdb_id, added_by, added_at          -- gemeinsame Sammlung
ratings       user_id, tmdb_id, sterne (1–5),      -- PK (user_id, tmdb_id)
              updated_at
watch_status  user_id, tmdb_id, status,            -- PK (user_id, tmdb_id)
              status IN ('schauen','gesehen','kein_interesse')
notes         user_id, tmdb_id, text, updated_at   -- PK (user_id, tmdb_id)
lists         id, owner_id, name
list_items    list_id, tmdb_id                     -- PK (list_id, tmdb_id)
```

Regeln:
- Film-Metadaten sind global (ein `movies`-Eintrag pro TMDB-Film); Nutzerdaten (Bewertung, Status, Notiz) sind pro Nutzer.
- Der erste angelegte Nutzer wird Admin; Admins legen weitere Nutzer an (Name + Passwort).
- Fremdschlüssel mit `ON DELETE CASCADE` für ratings/watch_status/notes/list_items.
- `collection.added_by`: nullable + `ON DELETE SET NULL` (Filme bleiben bei User-Löschung erhalten).

## 5. API

| Endpoint | Methode | Zweck |
|---|---|---|
| `/api/auth/register` | POST | Nutzer anlegen. Bootstrap: Existiert noch kein Nutzer, wird der erste registrierte Nutzer automatisch Admin; danach nur mit Admin-Session erlaubt |
| `/api/auth/login` / `/api/auth/logout` | POST | Session starten/beenden |
| `/api/auth/me` | GET | Aktueller Nutzer (für Session-Validierung) |
| `/api/search?q=…` | GET | TMDB-Suche via Proxy, Treffer gecacht |
| `/api/collection` | GET | Alle Filme der Sammlung inkl. Filter |
| `/api/collection` | POST | `{tmdb_id}` zur Sammlung hinzufügen |
| `/api/collection/:tmdbId` | DELETE | Aus Sammlung entfernen (Admin oder Ersteller) |
| `/api/movies/:tmdbId/rating` | PUT | Eigene Bewertung setzen (1–5, UPSERT) |
| `/api/movies/:tmdbId/watch-status` | PUT | Eigenen Status setzen |
| `/api/movies/:tmdbId/note` | PUT / DELETE | Eigene Notiz setzen/löschen |
| `/api/lists` | GET / POST | Eigene Listen auflisten/anlegen |
| `/api/lists/:id` | PUT / DELETE | Liste umbenennen/löschen (nur Besitzer) |
| `/api/lists/:id/items` | POST / DELETE | Film zur Liste hinzufügen/entfernen (nur Besitzer) |

Filter auf `GET /api/collection`: `q` (Textsuche), `genre`, `medientyp`, `status` (eigener Status), `sort` (`titel` | `jahr` | `bewertung` | `zuletzt_hinzugefuegt`). Antwort enthält pro Film: Metadaten, Durchschnittsbewertung, Anzahl Bewertungen, eigene Bewertung/Status/Notiz, Zugehörigkeit zu eigenen Listen.

## 6. Fehlerbehandlung

- **TMDB offline:** Fehlermeldung im UI; Treffer aus dem Cache als Fallback anbieten. Bei Rate-Limit (HTTP 429) automatisch warten (Retry mit Backoff) und erneut versuchen.
- **Fehlender `TMDB_API_KEY`:** App startet nicht, klare Fehlermeldung in der Konsole.
- **Doppelte Bewertung:** UPSERT (`INSERT … ON CONFLICT DO UPDATE`) statt Fehler.
- **Sessions:** laufen nach 30 Tagen ab; Cookie `HttpOnly` + `SameSite=Lax`.
- **Berechtigungen:** Nutzerdaten (Bewertung/Status/Notiz) nur vom Besitzer änderbar; Listen nur vom Besitzer; Sammlungs-Einträge vom Admin oder Ersteller entfernbar.

## 7. Testing

- **Backend-Unit-/Integrationstests:** Vitest + supertest – Auth (Login/Logout/Admin), Bewertungs-UPSERT, Filter-Logik, Berechtigungsgrenzen.
- **End-to-End-Smoke-Test:** Playwright – Login → Suche → Film zur Sammlung hinzufügen → bewerten → Filter anwenden → ausloggen.
- **Manueller Abnahmetest:** Browser gegen den laufenden Container.

## 8. Nicht-Ziele (bewusst weggelassen)

- Keine öffentliche Erreichbarkeit (nur Heimnetz).
- Kein OAuth, keine E-Mail-Verifikation, keine Passwort-Reset-Funktion (Admin setzt Passwort neu).
- Keine Empfehlungen, keine Algorithmen, keine Streaming-Anbindung.
- Keine Uploads/Bilder außer TMDB-Postern.
