import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import { findSessionUser, SESSION_COOKIE } from "./sessions.js";

export interface AuthedRequest extends Request {
  user: { id: number; name: string; is_admin: number };
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function requireAuth(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const user = token ? findSessionUser(db, token) : null;
    if (!user) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user.is_admin) {
    res.status(403).json({ error: "Nur für Admins" });
    return;
  }
  next();
}

export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}
