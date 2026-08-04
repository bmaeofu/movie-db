import { describe, expect, it } from "vitest";
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
});
