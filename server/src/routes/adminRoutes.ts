import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import type { OmdbClient } from "../omdb.js";
import { asyncHandler, requireAdmin, requireAuth } from "../middleware.js";

export function createAdminRouter(db: Database.Database, tmdb: TmdbClient, omdb?: OmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db), requireAdmin);

  const updateEnriched = db.prepare(
    `UPDATE movies SET land = ?, regisseure = ?, autoren = ?, "cast" = ?, tmdb_bewertung = ?, tmdb_stimmen = ?,
     imdb_bewertung = ?, imdb_stimmen = ?, zuletzt_aktualisiert = datetime('now')
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

  return router;
}
