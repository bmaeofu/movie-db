import { Router } from "express";
import type Database from "better-sqlite3";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { listMovieViews } from "../queries.js";

export function createListRouter(db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth(db));

  function requireOwner(req: AuthedRequest, listId: number): boolean {
    const row = db.prepare("SELECT owner_id FROM lists WHERE id = ?").get(listId) as { owner_id: number } | undefined;
    if (!row) return false;
    return row.owner_id === req.user.id;
  }

  router.get("/", (req, res) => {
    const user = (req as AuthedRequest).user;
    const lists = db
      .prepare(
        `SELECT l.id, l.name, COUNT(li.tmdb_id) AS item_count
         FROM lists l LEFT JOIN list_items li ON li.list_id = l.id
         WHERE l.owner_id = ?
         GROUP BY l.id ORDER BY MAX(l.created_at) DESC`
      )
      .all(user.id);
    res.json(lists);
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const name = (req.body ?? {}).name;
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name (nicht leer) erforderlich" });
        return;
      }
      const user = (req as AuthedRequest).user;
      const info = db.prepare("INSERT INTO lists (owner_id, name) VALUES (?, ?)").run(user.id, name.trim());
      res.status(201).json({ id: Number(info.lastInsertRowid), name: name.trim() });
    })
  );

  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      const name = (req.body ?? {}).name;
      if (!Number.isInteger(listId) || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name (nicht leer) erforderlich" });
        return;
      }
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf die Liste ändern" });
        return;
      }
      db.prepare("UPDATE lists SET name = ? WHERE id = ?").run(name.trim(), listId);
      res.status(204).end();
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf die Liste löschen" });
        return;
      }
      db.prepare("DELETE FROM lists WHERE id = ?").run(listId);
      res.status(204).end();
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf die Liste sehen" });
        return;
      }
      const list = db.prepare("SELECT id, name FROM lists WHERE id = ?").get(listId) as { id: number; name: string };
      const items = listMovieViews(
        db,
        (req as AuthedRequest).user.id,
        "FROM list_items li LEFT JOIN collection c ON c.tmdb_id = li.tmdb_id LEFT JOIN users u ON u.id = c.added_by JOIN movies m ON m.tmdb_id = li.tmdb_id",
        ["li.list_id = @listId"],
        { listId },
        "li.tmdb_id ASC"
      );
      res.json({ ...list, items });
    })
  );

  router.post(
    "/:id/items",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      const tmdbId = (req.body ?? {}).tmdb_id;
      if (!Number.isInteger(listId) || !Number.isInteger(tmdbId)) {
        res.status(400).json({ error: "tmdb_id (Integer) erforderlich" });
        return;
      }
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf Items hinzufügen" });
        return;
      }
      const movieExists = db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ?").get(tmdbId);
      if (!movieExists) {
        res.status(400).json({ error: "Film ist nicht in der Sammlung" });
        return;
      }
      const info = db.prepare("INSERT OR IGNORE INTO list_items (list_id, tmdb_id) VALUES (?, ?)").run(listId, tmdbId);
      res.status(info.changes > 0 ? 201 : 200).json({ message: "ok" });
    })
  );

  router.delete(
    "/:id/items/:tmdbId",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      const tmdbId = Number(req.params.tmdbId);
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf Items entfernen" });
        return;
      }
      db.prepare("DELETE FROM list_items WHERE list_id = ? AND tmdb_id = ?").run(listId, tmdbId);
      res.status(204).end();
    })
  );

  return router;
}
