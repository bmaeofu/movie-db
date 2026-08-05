import { Router } from "express";
import type Database from "better-sqlite3";
import { hashPassword } from "../passwords.js";
import { asyncHandler, AuthedRequest, requireAdmin, requireAuth } from "../middleware.js";

export function createUserRouter(db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth(db), requireAdmin);

  const adminCount = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1").get() as { n: number }).n;

  router.get("/", (_req, res) => {
    const users = db.prepare("SELECT id, name, is_admin, created_at FROM users ORDER BY name").all();
    res.json(users);
  });

  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const targetId = Number(req.params.id);
      if (!Number.isInteger(targetId)) {
        res.status(400).json({ error: "id (Integer) erforderlich" });
        return;
      }
      const target = db.prepare("SELECT id, name, is_admin FROM users WHERE id = ?").get(targetId) as
        | { id: number; name: string; is_admin: number }
        | undefined;
      if (!target) {
        res.status(404).json({ error: "Nutzer nicht gefunden" });
        return;
      }
      const { name, password, is_admin } = (req.body ?? {}) as {
        name?: unknown;
        password?: unknown;
        is_admin?: unknown;
      };

      // Erst alle Validierungen, dann anwenden (keine Teil-Updates)
      if (password !== undefined && (typeof password !== "string" || password.length < 6)) {
        res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
        return;
      }
      if (name !== undefined && (typeof name !== "string" || name.trim().length < 2)) {
        res.status(400).json({ error: "Name muss mindestens 2 Zeichen haben" });
        return;
      }
      const trimmedName = typeof name === "string" ? name.trim() : undefined;
      if (trimmedName !== undefined) {
        const existing = db.prepare("SELECT id FROM users WHERE name = ? AND id != ?").get(trimmedName, targetId);
        if (existing) {
          res.status(409).json({ error: "Name ist bereits vergeben" });
          return;
        }
      }
      if (is_admin !== undefined && target.is_admin === 1 && !is_admin && adminCount() === 1) {
        res.status(400).json({ error: "Der letzte Admin kann sein Admin-Recht nicht verlieren" });
        return;
      }

      if (password !== undefined) {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password as string), targetId);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
      }
      if (trimmedName !== undefined) {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(trimmedName, targetId);
      }
      if (is_admin !== undefined) {
        db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(is_admin ? 1 : 0, targetId);
      }
      res.status(204).end();
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const targetId = Number(req.params.id);
      if (!Number.isInteger(targetId)) {
        res.status(400).json({ error: "id (Integer) erforderlich" });
        return;
      }
      const me = (req as AuthedRequest).user;
      if (targetId === me.id) {
        res.status(400).json({ error: "Du kannst dich nicht selbst löschen" });
        return;
      }
      const target = db.prepare("SELECT id, is_admin FROM users WHERE id = ?").get(targetId) as
        | { id: number; is_admin: number }
        | undefined;
      if (!target) {
        res.status(404).json({ error: "Nutzer nicht gefunden" });
        return;
      }
      if (target.is_admin === 1 && adminCount() === 1) {
        res.status(400).json({ error: "Der letzte Admin kann nicht gelöscht werden" });
        return;
      }
      db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
      res.status(204).end();
    })
  );

  return router;
}
