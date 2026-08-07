import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { TmdbClient } from "./tmdb.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createUserRouter } from "./routes/userRoutes.js";
import { createAdminRouter } from "./routes/adminRoutes.js";
import type { OmdbClient } from "./omdb.js";
import { createSearchRouter } from "./routes/searchRoutes.js";
import { createCollectionRouter } from "./routes/collectionRoutes.js";
import { createMovieRouter } from "./routes/movieRoutes.js";
import { createListRouter } from "./routes/listRoutes.js";
import { createActorRouter } from "./routes/actorRoutes.js";

export interface AppOptions {
  clientDistDir?: string;
  omdb?: OmdbClient;
  /** Basis-Ordner der gemounteten Medien (Read-only); Standard '/media' */
  mediaDir?: string;
}

export function createApp(db: Database.Database, tmdb: TmdbClient, options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use("/api/auth", createAuthRouter(db));
  app.use("/api/users", createUserRouter(db));
  app.use("/api/admin", createAdminRouter(db, tmdb, options.omdb));
  app.use("/api/search", createSearchRouter(db, tmdb));
  app.use("/api/collection", createCollectionRouter(db, tmdb, options.omdb));
  app.use("/api/movies", createMovieRouter(db));
  app.use("/api/lists", createListRouter(db));
  app.use("/api/actors", createActorRouter(db, options.mediaDir ?? "/media"));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unbekannter API-Endpunkt" });
  });

  const distDir = options.clientDistDir;
  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

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
