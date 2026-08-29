import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import type { OmdbClient } from "../omdb.js";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { listMovieViews } from "../queries.js";
import { fetchKodiActorPhotos, fetchKodiPosters, type KodiSyncConfig } from "../kodiSync.js";

function buildFilter(query: Record<string, unknown>): { where: string[]; params: Record<string, unknown> } {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const text = typeof query.text === "string" ? query.text.trim() : "";
  const genre = typeof query.genre === "string" ? query.genre.trim() : "";
  const land = typeof query.land === "string" ? query.land.trim() : "";
  const regisseur = typeof query.regisseur === "string" ? query.regisseur.trim() : "";
  const schauspieler = typeof query.schauspieler === "string" ? query.schauspieler.trim() : "";
  const jahrParam = typeof query.jahr === "string" ? query.jahr.trim() : "";
  const tmdbMin = Number(query.tmdb_min);
  const imdbMin = Number(query.imdb_min);
  const ratingMin = Number(query.rating_min);
  const tmdbMax = Number(query.tmdb_max);
  const imdbMax = Number(query.imdb_max); 
  const runtimeMin = Number(query.runtime_min);
  const runtimeMax = Number(query.runtime_max);
  const medientyp = typeof query.medientyp === "string" ? query.medientyp : "";
  const status = typeof query.status === "string" ? query.status : "";

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
  if (schauspieler) {
    where.push('m."cast" LIKE @schauspieler');
    params.schauspieler = `%${schauspieler}%`;
  }
  const jahr = Number(jahrParam);
  if (jahrParam !== "" && Number.isInteger(jahr) && jahr >= 1888 && jahr <= 2100) {
    where.push("m.jahr = @jahr");
    params.jahr = jahr;
  }
  if (Number.isFinite(tmdbMin) && tmdbMin >= 0 && tmdbMin <= 10) {
    where.push("m.tmdb_bewertung >= @tmdbMin");
    params.tmdbMin = tmdbMin;
  }
  if (Number.isFinite(imdbMin) && imdbMin >= 0 && imdbMin <= 10) {
    where.push("m.imdb_bewertung >= @imdbMin");
    params.imdbMin = imdbMin;
  }
  if (Number.isFinite(ratingMin) && ratingMin >= 1 && ratingMin <= 5) {
    where.push("(SELECT AVG(rating.sterne) FROM ratings rating WHERE rating.tmdb_id = m.tmdb_id) >= @ratingMin");
    params.ratingMin = ratingMin;
  }
  if (Number.isFinite(tmdbMax) && tmdbMax >= 0 && tmdbMax <= 10) {
    where.push("m.tmdb_bewertung < @tmdbMax");
    params.tmdbMax = tmdbMax;
  }
  if (Number.isFinite(imdbMax) && imdbMax >= 0 && imdbMax <= 10) {
    where.push("m.imdb_bewertung < @imdbMax");
    params.imdbMax = imdbMax;
  }
  if (Number.isInteger(runtimeMin) && runtimeMin >= 0) {
    where.push("m.laufzeit_minuten >= @runtimeMin");
    params.runtimeMin = runtimeMin;
  }
  if (Number.isInteger(runtimeMax) && runtimeMax >= 0) {
    where.push("m.laufzeit_minuten <= @runtimeMax");
    params.runtimeMax = runtimeMax;
  }
  if (medientyp === "film" || medientyp === "serie") {
    where.push("m.medientyp = @medientyp");
    params.medientyp = medientyp;
  }
  if (status) {
    where.push("ws.status = @status");
    params.status = status;
  }
  return { where, params };
}

export function createCollectionRouter(
  db: Database.Database,
  tmdb: TmdbClient,
  omdb?: OmdbClient,
  mediaDir?: string
): Router {
  const router = Router();
  router.use(requireAuth(db));
  const upsertMovie = db.prepare(
    `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                        land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten, source)
     VALUES (@tmdb_id, @titel, @jahr, @medientyp, @genres, @poster_url, @overview, @tmdb_json,
             @land, @regisseure, @autoren, @cast, @tmdb_bewertung, @tmdb_stimmen, @imdb_bewertung, @imdb_stimmen, @laufzeit_minuten, @source)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       titel = excluded.titel, jahr = excluded.jahr, medientyp = excluded.medientyp,
       genres = excluded.genres, poster_url = excluded.poster_url, overview = excluded.overview,
       tmdb_json = excluded.tmdb_json, land = excluded.land, regisseure = excluded.regisseure,
       autoren = excluded.autoren, "cast" = excluded.cast, tmdb_bewertung = excluded.tmdb_bewertung,
       tmdb_stimmen = excluded.tmdb_stimmen, imdb_bewertung = excluded.imdb_bewertung,
       imdb_stimmen = excluded.imdb_stimmen, laufzeit_minuten = excluded.laufzeit_minuten, zuletzt_aktualisiert = datetime('now')`
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
      const { tmdb_id, medientyp, source, tmdb_bewertung, imdb_bewertung, imdb_stimmen } = (req.body ?? {}) as {
        tmdb_id?: unknown;
        medientyp?: unknown;
        source?: unknown;
        tmdb_bewertung?: unknown;
        imdb_bewertung?: unknown;
        imdb_stimmen?: unknown;
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
      if (
        imdb_stimmen !== undefined &&
        imdb_stimmen !== null &&
        (typeof imdb_stimmen !== "number" || !Number.isInteger(imdb_stimmen) || imdb_stimmen < 0)
      ) {
        res.status(400).json({ error: "imdb_stimmen muss eine nicht-negative ganze Zahl sein" });
        return;
      }
      const forceRatings = req.query.force_ratings === "1";
      const existing = db.prepare("SELECT 1 FROM collection WHERE tmdb_id = ?").get(tmdb_id);
      if (existing && !forceRatings) {
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
      let finalImdbStimmen: number | null = null;
      if (numOk(tmdb_bewertung)) finalTmdb = tmdb_bewertung;
      if (numOk(imdb_bewertung)) {
        finalImdb = imdb_bewertung;
        if (typeof imdb_stimmen === "number" && Number.isInteger(imdb_stimmen) && imdb_stimmen >= 0) {
          finalImdbStimmen = imdb_stimmen;
        }
      } else if (omdb && req.query.skip_omdb !== "1") {
        const omdbData = await omdb.rating(movie.imdb_id);
        if (omdbData) {
          finalImdb = omdbData.bewertung;
          finalImdbStimmen = omdbData.stimmen;
        }
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
        imdb_stimmen: finalImdbStimmen,
        laufzeit_minuten: movie.laufzeit_minuten,
        source: (source as string) ?? "user",
      });
      if (!existing) {
        const user = (req as AuthedRequest).user;
        db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)").run(tmdb_id, user.id);
        // Neu aufgenommen → Status 'neu' für ALLE Benutzer
        db.prepare("INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT id, ?, 'neu' FROM users").run(tmdb_id);
        res.status(201).json({ message: "Zur Sammlung hinzugefügt" });
      } else {
        res.status(200).json({ message: "Ratings aktualisiert" });
      }
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedRequest).user.id;
      const sort = typeof req.query.sort === "string" ? req.query.sort : "zuletzt_hinzugefuegt";
      const { where, params } = buildFilter(req.query);

      const orderBy: Record<string, string> = {
        titel: "m.titel COLLATE NOCASE ASC",
        laufzeit_aufsteigend: "m.laufzeit_minuten IS NULL, m.laufzeit_minuten ASC",
        laufzeit_absteigend: "m.laufzeit_minuten IS NULL, m.laufzeit_minuten DESC",
        jahr: "m.jahr DESC",
        bewertung: "avg_rating DESC",
        tmdb_bewertung: "m.tmdb_bewertung DESC",
        imdb_bewertung: "m.imdb_bewertung DESC",
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
    "/count",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedRequest).user.id;
      const { where, params } = buildFilter(req.query);
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT m.tmdb_id) AS n
           FROM collection c
           JOIN movies m ON m.tmdb_id = c.tmdb_id
           LEFT JOIN watch_status ws ON ws.tmdb_id = c.tmdb_id AND ws.user_id = @userId
           ${where.length ? "WHERE " + where.join(" AND ") : ""}`
        )
        .get({ userId, ...params }) as { n: number };
      res.json({ count: row.n });
    })
  );

  router.get(
    "/facets",
    asyncHandler(async (_req, res) => {
      const rows = db.prepare('SELECT land, regisseure, jahr, "cast" FROM movies').all() as {
        land: string;
        regisseure: string;
        jahr: number | null;
        cast: string;
      }[];
      const laender = new Set<string>();
      const regisseure = new Set<string>();
      const jahre = new Set<number>();
      const schauspieler = new Set<string>();
      for (const r of rows) {
        for (const l of JSON.parse(r.land) as string[]) laender.add(l);
        for (const d of JSON.parse(r.regisseure) as string[]) regisseure.add(d);
        if (r.jahr !== null) jahre.add(r.jahr);
        for (const c of JSON.parse(r.cast) as { name: string }[]) schauspieler.add(c.name);
      }
      res.json({
        laender: [...laender].sort(),
        regisseure: [...regisseure].sort(),
        jahre: [...jahre].sort((a, b) => b - a),
        schauspieler: [...schauspieler].sort(),
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

  // Vervollständigt einen einzelnen Film (fehlende Felder aus TMDB/OMDb + Kodi-Poster/Schauspieler).
  router.post(
    "/:tmdbId/enrich",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
        res.status(400).json({ error: "tmdb_id erforderlich" });
        return;
      }
      const row = db
        .prepare(
          `SELECT tmdb_id, medientyp, jahr, poster_url, overview, land, regisseure, autoren, "cast",
                  tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten
           FROM movies WHERE tmdb_id = ?`
        )
        .get(tmdbId) as
        | {
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
          }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Film nicht gefunden" });
        return;
      }

      let m;
      try {
        m = await tmdb.details(tmdbId, row.medientyp);
      } catch {
        res.status(502).json({ error: "TMDB nicht erreichbar – bitte erneut versuchen" });
        return;
      }

      const filled: string[] = [];
      const jahr = row.jahr ?? m.jahr;
      // /media-Poster, dessen Datei fehlt, gilt als Lücke → TMDB-Poster versuchen
      let poster_url = row.poster_url ?? m.poster_url;
      const brokenMedia =
        poster_url !== null &&
        poster_url.startsWith("/media/") &&
        mediaDir !== undefined &&
        !fs.existsSync(path.join(mediaDir, poster_url.slice("/media".length)));
      if (brokenMedia) {
        poster_url = m.poster_url;
      }
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
      if (imdb_bewertung === null && omdb !== undefined) {
        const omdbData = await omdb.rating(m.imdb_id);
        if (omdbData) {
          imdb_bewertung = omdbData.bewertung;
          imdb_stimmen = omdbData.stimmen;
          filled.push("imdb_bewertung");
        }
      }

      db.prepare(
        `UPDATE movies SET jahr = ?, poster_url = ?, overview = ?, land = ?, regisseure = ?, autoren = ?, "cast" = ?,
                          tmdb_bewertung = ?, tmdb_stimmen = ?, imdb_bewertung = ?, imdb_stimmen = ?, laufzeit_minuten = ?,
                          zuletzt_aktualisiert = datetime('now')
         WHERE tmdb_id = ?`
      ).run(jahr, poster_url, overview, land, regisseure, autoren, cast, tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten, tmdbId);

      if (row.jahr === null && jahr !== null) filled.push("jahr");
      if ((row.poster_url === null || brokenMedia) && poster_url !== null) filled.push("poster");
      if (row.overview === null && overview !== null) filled.push("overview");
      if (row.land === "[]" && land !== "[]") filled.push("land");
      if (row.regisseure === "[]" && regisseure !== "[]") filled.push("regisseure");
      if (row.autoren === "[]" && autoren !== "[]") filled.push("autoren");
      if (row.cast === "[]" && cast !== "[]") filled.push("cast");
      if (row.tmdb_bewertung === null && tmdb_bewertung !== null) filled.push("tmdb_bewertung");
      if (row.laufzeit_minuten === null && laufzeit_minuten !== null) filled.push("laufzeit");

      const kodiCfg: KodiSyncConfig = {
        host: process.env.KODI_DB_HOST ?? "192.168.178.75",
        port: Number(process.env.KODI_DB_PORT ?? 3306),
        database: process.env.KODI_DB_NAME ?? "MyVideos131",
        user: process.env.KODI_DB_USER ?? "root",
        password: process.env.KODI_DB_PASSWORD ?? "kodi-db",
      };

      // Kodi-Poster, falls TMDB keins liefert
      if (!poster_url) {
        try {
          const posters = await fetchKodiPosters(kodiCfg, [tmdbId]);
          const kodiPoster = posters.get(tmdbId);
          if (kodiPoster) {
            db.prepare("UPDATE movies SET poster_url = ?, zuletzt_aktualisiert = datetime('now') WHERE tmdb_id = ?").run(kodiPoster, tmdbId);
            filled.push("poster_kodi");
          }
        } catch {
          // Kodi nicht erreichbar → ignorieren
        }
      }

      // Kodi-Schauspieler-Fotos für den Cast
      const castNames = (JSON.parse(cast) as { name: string }[]).map((c) => c.name);
      if (castNames.length > 0) {
        try {
          const photos = await fetchKodiActorPhotos(kodiCfg, castNames);
          if (photos.length > 0) {
            const insert = db.prepare(
              "INSERT OR IGNORE INTO actors (name, bild, zuletzt_aktualisiert) VALUES (?, ?, datetime('now'))"
            );
            let n = 0;
            for (const p of photos) if (insert.run(p.name, p.bild).changes > 0) n++;
            if (n > 0) filled.push(`schauspieler_fotos:${n}`);
          }
        } catch {
          // Kodi nicht erreichbar → ignorieren
        }
      }

      res.json({ tmdb_id: tmdbId, ergänzt: filled });
    })
  );

  return router;
}
