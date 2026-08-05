# Final-Fix-Report

Branch `feature/filmdatenbank`, HEAD vor Fixes: `ccff15a`. Alle 5 Befunde aus dem Final-Review behoben; jeder Fix durch einen neuen Test abgesichert.

## FIX 1 (Merge-Blocker): Geister-Items in Listen nach Sammlungs-Entfernung

**Änderung:** `server/src/routes/listRoutes.ts` GET `/api/lists/:id` – `fromSql` für `listMovieViews` umgebaut von INNER-Joins (`FROM collection c JOIN list_items li … JOIN users u …`) auf `FROM list_items li LEFT JOIN collection c ON c.tmdb_id = li.tmdb_id LEFT JOIN users u ON u.id = c.added_by JOIN movies m ON m.tmdb_id = li.tmdb_id`, Sortierung `li.tmdb_id ASC`. list_items sind damit nicht mehr an eine collection-Zeile gebunden; `added_at`/`added_by_name` sind nach Entfernen aus der Sammlung `NULL`. Rest des SELECTs in `queries.ts` unverändert.

**Test:** `server/tests/lists.test.ts` → „Film bleibt in der Liste sichtbar, wenn er aus der Sammlung entfernt wird": Film (27205) in Liste, `DELETE /api/collection/27205` (als Ersteller, 204), `GET /api/lists/:id` → 200, `items` enthält den Film weiterhin (`tmdb_id` matcht, `added_by_name` null).

**Kommando/Output:**
```
npm run test -w server
 Test Files  7 passed (7)
      Tests  36 passed (36)
```

## FIX 2 (Important): parseCookies wirft URIError → 500 statt 401

**Änderung:** `server/src/middleware.ts` – `decodeURIComponent` in try/catch gekapselt; ungültige Prozent-Encodings werden ignoriert statt den Request zu sprengen.

**Test:** `server/tests/auth.test.ts` → „ungültiges Prozent-Encoding im Cookie → 401 statt 500": `GET /api/auth/me` mit `Cookie: fdb_session=%zz` → 401.

**Kommando/Output:**
```
npm run test -w server
 Test Files  7 passed (7)
      Tests  36 passed (36)
```

## FIX 3 (Important): Bewertung/Status/Notiz für unbekannte tmdb_id → 500 statt 404

**Änderung:** `server/src/routes/movieRoutes.ts` – in allen drei PUT-Handlern (`/:tmdbId/rating`, `/:tmdbId/watch-status`, `/:tmdbId/note`) direkt nach der tmdbId-Validierung: `SELECT 1 FROM movies WHERE tmdb_id = ?`; fehlt der Film → `404 { error: "Film nicht gefunden" }` (vorher FK-Constraint-Fehler → 500).

**Test:** `server/tests/movie.test.ts` → „Bewertung/Status/Notiz für unbekannte tmdb_id → 404": `PUT /api/movies/99999/{rating,watch-status,note}` → je 404.

**Kommando/Output:**
```
npm run test -w server
 Test Files  7 passed (7)
      Tests  36 passed (36)
```

## FIX 4 (Important): Detail-Modal zeigt nach Speichern veraltete Bewertung/Status

**Änderung:** `client/src/pages/CollectionPage.tsx` – `load()` speichert das Fetch-Ergebnis in `fresh` und aktualisiert neben `movies` auch `detail` (`setDetail((d) => (d ? fresh.find((m) => m.tmdb_id === d.tmdb_id) ?? d : null))`). Das offene Modal bekommt nach `onChanged` den frischen Film und zeigt sofort die neue Bewertung/Status/Notiz.

**Verifikation (kein UI-Test, laut Spec):**
```
npm run build -w client
✓ built in 647ms
```

## FIX 5 (Spec §6): Cache-Fallback bei TMDB-Ausfall

**Änderung:** `server/src/routes/searchRoutes.ts` GET `/` – `tmdb.search(q)` in try/catch; bei Fehler wird ein vorhandener Cache-Eintrag ohne TTL-Bedingung (`SELECT tmdb_json FROM search_cache WHERE query = ?`) ausgeliefert; nur ohne Cache-Eintrag wird der Fehler propagiert (`throw err` → 500). Hinweis: Das im Review-Snippet enthaltene nackte `throw;` ist kein gültiges JavaScript (SyntaxError) – ersetzt durch `catch (err)` + `throw err`.

**Test:** `server/tests/search.test.ts` → „Cache-Fallback: bei TMDB-Ausfall gecachte Ergebnisse, ohne Cache 500" (App mit `maxRetries: 0` für schnellen Fehlerpfad): (a) erste Suche füllt Cache (200, 2 Ergebnisse), (b) Mock auf `mockRejectedValue` umgestellt, (c) identische Suche → 200 mit exakt denselben Ergebnissen (Cache-Fallback, kein TMDB-Call), (d) Suche ohne Cache-Eintrag → 500.

**Kommando/Output:**
```
npm run test -w server
 Test Files  7 passed (7)
      Tests  36 passed (36)
```

## Gesamt-Verifikation

```
npm run test -w server   → 36 passed (7 files), Exit 0
npm run build -w client  → built in 647ms, Exit 0
npm run build -w server  → OK, Exit 0
```
