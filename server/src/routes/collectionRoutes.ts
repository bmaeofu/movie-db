import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { listMovieViews } from "../queries.js";

export function createCollectionRouter(db: Database.Database, tmdb: TmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db));

  const upsertMovie = db.prepare(
    `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json)
     VALUES (@tmdb_id, @titel, @jahr, @medientyp, @genres, @poster_url, @overview, @tmdb_json)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       titel = excluded.titel, jahr = excluded.jahr, medientyp = excluded.medientyp,
       genres = excluded.genres, poster_url = excluded.poster_url, overview = excluded.overview,
       tmdb_json = excluded.tmdb_json, zuletzt_aktualisiert = datetime('now')`
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { tmdb_id, medientyp } = (req.body ?? {}) as { tmdb_id?: unknown; medientyp?: unknown };
      if (typeof tmdb_id !== "number" || !Number.isInteger(tmdb_id) || (medientyp !== "film" && medientyp !== "serie")) {
        res.status(400).json({ error: "tmdb_id (Integer) und medientyp ('film'|'serie') erforderlich" });
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
      upsertMovie.run({
        tmdb_id: movie.tmdb_id,
        titel: movie.titel,
        jahr: movie.jahr,
        medientyp: movie.medientyp,
        genres: JSON.stringify(movie.genres),
        poster_url: movie.poster_url,
        overview: movie.overview,
        tmdb_json: JSON.stringify(movie),
      });
      const user = (req as AuthedRequest).user;
      db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)").run(tmdb_id, user.id);
      res.status(201).json({ message: "Zur Sammlung hinzugefügt" });
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedRequest).user.id;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const genre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";
      const medientyp = typeof req.query.medientyp === "string" ? req.query.medientyp : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const sort = typeof req.query.sort === "string" ? req.query.sort : "zuletzt_hinzugefuegt";

      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (q) {
        where.push("m.titel LIKE @q");
        params.q = `%${q}%`;
      }
      if (genre) {
        where.push("m.genres LIKE @genre");
        params.genre = `%${genre}%`;
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
