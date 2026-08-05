import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import type { OmdbClient } from "../omdb.js";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { listMovieViews } from "../queries.js";

export function createCollectionRouter(db: Database.Database, tmdb: TmdbClient, omdb?: OmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db));

  const upsertMovie = db.prepare(
    `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                        land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, source)
     VALUES (@tmdb_id, @titel, @jahr, @medientyp, @genres, @poster_url, @overview, @tmdb_json,
             @land, @regisseure, @autoren, @cast, @tmdb_bewertung, @tmdb_stimmen, @imdb_bewertung, @source)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       titel = excluded.titel, jahr = excluded.jahr, medientyp = excluded.medientyp,
       genres = excluded.genres, poster_url = excluded.poster_url, overview = excluded.overview,
       tmdb_json = excluded.tmdb_json, land = excluded.land, regisseure = excluded.regisseure,
       autoren = excluded.autoren, "cast" = excluded.cast, tmdb_bewertung = excluded.tmdb_bewertung,
       tmdb_stimmen = excluded.tmdb_stimmen, imdb_bewertung = excluded.imdb_bewertung,
       zuletzt_aktualisiert = datetime('now')`
  );

  router.post(
    "/custom",
    asyncHandler(async (req, res) => {
      const { titel, jahr, medientyp, genres, overview, land, regisseure, autoren, cast } = (req.body ?? {}) as {
        titel?: unknown;
        jahr?: unknown;
        medientyp?: unknown;
        genres?: unknown;
        overview?: unknown;
        land?: unknown;
        regisseure?: unknown;
        autoren?: unknown;
        cast?: unknown;
      };
      if (typeof titel !== "string" || titel.trim().length === 0) {
        res.status(400).json({ error: "Titel erforderlich" });
        return;
      }
      if (medientyp !== "film" && medientyp !== "serie") {
        res.status(400).json({ error: "medientyp ('film'|'serie') erforderlich" });
        return;
      }
      const yearIsValid =
        jahr === undefined ||
        jahr === null ||
        (typeof jahr === "number" && Number.isInteger(jahr) && jahr >= 1888 && jahr <= 2100);
      if (!yearIsValid) {
        res.status(400).json({ error: "jahr muss eine Jahreszahl sein" });
        return;
      }
      if (genres !== undefined && !(Array.isArray(genres) && genres.every((g) => typeof g === "string"))) {
        res.status(400).json({ error: "genres muss ein Array aus Strings sein" });
        return;
      }
      if (overview !== undefined && typeof overview !== "string") {
        res.status(400).json({ error: "overview muss ein String sein" });
        return;
      }
      const listOk = (v: unknown): v is string[] =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));
      const castOk = (v: unknown): v is { name: string; rolle: string }[] =>
        v === undefined ||
        (Array.isArray(v) &&
          v.every((x) => x !== null && typeof x === "object" && typeof (x as any).name === "string" && typeof (x as any).rolle === "string"));
      if (!listOk(land) || !listOk(regisseure) || !listOk(autoren) || !castOk(cast)) {
        res.status(400).json({ error: "land/regisseure/autoren: String-Arrays, cast: {name, rolle}-Objekte" });
        return;
      }
      const newId = (
        db.prepare("SELECT COALESCE(MIN(tmdb_id), 0) - 1 AS id FROM movies WHERE tmdb_id < 0").get() as { id: number }
      ).id;
      const user = (req as AuthedRequest).user;
      const year = typeof jahr === "number" ? jahr : null;
      db.prepare(
        `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                            land, regisseure, autoren, "cast")
         VALUES (?, ?, ?, ?, ?, NULL, ?, '{}', ?, ?, ?, ?)`
      ).run(
        newId,
        titel.trim(),
        year,
        medientyp,
        JSON.stringify((genres as string[]) ?? []),
        (overview as string) ?? null,
        JSON.stringify((land as string[]) ?? []),
        JSON.stringify((regisseure as string[]) ?? []),
        JSON.stringify((autoren as string[]) ?? []),
        JSON.stringify((cast as { name: string; rolle: string }[]) ?? [])
      );
      db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)").run(newId, user.id);
      // Neu aufgenommen → Status 'neu' für ALLE Benutzer
      db.prepare("INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT id, ?, 'neu' FROM users").run(newId);
      res.status(201).json({ message: "Zur Sammlung hinzugefügt", tmdb_id: newId });
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { tmdb_id, medientyp, source, tmdb_bewertung, imdb_bewertung } = (req.body ?? {}) as {
        tmdb_id?: unknown;
        medientyp?: unknown;
        source?: unknown;
        tmdb_bewertung?: unknown;
        imdb_bewertung?: unknown;
      };
      if (typeof tmdb_id !== "number" || !Number.isInteger(tmdb_id) || (medientyp !== "film" && medientyp !== "serie")) {
        res.status(400).json({ error: "tmdb_id (Integer) und medientyp ('film'|'serie') erforderlich" });
        return;
      }
      if (source !== undefined && source !== "user" && source !== "kodi") {
        res.status(400).json({ error: "source ('user'|'kodi') erforderlich" });
        return;
      }
      const numOk = (v: unknown): v is number =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10;
      if (
        (tmdb_bewertung !== undefined && tmdb_bewertung !== null && !numOk(tmdb_bewertung)) ||
        (imdb_bewertung !== undefined && imdb_bewertung !== null && !numOk(imdb_bewertung))
      ) {
        res.status(400).json({ error: "Bewertungen müssen Zahlen zwischen 0 und 10 sein" });
        return;
      }
      const existing = db.prepare("SELECT 1 FROM collection WHERE tmdb_id = ?").get(tmdb_id);
      if (existing) {
        res.status(200).json({ message: "Bereits in der Sammlung" });
        return;
      }
      let movie;
      try {
        movie = await tmdb.details(tmdb_id, medientyp);
      } catch {
        res.status(502).json({ error: "TMDB nicht erreichbar – bitte erneut versuchen" });
        return;
      }
      let finalTmdb = movie.tmdb_bewertung;
      let finalImdb: number | null = null;
      if (numOk(tmdb_bewertung)) finalTmdb = tmdb_bewertung;
      if (numOk(imdb_bewertung)) {
        finalImdb = imdb_bewertung;
      } else if (omdb && req.query.skip_omdb !== "1") {
        finalImdb = await omdb.rating(movie.imdb_id);
      }
      upsertMovie.run({
        tmdb_id: movie.tmdb_id,
        titel: movie.titel,
        jahr: movie.jahr,
        medientyp: movie.medientyp,
        genres: JSON.stringify(movie.genres),
        poster_url: movie.poster_url,
        overview: movie.overview,
        tmdb_json: JSON.stringify(movie),
        land: JSON.stringify(movie.land),
        regisseure: JSON.stringify(movie.regisseure),
        autoren: JSON.stringify(movie.autoren),
        cast: JSON.stringify(movie.cast),
        tmdb_bewertung: finalTmdb,
        tmdb_stimmen: movie.tmdb_stimmen,
        imdb_bewertung: finalImdb,
        source: (source as string) ?? "user",
      });
      const user = (req as AuthedRequest).user;
      db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)").run(tmdb_id, user.id);
      // Neu aufgenommen → Status 'neu' für ALLE Benutzer (bestehende Status bleiben erhalten)
      db.prepare("INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT id, ?, 'neu' FROM users").run(tmdb_id);
      res.status(201).json({ message: "Zur Sammlung hinzugefügt" });
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedRequest).user.id;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const text = typeof req.query.text === "string" ? req.query.text.trim() : "";
      const genre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";
      const land = typeof req.query.land === "string" ? req.query.land.trim() : "";
      const regisseur = typeof req.query.regisseur === "string" ? req.query.regisseur.trim() : "";
      const jahrParam = typeof req.query.jahr === "string" ? req.query.jahr.trim() : "";
      const medientyp = typeof req.query.medientyp === "string" ? req.query.medientyp : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const sort = typeof req.query.sort === "string" ? req.query.sort : "zuletzt_hinzugefuegt";

      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (q) {
        where.push("m.titel LIKE @q");
        params.q = `%${q}%`;
      }
      if (text) {
        where.push(
          '(m.titel LIKE @text OR m.regisseure LIKE @text OR m.autoren LIKE @text OR m."cast" LIKE @text OR m.land LIKE @text)'
        );
        params.text = `%${text}%`;
      }
      if (genre) {
        where.push("m.genres LIKE @genre");
        params.genre = `%${genre}%`;
      }
      if (land) {
        where.push("m.land LIKE @land");
        params.land = `%${land}%`;
      }
      if (regisseur) {
        where.push("m.regisseure LIKE @regisseur");
        params.regisseur = `%${regisseur}%`;
      }
      const jahr = Number(jahrParam);
      if (jahrParam !== "" && Number.isInteger(jahr) && jahr >= 1888 && jahr <= 2100) {
        where.push("m.jahr = @jahr");
        params.jahr = jahr;
      }
      if (medientyp === "film" || medientyp === "serie") {
        where.push("m.medientyp = @medientyp");
        params.medientyp = medientyp;
      }
      if (status) {
        where.push("ws.status = @status");
        params.status = status;
      }

      const orderBy: Record<string, string> = {
        titel: "m.titel COLLATE NOCASE ASC",
        jahr: "m.jahr DESC",
        bewertung: "avg_rating DESC",
        zuletzt_hinzugefuegt: "c.added_at DESC",
      };

      const rows = listMovieViews(
        db,
        userId,
        "FROM collection c JOIN movies m ON m.tmdb_id = c.tmdb_id LEFT JOIN users u ON u.id = c.added_by",
        where,
        params,
        orderBy[sort] ?? orderBy.zuletzt_hinzugefuegt
      );
      res.json(rows);
    })
  );

  router.get(
    "/facets",
    asyncHandler(async (_req, res) => {
      const rows = db.prepare("SELECT land, regisseure, jahr FROM movies").all() as {
        land: string;
        regisseure: string;
        jahr: number | null;
      }[];
      const laender = new Set<string>();
      const regisseure = new Set<string>();
      const jahre = new Set<number>();
      for (const r of rows) {
        for (const l of JSON.parse(r.land) as string[]) laender.add(l);
        for (const d of JSON.parse(r.regisseure) as string[]) regisseure.add(d);
        if (r.jahr !== null) jahre.add(r.jahr);
      }
      res.json({
        laender: [...laender].sort(),
        regisseure: [...regisseure].sort(),
        jahre: [...jahre].sort((a, b) => b - a),
      });
    })
  );

  router.delete(
    "/:tmdbId",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const user = (req as AuthedRequest).user;
      const row = db.prepare("SELECT added_by FROM collection WHERE tmdb_id = ?").get(tmdbId) as
        | { added_by: number }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Nicht in der Sammlung" });
        return;
      }
      if (row.added_by !== user.id && !user.is_admin) {
        res.status(403).json({ error: "Nur Admin oder Ersteller darf entfernen" });
        return;
      }
      db.prepare("DELETE FROM collection WHERE tmdb_id = ?").run(tmdbId);
      res.status(204).end();
    })
  );

  return router;
}
