import { Router } from "express";
import type Database from "better-sqlite3";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { fetchKodiDateien, kodiKonfigurationAusEnv } from "../kodiSync.js";
import { bauePlayUrls } from "../playback.js";

const STATUS_VALUES = ["neu", "schauen", "gesehen", "kein_interesse"] as const;

export function createMovieRouter(db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.put(
    "/:tmdbId/rating",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const sterne = (req.body ?? {}).sterne;
      if (!Number.isInteger(tmdbId) || !Number.isInteger(sterne) || sterne < 1 || sterne > 5) {
        res.status(400).json({ error: "sterne (Integer 1–5) erforderlich" });
        return;
      }
      const movieExists = db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ?").get(tmdbId);
      if (!movieExists) {
        res.status(404).json({ error: "Film nicht gefunden" });
        return;
      }
      const user = (req as AuthedRequest).user;
      db.prepare(
        `INSERT INTO ratings (user_id, tmdb_id, sterne, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, tmdb_id) DO UPDATE SET sterne = excluded.sterne, updated_at = datetime('now')`
      ).run(user.id, tmdbId, sterne);
      res.status(204).end();
    })
  );

  router.put(
    "/:tmdbId/watch-status",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const status = (req.body ?? {}).status;
      if (!Number.isInteger(tmdbId) || !STATUS_VALUES.includes(status)) {
        res.status(400).json({ error: "status ('neu'|'schauen'|'gesehen'|'kein_interesse') erforderlich" });
        return;
      }
      const movieExists = db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ?").get(tmdbId);
      if (!movieExists) {
        res.status(404).json({ error: "Film nicht gefunden" });
        return;
      }
      const user = (req as AuthedRequest).user;
      db.prepare(
        `INSERT INTO watch_status (user_id, tmdb_id, status) VALUES (?, ?, ?)
         ON CONFLICT(user_id, tmdb_id) DO UPDATE SET status = excluded.status`
      ).run(user.id, tmdbId, status);
      res.status(204).end();
    })
  );

  router.put(
    "/:tmdbId/note",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const text = (req.body ?? {}).text;
      if (!Number.isInteger(tmdbId) || typeof text !== "string" || text.trim().length === 0) {
        res.status(400).json({ error: "text (nicht leer) erforderlich" });
        return;
      }
      const movieExists = db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ?").get(tmdbId);
      if (!movieExists) {
        res.status(404).json({ error: "Film nicht gefunden" });
        return;
      }
      const user = (req as AuthedRequest).user;
      db.prepare(
        `INSERT INTO notes (user_id, tmdb_id, text, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, tmdb_id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`
      ).run(user.id, tmdbId, text.trim());
      res.status(204).end();
    })
  );

  router.delete(
    "/:tmdbId/note",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const user = (req as AuthedRequest).user;
      db.prepare("DELETE FROM notes WHERE user_id = ? AND tmdb_id = ?").run(user.id, tmdbId);
      res.status(204).end();
    })
  );

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
        dateien: pfade.map((pfad) => ({ pfad, ziele: bauePlayUrls(pfad) })),
      });
    })
  );

  return router;
}
