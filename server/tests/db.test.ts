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
    for (const t of ["users", "movies", "collection", "lists", "list_items", "search_cache", "actors"]) {
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
    for (const c of ["land", "regisseure", "autoren", "cast", "source"]) {
      expect(cols).toContain(c);
    }
  });

  it("migriert die Anbieter-Verknüpfung der Nutzer nach", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fdb-migration-"));
    const dbPath = path.join(dir, "test.db");
    const dbAlt = createDb(dbPath);
    dbAlt.prepare("INSERT INTO users (name, password_hash) VALUES ('Anna', '!')").run();
    dbAlt.close();

    const db = createDb(dbPath);
    const spalten = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    expect(spalten.map((s) => s.name)).toContain("oidc_sub");
    const indizes = db.prepare("PRAGMA index_list(users)").all() as { name: string; unique: number }[];
    expect(indizes.find((i) => i.name === "users_oidc_sub")?.unique).toBe(1);

    // Mehrere Nutzer ohne Anbieter-Verknüpfung sind erlaubt, doppelte Werte nicht
    db.prepare("INSERT INTO users (name, password_hash) VALUES ('Ben', '!')").run();
    expect(db.prepare("SELECT COUNT(*) n FROM users WHERE oidc_sub IS NULL").get()).toEqual({ n: 2 });
    db.prepare("UPDATE users SET oidc_sub = 'sub-a' WHERE name = 'Anna'").run();
    expect(() => db.prepare("UPDATE users SET oidc_sub = 'sub-a' WHERE name = 'Ben'").run()).toThrow(/UNIQUE/);
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
    expect(userId).toBeGreaterThan(0);
  });
});
