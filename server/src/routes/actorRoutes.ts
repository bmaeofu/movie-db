import { Router } from "express";
import type Database from "better-sqlite3";

/**
 * Öffentlicher Bild-Endpoint für Schauspieler-Fotos.
 * bild-Quellen in `actors`:
 *  - http(s)://…  → Redirect auf die externe URL (z. B. TMDB)
 *  - /media/…     → lokale Datei im gemounteten Medien-Ordner (read-only)
 */
export function createActorRouter(db: Database.Database, mediaDir: string): Router {
  const router = Router();

  router.get("/:name/image", (req, res) => {
    const row = db.prepare("SELECT bild FROM actors WHERE name = ?").get(req.params.name) as
      | { bild: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Schauspieler nicht gefunden" });
      return;
    }
    if (row.bild.startsWith("http://") || row.bild.startsWith("https://")) {
      res.redirect(row.bild);
      return;
    }
    if (row.bild.startsWith("/media/")) {
      const file = mediaDir + row.bild.slice("/media".length);
      res.sendFile(file, (err) => {
        if (err) {
          res.status(404).json({ error: "Bild nicht gefunden" });
        }
      });
      return;
    }
    res.status(404).json({ error: "Unbekannte Bildquelle" });
  });

  return router;
}
