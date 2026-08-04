import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async () => {
    throw new Error("nicht benutzt");
  },
};

describe("App-Assembly", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("unbekannter API-Pfad → 404 als JSON", async () => {
    const res = await request(app).get("/api/gibtsnicht");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unbekannter API-Endpunkt" });
  });

  it("kaputtes JSON → 400", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{kaputt");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ungültiges JSON");
  });

  it("liefert die SPA aus clientDistDir aus", () => {
    const dist = mkdtempSync(path.join(tmpdir(), "fdb-dist-"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Filmdatenbank</title>");
    const spaApp = createApp(db, fakeTmdb, { clientDistDir: dist });
    return request(spaApp)
      .get("/")
      .expect(200)
      .expect("Content-Type", /html/)
      .expect((res) => {
        if (!res.text.includes("Filmdatenbank")) throw new Error("index.html nicht ausgeliefert");
      });
  });
});
