import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "fdb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 Tage

export function createSession(db: Database.Database, userId: number): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return token;
}

export function deleteSession(db: Database.Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function findSessionUser(
  db: Database.Database,
  token: string
): { id: number; name: string; is_admin: number } | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > strftime('%s','now')`
    )
    .get(token) as { id: number; name: string; is_admin: number } | undefined;
  return row ?? null;
}
