import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "./tmdb.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createSearchRouter } from "./routes/searchRoutes.js";
import { createCollectionRouter } from "./routes/collectionRoutes.js";

export interface AppOptions {
  clientDistDir?: string;
}

export function createApp(db: Database.Database, tmdb: TmdbClient, options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use("/api/auth", createAuthRouter(db));
  app.use("/api/search", createSearchRouter(db, tmdb));
  app.use("/api/collection", createCollectionRouter(db, tmdb));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unbekannter API-Endpunkt" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: "Ungültiges JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Interner Serverfehler" });
  });

  return app;
}
