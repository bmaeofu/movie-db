import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import type { OmdbClient } from "../omdb.js";
import { asyncHandler, AuthedRequest, requireAdmin, requireAuth } from "../middleware.js";
import { syncKodiMovies, type KodiSyncConfig } from "../kodiSync.js";

export function createAdminRouter(db: Database.Database, tmdb: TmdbClient, omdb?: OmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db), requireAdmin);

  const updateEnriched = db.prepare(
    `UPDATE movies SET land = ?, regisseure = ?, autoren = ?, "cast" = ?, tmdb_bewertung = ?, tmdb_stimmen = ?,
     imdb_bewertung = ?, imdb_stimmen = ?, laufzeit_minuten = ?, zuletzt_aktualisiert = datetime('now')
     WHERE tmdb_id = ?`
  );

  /**
   * Reichert Bestandsfilme (positive tmdb_id) mit Regisseuren/Autoren/Cast/Ländern an.
   * Ohne force: nur noch nicht angereicherte (land = '[]'); mit ?force=1: alle (überschreibt).
   */
  router.post(
    "/backfill",
    asyncHandler(async (req, res) => {
      const force = req.query.force === "1";
      const omdbLimitRaw = Number(req.query.omdb_limit);
      const omdbLimit = Number.isFinite(omdbLimitRaw) ? omdbLimitRaw : Infinity;
      const rows = db
        .prepare(
          force
            ? "SELECT tmdb_id, medientyp, land, imdb_bewertung, imdb_stimmen FROM movies WHERE tmdb_id > 0"
            : "SELECT tmdb_id, medientyp, land, imdb_bewertung, imdb_stimmen FROM movies WHERE tmdb_id > 0 AND (land = '[]' OR imdb_bewertung IS NULL)"
        )
        .all() as {
        tmdb_id: number;
        medientyp: "film" | "serie";
        land: string;
        imdb_bewertung: number | null;
        imdb_stimmen: number | null;
      }[];
      const updated: number[] = [];
      const failed: { tmdb_id: number; error: string }[] = [];
      let omdbCalls = 0;
      for (const row of rows) {
        try {
          const m = await tmdb.details(row.tmdb_id, row.medientyp);
          const useOmdb = omdb !== undefined && omdbCalls < omdbLimit;
          const omdbData = useOmdb ? await omdb!.rating(m.imdb_id) : null;
          if (useOmdb) omdbCalls++;
          // Bei erreichtem OMDb-Budget die vorhandenen IMDb-Werte erhalten (nicht überschreiben)
          const imdb_bewertung = omdbData?.bewertung ?? row.imdb_bewertung;
          const imdb_stimmen = omdbData?.stimmen ?? row.imdb_stimmen;
          updateEnriched.run(
            JSON.stringify(m.land),
            JSON.stringify(m.regisseure),
            JSON.stringify(m.autoren),
            JSON.stringify(m.cast),
            m.tmdb_bewertung,
            m.tmdb_stimmen,
            imdb_bewertung,
            imdb_stimmen,
            m.laufzeit_minuten,
            row.tmdb_id
          );
          updated.push(row.tmdb_id);
        } catch (err) {
          failed.push({ tmdb_id: row.tmdb_id, error: err instanceof Error ? err.message : "unbekannt" });
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      res.json({ updated: updated.length, failed, offen: rows.length - updated.length });
    })
  );
  router.post(
    "/runtime-backfill",
    asyncHandler(async (req, res) => {
      const runtimes = (req.body ?? {}).runtimes;
      if (!Array.isArray(runtimes) || runtimes.length > 20000) {
        res.status(400).json({ error: "runtimes: Array mit maximal 20000 Einträgen erforderlich" });
        return;
      }
      const valid = runtimes.filter(
        (row: unknown): row is { tmdb_id: number; laufzeit_minuten: number } =>
          row !== null &&
          typeof row === "object" &&
          typeof (row as { tmdb_id?: unknown }).tmdb_id === "number" &&
          Number.isInteger((row as { tmdb_id: number }).tmdb_id) &&
          (row as { tmdb_id: number }).tmdb_id > 0 &&
          typeof (row as { laufzeit_minuten?: unknown }).laufzeit_minuten === "number" &&
          Number.isInteger((row as { laufzeit_minuten: number }).laufzeit_minuten) &&
          (row as { laufzeit_minuten: number }).laufzeit_minuten > 0
      );
      const updateRuntime = db.prepare(
        "UPDATE movies SET laufzeit_minuten = ?, zuletzt_aktualisiert = datetime('now') WHERE tmdb_id = ?"
      );
      let updated = 0;
      const apply = db.transaction(() => {
        for (const row of valid) updated += updateRuntime.run(row.laufzeit_minuten, row.tmdb_id).changes;
      });
      apply();
      res.json({ erhalten: runtimes.length, gültig: valid.length, aktualisiert: updated });
    })
  );

  router.post(
    "/runtime-backfill-tmdb",
    asyncHandler(async (_req, res) => {
      const rows = db.prepare(
        "SELECT tmdb_id, medientyp FROM movies WHERE tmdb_id > 0 AND laufzeit_minuten IS NULL"
      ).all() as { tmdb_id: number; medientyp: "film" | "serie" }[];
      const updated: number[] = [];
      const failed: { tmdb_id: number; error: string }[] = [];
      const updateRuntime = db.prepare(
        "UPDATE movies SET laufzeit_minuten = ?, zuletzt_aktualisiert = datetime('now') WHERE tmdb_id = ? AND laufzeit_minuten IS NULL"
      );
      for (const row of rows) {
        try {
          const movie = await tmdb.details(row.tmdb_id, row.medientyp);
          if (movie.laufzeit_minuten !== null) {
            updateRuntime.run(movie.laufzeit_minuten, row.tmdb_id);
            updated.push(row.tmdb_id);
          }
        } catch (err) {
          failed.push({ tmdb_id: row.tmdb_id, error: err instanceof Error ? err.message : "unbekannt" });
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      res.json({ geprüft: rows.length, aktualisiert: updated.length, ohne_laufzeit: rows.length - updated.length, fehlgeschlagen: failed });
    })
  );
  /**
   * Übernimmt Schauspieler-Fotos (Name → Bildquelle) aus einer externen Quelle (Kodi art-Tabelle).
   * bild: entweder vollständige http(s)-URL oder lokaler Pfad relativ zum gemounteten Medien-Ordner (beginnt mit '/').
   */
  router.post(
    "/actors",
    asyncHandler(async (req, res) => {
      const list = (req.body ?? {}).actors;
      if (!Array.isArray(list) || list.length > 2000) {
        res.status(400).json({ error: "actors: Array (max. 2000 Einträge) erforderlich" });
        return;
      }
      const ok = list.every(
        (a: unknown) =>
          a !== null &&
          typeof a === "object" &&
          typeof (a as any).name === "string" &&
          (a as any).name.trim().length > 0 &&
          typeof (a as any).bild === "string" &&
          ((a as any).bild.startsWith("http") || (a as any).bild.startsWith("/"))
      );
      if (!ok) {
        res.status(400).json({ error: "Jeder Eintrag braucht name (String) und bild (http-URL oder lokaler Pfad)" });
        return;
      }
      const upsert = db.prepare(
        `INSERT INTO actors (name, bild, zuletzt_aktualisiert) VALUES (?, ?, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET bild = excluded.bild, zuletzt_aktualisiert = datetime('now')`
      );
      for (const a of list as { name: string; bild: string }[]) {
        upsert.run(a.name.trim(), a.bild);
      }
      res.json({ imported: list.length });
    })
  );

  /**
   * Übernimmt vollständige Kodi-Filmdatensätze (ohne TMDB-Abruf).
   * body: { movies: [...] }
   */
  router.post(
    "/kodi-import",
    asyncHandler(async (req, res) => {
      const movies = (req.body ?? {}).movies;
      if (!Array.isArray(movies) || movies.length > 500) {
        res.status(400).json({ error: "movies: Array mit maximal 500 Einträgen erforderlich" });
        return;
      }

      interface KodiMovieInput {
        tmdb_id: number;
        titel: string;
        jahr: number | null;
        medientyp: "film" | "serie";
        genres: string[];
        land: string[];
        regisseure: string[];
        autoren: string[];
        cast: { name: string; rolle: string }[];
        overview: string | null;
        poster_url: string | null;
        tmdb_bewertung: number | null;
        tmdb_stimmen: number | null;
        imdb_bewertung: number | null;
        imdb_stimmen: number | null;
        imdb_id: string | null;
        laufzeit_minuten: number | null;
      }

      const isStringArr = (v: unknown): v is string[] =>
        Array.isArray(v) && v.every((x) => typeof x === "string");
      const isCast = (v: unknown): v is { name: string; rolle: string }[] =>
        Array.isArray(v) &&
        v.every(
          (x) =>
            x !== null &&
            typeof x === "object" &&
            typeof (x as { name?: unknown }).name === "string" &&
            typeof (x as { rolle?: unknown }).rolle === "string"
        );
      const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));
      const isRating = (v: unknown): v is number | null =>
        v === null || (typeof v === "number" && v >= 0 && v <= 10);

      const valid: KodiMovieInput[] = [];
      for (const m of movies) {
        if (m === null || typeof m !== "object") continue;
        const o = m as Record<string, unknown>;
        const tmdb_id = o.tmdb_id;
        const titel = o.titel;
        const medientyp = o.medientyp;
        if (typeof tmdb_id !== "number" || !Number.isInteger(tmdb_id) || tmdb_id <= 0) continue;
        if (typeof titel !== "string" || titel.trim().length === 0) continue;
        if (medientyp !== "film" && medientyp !== "serie") continue;
        if (!isStringArr(o.genres) || !isStringArr(o.land) || !isStringArr(o.regisseure) || !isStringArr(o.autoren)) continue;
        if (!isCast(o.cast)) continue;
        if (o.overview !== null && typeof o.overview !== "string") continue;
        if (o.poster_url !== null && typeof o.poster_url !== "string") continue;
        if (!isRating(o.tmdb_bewertung) || !isRating(o.imdb_bewertung)) continue;
        if (!isNumOrNull(o.tmdb_stimmen) || !isNumOrNull(o.imdb_stimmen)) continue;
        if (o.imdb_id !== null && typeof o.imdb_id !== "string") continue;
        if (o.jahr !== null && (typeof o.jahr !== "number" || !Number.isInteger(o.jahr))) continue;
        if (o.laufzeit_minuten !== null && (typeof o.laufzeit_minuten !== "number" || !Number.isInteger(o.laufzeit_minuten) || o.laufzeit_minuten <= 0)) continue;
        valid.push({
          tmdb_id,
          titel: titel.trim(),
          jahr: o.jahr as number | null,
          medientyp,
          genres: o.genres as string[],
          land: o.land as string[],
          regisseure: o.regisseure as string[],
          autoren: o.autoren as string[],
          cast: o.cast as { name: string; rolle: string }[],
          overview: o.overview as string | null,
          poster_url: o.poster_url as string | null,
          tmdb_bewertung: o.tmdb_bewertung as number | null,
          tmdb_stimmen: o.tmdb_stimmen as number | null,
          imdb_bewertung: o.imdb_bewertung as number | null,
          imdb_stimmen: o.imdb_stimmen as number | null,
          imdb_id: o.imdb_id as string | null,
          laufzeit_minuten: o.laufzeit_minuten as number | null,
        });
      }

      const upsert = db.prepare(
        `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                            land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten, source)
         VALUES (@tmdb_id, @titel, @jahr, @medientyp, @genres, @poster_url, @overview, @tmdb_json,
                 @land, @regisseure, @autoren, @cast, @tmdb_bewertung, @tmdb_stimmen, @imdb_bewertung, @imdb_stimmen, @laufzeit_minuten, 'kodi')
         ON CONFLICT(tmdb_id) DO UPDATE SET
           titel = excluded.titel, jahr = excluded.jahr, medientyp = excluded.medientyp,
           genres = excluded.genres, poster_url = excluded.poster_url, overview = excluded.overview,
           tmdb_json = excluded.tmdb_json, land = excluded.land, regisseure = excluded.regisseure,
           autoren = excluded.autoren, "cast" = excluded.cast, tmdb_bewertung = excluded.tmdb_bewertung,
           tmdb_stimmen = excluded.tmdb_stimmen, imdb_bewertung = excluded.imdb_bewertung,
           imdb_stimmen = excluded.imdb_stimmen, laufzeit_minuten = excluded.laufzeit_minuten, zuletzt_aktualisiert = datetime('now')`
      );
      const inCollection = db.prepare("SELECT 1 FROM collection WHERE tmdb_id = ?");
      const addCollection = db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)");
      const markNeu = db.prepare(
        "INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT id, ?, 'neu' FROM users"
      );

      const admin = (req as AuthedRequest).user.id;

      const imported: number[] = [];
      const skipped: number[] = [];
      const apply = db.transaction(() => {
        for (const m of valid) {
          if (inCollection.get(m.tmdb_id)) {
            skipped.push(m.tmdb_id);
            continue;
          }
          upsert.run({
            tmdb_id: m.tmdb_id,
            titel: m.titel,
            jahr: m.jahr,
            medientyp: m.medientyp,
            genres: JSON.stringify(m.genres),
            poster_url: m.poster_url,
            overview: m.overview,
            tmdb_json: JSON.stringify({ imdb_id: m.imdb_id }),
            land: JSON.stringify(m.land),
            regisseure: JSON.stringify(m.regisseure),
            autoren: JSON.stringify(m.autoren),
            cast: JSON.stringify(m.cast),
            tmdb_bewertung: m.tmdb_bewertung,
            tmdb_stimmen: m.tmdb_stimmen,
            imdb_bewertung: m.imdb_bewertung,
            imdb_stimmen: m.imdb_stimmen,
            laufzeit_minuten: m.laufzeit_minuten,
          });
          addCollection.run(m.tmdb_id, admin);
          markNeu.run(m.tmdb_id);
          imported.push(m.tmdb_id);
        }
      });
      apply();
      res.json({ erhalten: movies.length, gültig: valid.length, importiert: imported.length, übersprungen: skipped.length, fehlerhaft: movies.length - valid.length });
    })
  );

  /**
   * Liest alle Kodi-Filme (mit TMDb-ID) direkt aus der Kodi-MySQL und importiert
   * die in movie-db fehlenden Filme vollständig ohne TMDB-Abruf.
   */
  router.post(
    "/kodi-full-sync",
    asyncHandler(async (_req, res) => {
      const kodiCfg: KodiSyncConfig = {
        host: process.env.KODI_DB_HOST ?? "192.168.178.75",
        port: Number(process.env.KODI_DB_PORT ?? 3306),
        database: process.env.KODI_DB_NAME ?? "MyVideos131",
        user: process.env.KODI_DB_USER ?? "root",
        password: process.env.KODI_DB_PASSWORD ?? "kodi-db",
      };
      try {
        const result = await syncKodiMovies(db, kodiCfg);
        res.json(result);
      } catch (err) {
        console.error("Kodi-Sync fehlgeschlagen:", err);
        res.status(502).json({ error: "Kodi-Datenbank nicht erreichbar" });
      }
    })
  );

  /**
   * Ergänzt fehlende Felder aus TMDB/OMDb (ohne vorhandene Kodi-Werte zu überschreiben).
   * ?omdb_limit=N begrenzt OMDb-Aufrufe/Tag.
   */
  router.post(
    "/enrich",
    asyncHandler(async (req, res) => {
      const omdbLimitRaw = Number(req.query.omdb_limit);
      const omdbLimit = Number.isFinite(omdbLimitRaw) ? omdbLimitRaw : Infinity;
      const rows = db
        .prepare(
          `SELECT tmdb_id, medientyp, jahr, poster_url, overview, land, regisseure, autoren, "cast",
                  tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten
           FROM movies
           WHERE tmdb_id > 0
             AND (jahr IS NULL OR poster_url IS NULL OR overview IS NULL
                  OR land = '[]' OR regisseure = '[]' OR autoren = '[]' OR "cast" = '[]'
                  OR imdb_bewertung IS NULL)`
        )
        .all() as {
        tmdb_id: number;
        medientyp: "film" | "serie";
        jahr: number | null;
        poster_url: string | null;
        overview: string | null;
        land: string;
        regisseure: string;
        autoren: string;
        cast: string;
        tmdb_bewertung: number | null;
        tmdb_stimmen: number | null;
        imdb_bewertung: number | null;
        imdb_stimmen: number | null;
        laufzeit_minuten: number | null;
      }[];

      const update = db.prepare(
        `UPDATE movies SET jahr = ?, poster_url = ?, overview = ?, land = ?, regisseure = ?, autoren = ?, "cast" = ?,
                          tmdb_bewertung = ?, tmdb_stimmen = ?, imdb_bewertung = ?, imdb_stimmen = ?, laufzeit_minuten = ?,
                          zuletzt_aktualisiert = datetime('now')
         WHERE tmdb_id = ?`
      );

      let enriched = 0;
      let omdbCalls = 0;
      const failed: { tmdb_id: number; error: string }[] = [];

      // Fortschritt streamen (NDJSON), damit das User-Script Live-Ausgabe zeigt
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.flushHeaders();
      res.write(JSON.stringify({ status: "start", gesamt: rows.length }) + "\n");

      let i = 0;
      for (const row of rows) {
        i++;
        try {
          const m = await tmdb.details(row.tmdb_id, row.medientyp);

          // Nur fehlende Werte füllen; vorhandene Kodi-Werte bleiben erhalten
          const jahr = row.jahr ?? m.jahr;
          const poster_url = row.poster_url ?? m.poster_url;
          const overview = row.overview ?? m.overview;
          const land = row.land === "[]" ? JSON.stringify(m.land) : row.land;
          const regisseure = row.regisseure === "[]" ? JSON.stringify(m.regisseure) : row.regisseure;
          const autoren = row.autoren === "[]" ? JSON.stringify(m.autoren) : row.autoren;
          const cast = row.cast === "[]" ? JSON.stringify(m.cast) : row.cast;
          const tmdb_bewertung = row.tmdb_bewertung ?? m.tmdb_bewertung;
          const tmdb_stimmen = row.tmdb_stimmen ?? m.tmdb_stimmen;
          const laufzeit_minuten = row.laufzeit_minuten ?? m.laufzeit_minuten;

          let imdb_bewertung = row.imdb_bewertung;
          let imdb_stimmen = row.imdb_stimmen;
          if (imdb_bewertung === null && omdb !== undefined && omdbCalls < omdbLimit) {
            const omdbData = await omdb.rating(m.imdb_id);
            omdbCalls++;
            if (omdbData) {
              imdb_bewertung = omdbData.bewertung;
              imdb_stimmen = omdbData.stimmen;
            }
          }

          update.run(
            jahr,
            poster_url,
            overview,
            land,
            regisseure,
            autoren,
            cast,
            tmdb_bewertung,
            tmdb_stimmen,
            imdb_bewertung,
            imdb_stimmen,
            laufzeit_minuten,
            row.tmdb_id
          );
          enriched++;
        } catch (err) {
          failed.push({ tmdb_id: row.tmdb_id, error: err instanceof Error ? err.message : "unbekannt" });
        }
        // node:20 kennt Promise.withResolvers nicht → klassische Form verwenden
        await new Promise((resolve) => setTimeout(resolve, 120));

        if (i % 50 === 0) {
          res.write(JSON.stringify({ status: "progress", verarbeitet: i, gesamt: rows.length, ergänzt: enriched }) + "\n");
        }
      }
      res.end(
        JSON.stringify({ status: "done", geprüft: rows.length, ergänzt: enriched, fehlgeschlagen: failed, omdb_calls: omdbCalls }) + "\n"
      );
    })
  );

  /**
   * Korrigiert falsche TMDb-IDs (Reassignment inkl. FK-Tabellen).
   * body: { fixes: [{ alt: number, neu: number }] }
   * Ist `neu` bereits vorhanden, werden die Daten des falschen Eintrags zusammengeführt.
   */
  router.post(
    "/fix-tmdb-ids",
    asyncHandler(async (req, res) => {
      const fixes = (req.body ?? {}).fixes;
      if (!Array.isArray(fixes) || fixes.length > 500) {
        res.status(400).json({ error: "fixes: Array mit max. 500 {alt, neu}-Einträgen erforderlich" });
        return;
      }
      const valid = fixes.filter(
        (f): f is { alt: number; neu: number } =>
          f !== null &&
          typeof f === "object" &&
          typeof (f as { alt?: unknown }).alt === "number" &&
          Number.isInteger((f as { alt: number }).alt) &&
          typeof (f as { neu?: unknown }).neu === "number" &&
          Number.isInteger((f as { neu: number }).neu) &&
          (f as { alt: number }).alt > 0 &&
          (f as { neu: number }).neu > 0 &&
          (f as { alt: number }).alt !== (f as { neu: number }).neu
      );

      const copyMovie = db.prepare(
        `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                            land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten, source, zuletzt_aktualisiert)
         SELECT @neu, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten, source, zuletzt_aktualisiert
         FROM movies WHERE tmdb_id = @alt`
      );
      const exists = db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ?");
      const existsCol = db.prepare("SELECT 1 FROM collection WHERE tmdb_id = ?");
      const mvRatings = db.prepare(
        "INSERT OR IGNORE INTO ratings (user_id, tmdb_id, sterne, updated_at) SELECT user_id, ?, sterne, updated_at FROM ratings WHERE tmdb_id = ?"
      );
      const delRatings = db.prepare("DELETE FROM ratings WHERE tmdb_id = ?");
      const mvStatus = db.prepare(
        "INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT user_id, ?, status FROM watch_status WHERE tmdb_id = ?"
      );
      const delStatus = db.prepare("DELETE FROM watch_status WHERE tmdb_id = ?");
      const mvNotes = db.prepare(
        "INSERT OR IGNORE INTO notes (user_id, tmdb_id, text, updated_at) SELECT user_id, ?, text, updated_at FROM notes WHERE tmdb_id = ?"
      );
      const delNotes = db.prepare("DELETE FROM notes WHERE tmdb_id = ?");
      const mvList = db.prepare(
        "INSERT OR IGNORE INTO list_items (list_id, tmdb_id) SELECT list_id, ? FROM list_items WHERE tmdb_id = ?"
      );
      const delList = db.prepare("DELETE FROM list_items WHERE tmdb_id = ?");
      const mvCol = db.prepare("UPDATE collection SET tmdb_id = ? WHERE tmdb_id = ?");
      const delCol = db.prepare("DELETE FROM collection WHERE tmdb_id = ?");
      const delMovie = db.prepare("DELETE FROM movies WHERE tmdb_id = ?");

      const results: { alt: number; neu: number; status: string; merge?: boolean }[] = [];
      const apply = db.transaction(() => {
        for (const f of valid) {
          if (!exists.get(f.alt)) {
            results.push({ alt: f.alt, neu: f.neu, status: "alt_nicht_gefunden" });
            continue;
          }
          const merge = Boolean(exists.get(f.neu));
          if (!merge) copyMovie.run({ neu: f.neu, alt: f.alt });

          mvRatings.run(f.neu, f.alt);
          delRatings.run(f.alt);
          mvStatus.run(f.neu, f.alt);
          delStatus.run(f.alt);
          mvNotes.run(f.neu, f.alt);
          delNotes.run(f.alt);
          mvList.run(f.neu, f.alt);
          delList.run(f.alt);

          if (existsCol.get(f.neu)) {
            delCol.run(f.alt);
          } else {
            mvCol.run(f.neu, f.alt);
          }
          delMovie.run(f.alt);
          results.push({ alt: f.alt, neu: f.neu, status: "ok", merge });
        }
      });
      apply();
      res.json({ fixes: results });
    })
  );

  /**
   * Setzt das Produktionsland (land) für Filme aus externen Metadaten (z. B. .txt/.log).
   * body: { land: [{ tmdb_id: number, land: string[] }] }
   */
  router.post(
    "/set-land",
    asyncHandler(async (req, res) => {
      const items = (req.body ?? {}).land;
      if (!Array.isArray(items) || items.length > 2000) {
        res.status(400).json({ error: "land: Array mit max. 2000 Einträgen erforderlich" });
        return;
      }
      const valid = items.filter(
        (it): it is { tmdb_id: number; land: string[] } =>
          it !== null &&
          typeof it === "object" &&
          typeof (it as { tmdb_id?: unknown }).tmdb_id === "number" &&
          Number.isInteger((it as { tmdb_id: number }).tmdb_id) &&
          (it as { tmdb_id: number }).tmdb_id > 0 &&
          Array.isArray((it as { land?: unknown }).land) &&
          (it as { land: unknown[] }).land.every((x) => typeof x === "string" && x.trim().length > 0)
      );
      const update = db.prepare(
        "UPDATE movies SET land = ?, zuletzt_aktualisiert = datetime('now') WHERE tmdb_id = ?"
      );
      let updated = 0;
      const apply = db.transaction(() => {
        for (const it of valid) {
          const changes = update.run(JSON.stringify(it.land.map((l) => l.trim())), it.tmdb_id).changes;
          if (changes > 0) updated++;
        }
      });
      apply();
      res.json({ erhalten: items.length, gültig: valid.length, aktualisiert: updated });
    })
  );

  return router;
}
