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

  return router;
}
