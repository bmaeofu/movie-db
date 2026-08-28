import path from "node:path";
import fs from "node:fs";
import { createApp } from "./app.js";
import { createDb } from "./db.js";
import { createOmdbClient } from "./omdb.js";
import { createTmdbClient } from "./tmdb.js";

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) {
  console.error("FEHLER: TMDB_API_KEY ist nicht gesetzt. Abbruch.");
  process.exit(1);
}

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "filmdatenbank.db");
const dataDir = path.dirname(dbPath);

// Unraid-User-Scripts (im Image unter /app/scripts) in den persistenten Datenordner kopieren,
// damit ein User-Script nur noch die feste Datei unter /data aufruft (Updates kommen mit jedem Deploy).
function copyScripts(): void {
  const srcDir = "/app/scripts";
  if (!fs.existsSync(srcDir)) return;
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith(".py")) continue;
    const src = path.join(srcDir, file);
    try {
      fs.copyFileSync(src, path.join(dataDir, file));
      // 666: damit das SMB-Backup-/Kopier-Script (Host-Benutzer) die Dateien überschreiben kann
      fs.chmodSync(path.join(dataDir, file), 0o666);
    } catch (err) {
      console.error(`Skript ${file} konnte nicht nach /data kopiert werden:`, err);
    }
  }
}
copyScripts();

const db = createDb(dbPath);
const tmdb = createTmdbClient({ apiKey });
const omdb = process.env.OMDB_API_KEY ? createOmdbClient({ apiKey: process.env.OMDB_API_KEY }) : undefined;
const clientDistDir = path.join(process.cwd(), "..", "client", "dist");

const app = createApp(db, tmdb, { clientDistDir, omdb, mediaDir: process.env.MEDIA_DIR ?? "/media" });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Filmdatenbank läuft auf http://localhost:${port}`);
});
