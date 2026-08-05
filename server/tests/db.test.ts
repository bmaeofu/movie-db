import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, initSchema } from "../src/db.js";

describe("Datenbankschema", () => {
  it("legt alle Tabellen an", () => {
    const db = createDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r: any) => r.name);
    for (const t of ["users", "movies", "collection", "ratings", "watch_status", "notes", "sessions", "lists", "list_items", "search_cache"]) {
      expect(tables).toContain(t);
    }
  });

  it("ist idempotent (mehrfaches initSchema wirft nicht)", () => {
    const db = createDb(":memory:");
    expect(() => initSchema(db)).not.toThrow();
  });

  it("enthält die Detail-Spalten (land, regisseure, autoren, cast)", () => {
    const db = createDb(":memory:");
    const cols = db
      .prepare("PRAGMA table_info(movies)")
      .all()
      .map((c: any) => c.name);
    for (const c of ["land", "regisseure", "autoren", "cast"]) {
      expect(cols).toContain(c);
    }
  });

  it("aktiviert WAL und Foreign Keys", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fdb-"));
    const db = createDb(path.join(dir, "test.db"));
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("durchsetzt die CHECK-Constraints", () => {
    const db = createDb(":memory:");
    const userId = Number(
      db.prepare("INSERT INTO users (name, password_hash) VALUES ('Anna', 'x')").run().lastInsertRowid
    );
    db.prepare("INSERT INTO movies (tmdb_id, titel, medientyp, tmdb_json) VALUES (27205, 'Inception', 'film', '{}')").run();
    expect(() =>
      db.prepare("INSERT INTO movies (tmdb_id, titel, medientyp, tmdb_json) VALUES (1, 'X', 'doku', '{}')").run()
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.prepare("INSERT INTO ratings (user_id, tmdb_id, sterne) VALUES (?, 27205, 6)").run(userId)
    ).toThrow(/CHECK constraint failed/);
  });
});
