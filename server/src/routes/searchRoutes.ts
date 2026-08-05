import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import { asyncHandler, requireAuth } from "../middleware.js";

const SEARCH_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createSearchRouter(db: Database.Database, tmdb: TmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) {
        res.status(400).json({ error: "Parameter q fehlt" });
        return;
      }
      const cached = db
        .prepare("SELECT tmdb_json FROM search_cache WHERE query = ? AND cached_at > datetime('now', ?)")
        .get(q, `-${SEARCH_TTL_SECONDS} seconds`) as { tmdb_json: string } | undefined;
      if (cached) {
        res.json({ results: JSON.parse(cached.tmdb_json) });
        return;
      }
      let results;
      try {
        results = await tmdb.search(q);
        db.prepare(
          `INSERT INTO search_cache (query, tmdb_json, cached_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(query) DO UPDATE SET tmdb_json = excluded.tmdb_json, cached_at = datetime('now')`
        ).run(q, JSON.stringify(results));
      } catch (err) {
        const stale = db.prepare("SELECT tmdb_json FROM search_cache WHERE query = ?").get(q) as
          | { tmdb_json: string }
          | undefined;
        if (!stale) throw err;
        res.json({ results: JSON.parse(stale.tmdb_json) });
        return;
      }
      res.json({ results });
    })
  );

  return router;
}
