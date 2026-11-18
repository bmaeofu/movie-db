import { Router } from "express";
import type Database from "better-sqlite3";
import { asyncHandler } from "../middleware.js";
import { fetchKodiDateien, kodiKonfigurationAusEnv } from "../kodiSync.js";
import { bauePlayUrls } from "../playback.js";
import { mediaPrefixes, resolveMediaFile } from "../media.js";

export function createMovieRouter(
  db: Database.Database,
  mediaDir = process.env.MEDIA_DIR ?? "/media",
  prefixes: string[] = mediaPrefixes()
): Router {
  const router = Router();

  router.get(
    "/:tmdbId/play",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
        res.status(400).json({ error: "tmdbId (Integer) erforderlich" });
        return;
      }
      const row = db.prepare("SELECT datei_pfade FROM movies WHERE tmdb_id = ?").get(tmdbId) as
        | { datei_pfade: string }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Film nicht gefunden" });
        return;
      }

      let pfade: string[] = [];
      try {
        const gespeichert = JSON.parse(row.datei_pfade) as unknown;
        if (Array.isArray(gespeichert)) pfade = gespeichert.filter((p): p is string => typeof p === "string");
      } catch {
        pfade = [];
      }
      // Altbestand ohne gespeicherte Pfade: live aus Kodi holen
      if (pfade.length === 0) {
        try {
          pfade = await fetchKodiDateien(kodiKonfigurationAusEnv(), tmdbId);
        } catch {
          pfade = [];
        }
      }
      if (pfade.length === 0) {
        res.status(404).json({ error: "Nicht in der Mediathek" });
        return;
      }

      res.json({
        tmdb_id: tmdbId,
        dateien: pfade.map((pfad) => ({
          // Ein Altbestand-Pfad ohne das Bibliotheks-Präfix wird für die
          // Wiedergabe aufgelöst, damit der Player eine existierende Datei sieht.
          pfad,
          ziele: bauePlayUrls(resolveMediaFile(mediaDir, pfad, prefixes) ?? pfad),
        })),
      });
    })
  );

  return router;
}
