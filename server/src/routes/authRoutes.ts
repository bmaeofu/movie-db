import { Router } from "express";
import type Database from "better-sqlite3";
import { hashPassword, verifyPassword } from "../passwords.js";
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE } from "../sessions.js";
import { asyncHandler, AuthedRequest, parseCookies, requireAuth } from "../middleware.js";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users");

  router.get("/status", (_req, res) => {
    res.json({ needsBootstrap: (userCount.get() as { n: number }).n === 0 });
  });

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const isBootstrap = (userCount.get() as { n: number }).n === 0;
      if (!isBootstrap) {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies[SESSION_COOKIE];
        const admin = token ? findSessionUser(db, token) : null;
        if (!admin) {
          res.status(401).json({ error: "Nicht angemeldet" });
          return;
        }
        if (!admin.is_admin) {
          res.status(403).json({ error: "Nur für Admins" });
          return;
        }
      }
      const { name, password } = (req.body ?? {}) as { name?: unknown; password?: unknown };
      if (typeof name !== "string" || name.trim().length < 2) {
        res.status(400).json({ error: "Name muss mindestens 2 Zeichen haben" });
        return;
      }
      if (typeof password !== "string" || password.length < 6) {
        res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
        return;
      }
      const trimmed = name.trim();
      const existing = db.prepare("SELECT id FROM users WHERE name = ?").get(trimmed);
      if (existing) {
        res.status(409).json({ error: "Name ist bereits vergeben" });
        return;
      }
      const info = db
        .prepare("INSERT INTO users (name, password_hash, is_admin) VALUES (?, ?, ?)")
        .run(trimmed, hashPassword(password), isBootstrap ? 1 : 0);
      const userId = Number(info.lastInsertRowid);
      // Neue Benutzer sehen alle vorhandenen Filme als 'neu' (bei Bootstrap: Sammlung leer → no-op)
      db.prepare("INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT ?, tmdb_id, 'neu' FROM collection").run(userId);
      if (isBootstrap) {
        const token = createSession(db, userId);
        res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
      }
      res.status(201).json({ id: userId, name: trimmed, is_admin: isBootstrap ? 1 : 0 });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { name, password } = (req.body ?? {}) as { name?: unknown; password?: unknown };
      const user =
        typeof name === "string"
          ? (db.prepare("SELECT * FROM users WHERE name = ?").get(name.trim()) as
              | { id: number; name: string; password_hash: string; is_admin: number }
              | undefined)
          : undefined;
      if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: "Name oder Passwort falsch" });
        return;
      }
      const token = createSession(db, user.id);
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
      res.json({ id: user.id, name: user.name, is_admin: user.is_admin });
    })
  );

  router.post("/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  router.put(
    "/password",
    requireAuth(db),
    asyncHandler(async (req, res) => {
      const { altes_password, neues_password } = (req.body ?? {}) as {
        altes_password?: unknown;
        neues_password?: unknown;
      };
      const user = (req as AuthedRequest).user;
      const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as {
        password_hash: string;
      };
      if (typeof altes_password !== "string" || !verifyPassword(altes_password, row.password_hash)) {
        res.status(401).json({ error: "Altes Passwort ist falsch" });
        return;
      }
      if (typeof neues_password !== "string" || neues_password.length < 6) {
        res.status(400).json({ error: "Neues Passwort muss mindestens 6 Zeichen haben" });
        return;
      }
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(neues_password), user.id);
      const cookies = parseCookies(req.headers.cookie);
      const currentToken = cookies[SESSION_COOKIE];
      if (currentToken) {
        db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(user.id, currentToken);
      }
      res.status(204).end();
    })
  );

  router.get("/me", requireAuth(db), (req, res) => {
    const u = (req as AuthedRequest).user;
    res.json({ id: u.id, name: u.name, is_admin: u.is_admin });
  });

  return router;
}
