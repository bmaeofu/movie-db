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

describe("Actor-Bilder", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("redirectet bei http(s)-Bildquellen", async () => {
    db.prepare("INSERT INTO actors (name, bild) VALUES ('Leo', 'https://image.tmdb.org/t/p/original/x.jpg')").run();
    const res = await request(app).get("/api/actors/Leo/image");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://image.tmdb.org/t/p/original/x.jpg");
  });

  it("liefert lokale Bilder aus dem Medien-Ordner", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fdb-media-"));
    writeFileSync(path.join(dir, "test.jpg"), "bildinhalt");
    const spaApp = createApp(db, fakeTmdb, { mediaDir: dir });
    db.prepare("INSERT INTO actors (name, bild) VALUES ('Test Person', '/media/test.jpg')").run();
    const res = await request(spaApp).get("/api/actors/Test%20Person/image");
    expect(res.status).toBe(200);
    expect(res.text).toBe("bildinhalt");
  });

  it("404 für unbekannte Schauspieler und unbekannte Bildquelle", async () => {
    expect((await request(app).get("/api/actors/GibtsNicht/image")).status).toBe(404);
    db.prepare("INSERT INTO actors (name, bild) VALUES ('X', 'relativer-pfad')").run();
    expect((await request(app).get("/api/actors/X/image")).status).toBe(404);
  });
});
