import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import { ensureUser } from "./users.js";

export interface AuthedRequest extends Request {
  user: { id: number; name: string; is_admin: number };
}

/**
 * Die Anmeldung passiert in der Hauptanwendung, die diesen Dienst nur über das
 * interne Netz erreicht und die Identität als Kopfzeilen mitgibt. Ein Aufruf
 * ohne `x-user-id` kommt nicht von dort und wird abgewiesen.
 */
export function requireTrustedUser(db: Database.Database) {
  const adminGroup = (process.env.ADMIN_GROUP ?? "rc-timercontrol-admins").toLowerCase();
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = String(req.header("x-user-id") ?? "").trim();
    if (!id) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    const groups = String(req.header("x-user-groups") ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    (req as AuthedRequest).user = ensureUser(
      db,
      {
        id,
        name: String(req.header("x-user-name") ?? "").trim(),
        email: String(req.header("x-user-email") ?? "").trim(),
        groups,
      },
      groups.includes(adminGroup)
    );
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
