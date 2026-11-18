import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { TmdbClient } from "./tmdb.js";
import { createAdminRouter } from "./routes/adminRoutes.js";
import type { OmdbClient } from "./omdb.js";
import { AuthedRequest, requireTrustedUser } from "./middleware.js";
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
  /** Weitere Wurzeln, unter denen ein Kodi-Pfad liegen kann (Standard: MEDIA_PATH_PREFIX). */
  mediaPrefixes?: string[];
}

export function createApp(db: Database.Database, tmdb: TmdbClient, options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  // Jede Anfrage kommt von der Hauptanwendung, die die Identität mitgibt; ein
  // Aufruf ohne sie stammt nicht von dort. Der Datensatz entsteht beim ersten
  // Kontakt, damit Listen und Sammlung einen Besitzer haben.
  app.use(requireTrustedUser(db));

  app.get("/api/auth/status", (_req, res) => {
    res.json({ needsBootstrap: false });
  });

  app.get("/api/auth/me", (req, res) => {
    const user = (req as AuthedRequest).user;
    res.json({ id: user.id, name: user.name, is_admin: user.is_admin });
  });

  app.use("/api/admin", createAdminRouter(db, tmdb, options.omdb));
  app.use("/api/search", createSearchRouter(db, tmdb));
  const mediaDir = options.mediaDir ?? "/media";
  app.use("/api/collection", createCollectionRouter(db, tmdb, options.omdb, mediaDir));
  app.use("/api/movies", createMovieRouter(db));
  app.use("/api/lists", createListRouter(db));
  app.use("/api/actors", createActorRouter(db, mediaDir));
  // Lokale Kodi-Poster (smb-Pfad → /media/…) aus dem gemounteten Medien-Ordner.
  // Nur mit Sitzung und nur Bilddateien – der Mount kann die gesamte Medienablage umfassen.
  const BILD_ENDUNGEN = new Set([".jpg", ".jpeg", ".png", ".webp", ".tbn"]);
  // Kodi schreibt seine Pfade ab seiner Mount-Wurzel ("/media/KrimiHD/…"), im
  // Container liegen dieselben Dateien unter einem anderen Präfix
  // ("/media/tv/KrimiHD/…"). Ohne den Rückgriff fehlten die Poster der
  // Kodi-Einträge, weil der direkte Pfad dort nicht existiert.
  const medienPraefixe =
    options.mediaPrefixes ??
    (process.env.MEDIA_PATH_PREFIX ?? "/media/tv")
    .split(",")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean);

  function medienDatei(angefordert: string): string | null {
    const rest = angefordert.replace(/^\/+/, "");
    const direkt = path.join(mediaDir, rest);
    if (fs.existsSync(direkt)) return direkt;
    for (const praefix of medienPraefixe) {
      const kandidat = path.join(praefix, rest);
      if (fs.existsSync(kandidat)) return kandidat;
    }
    return null;
  }

  app.use(
    "/media",
    (req: Request, res: Response, next: NextFunction) => {
      let pfad = "";
      try {
        pfad = decodeURIComponent(req.path);
      } catch {
        res.status(404).json({ error: "Nicht gefunden" });
        return;
      }
      if (!BILD_ENDUNGEN.has(path.extname(pfad).toLowerCase())) {
        res.status(404).json({ error: "Nicht gefunden" });
        return;
      }
      const datei = medienDatei(pfad);
      if (datei === null) {
        res.status(404).json({ error: "Nicht gefunden" });
        return;
      }
      res.sendFile(datei);
    }
  );

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
