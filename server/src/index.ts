import path from "node:path";
import { createApp } from "./app.js";
import { createDb } from "./db.js";
import { createTmdbClient } from "./tmdb.js";

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) {
  console.error("FEHLER: TMDB_API_KEY ist nicht gesetzt. Abbruch.");
  process.exit(1);
}

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "filmdatenbank.db");
const db = createDb(dbPath);
const tmdb = createTmdbClient({ apiKey });
const clientDistDir = path.join(process.cwd(), "..", "client", "dist");

const app = createApp(db, tmdb, { clientDistDir });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Filmdatenbank läuft auf http://localhost:${port}`);
});
