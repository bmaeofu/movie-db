import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import { asyncHandler, requireAdmin, requireAuth } from "../middleware.js";

export function createAdminRouter(db: Database.Database, tmdb: TmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db), requireAdmin);

  const updateEnriched = db.prepare(
    `UPDATE movies SET land = ?, regisseure = ?, autoren = ?, "cast" = ?, zuletzt_aktualisiert = datetime('now')
     WHERE tmdb_id = ?`
  );

  /**
   * Reichert alle Bestandsfilme (positive tmdb_id) ohne Land-Daten mit
   * Regisseuren/Autoren/Cast/Ländern an. Idempotent: überspringt bereits
   * angereicherte Einträge und Custom-Filme (negative IDs).
   */
  router.post(
    "/backfill",
    asyncHandler(async (req, res) => {
      const rows = db
        .prepare("SELECT tmdb_id, medientyp, land FROM movies WHERE tmdb_id > 0 AND land = '[]'")
        .all() as { tmdb_id: number; medientyp: "film" | "serie"; land: string }[];
      const updated: number[] = [];
      const failed: { tmdb_id: number; error: string }[] = [];
      for (const row of rows) {
        try {
          const m = await tmdb.details(row.tmdb_id, row.medientyp);
          updateEnriched.run(
            JSON.stringify(m.land),
            JSON.stringify(m.regisseure),
            JSON.stringify(m.autoren),
            JSON.stringify(m.cast),
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
