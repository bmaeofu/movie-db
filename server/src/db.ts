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
      zuletzt_aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection (
      tmdb_id INTEGER PRIMARY KEY REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ratings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      sterne INTEGER NOT NULL CHECK (sterne BETWEEN 1 AND 5),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS watch_status (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('schauen','gesehen','kein_interesse')),
      PRIMARY KEY (user_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS notes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at INTEGER NOT NULL
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
  `);

  ensureColumn(db, "movies", "land", "land TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "regisseure", "regisseure TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "autoren", "autoren TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "movies", "cast", "cast TEXT NOT NULL DEFAULT '[]'");
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
