import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS movies (
      tmdb_id INTEGER PRIMARY KEY,
      titel TEXT NOT NULL,
      jahr INTEGER,
      medientyp TEXT NOT NULL CHECK (medientyp IN ('film','serie')),
      genres TEXT NOT NULL DEFAULT '[]',
      poster_url TEXT,
      overview TEXT,
      tmdb_json TEXT NOT NULL,
      tmdb_bewertung REAL,
      tmdb_stimmen INTEGER,
      imdb_bewertung REAL,
      imdb_stimmen INTEGER,
      source TEXT NOT NULL DEFAULT 'user',
      datei_pfade TEXT NOT NULL DEFAULT '[]',
      tmdb_fehler TEXT,
      zuletzt_aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection (
      tmdb_id INTEGER PRIMARY KEY REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS list_items (
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      query TEXT PRIMARY KEY,
      tmdb_json TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS actors (
      name TEXT PRIMARY KEY,
      bild TEXT NOT NULL,
      zuletzt_aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(db, "movies", "land", "land TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "regisseure", "regisseure TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "autoren", "autoren TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "cast", "cast TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "tmdb_bewertung", "tmdb_bewertung REAL");
  ensureColumn(db, "movies", "tmdb_stimmen", "tmdb_stimmen INTEGER");
  ensureColumn(db, "movies", "imdb_bewertung", "imdb_bewertung REAL");
  ensureColumn(db, "movies", "imdb_stimmen", "imdb_stimmen INTEGER");
  ensureColumn(db, "movies", "source", "source TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "movies", "laufzeit_minuten", "laufzeit_minuten INTEGER");
  ensureColumn(db, "movies", "datei_pfade", "datei_pfade TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "tmdb_fehler", "tmdb_fehler TEXT");
  // Nutzerdaten (Bewertungen, Watch-Status, Notizen) liegen in der
  // Hauptanwendung; hier bleiben nur die Stammdaten des Nutzers fuer Listen und
  // `collection.added_by`, verknuepft ueber die Identitaet des Anbieters.
  ensureColumn(db, "users", "oidc_sub", "oidc_sub TEXT");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_sub ON users(oidc_sub)"
  );
  db.exec(`
    DROP TABLE IF EXISTS ratings;
    DROP TABLE IF EXISTS watch_status;
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS sessions;
  `);
}

/** Fügt eine Spalte hinzu, falls sie fehlt (Migration für Bestands-DBs). */
function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function createDb(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}
