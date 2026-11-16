import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import type { Express } from "express";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";
import { asUser } from "./helpers.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async () => {
    throw new Error("nicht benutzt");
  },
};

describe("Actor-Bilder", () => {
  let db: Database.Database;
  let app: Express;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("redirectet bei http(s)-Bildquellen", async () => {
    db.prepare("INSERT INTO actors (name, bild) VALUES ('Leo', 'https://image.tmdb.org/t/p/original/x.jpg')").run();
    const res = await request(app).get("/api/actors/Leo/image").set(asUser());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://image.tmdb.org/t/p/original/x.jpg");
  });

  it("liefert lokale Bilder aus dem Medien-Ordner", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fdb-media-"));
    writeFileSync(path.join(dir, "test.jpg"), "bildinhalt");
    const spaApp = createApp(db, fakeTmdb, { mediaDir: dir });
    db.prepare("INSERT INTO actors (name, bild) VALUES ('Test Person', '/media/test.jpg')").run();
    const res = await request(spaApp).get("/api/actors/Test%20Person/image").set(asUser());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.body.toString("utf8")).toBe("bildinhalt");
  });

  it("404 für unbekannte Schauspieler und unbekannte Bildquelle", async () => {
    expect((await request(app).get("/api/actors/GibtsNicht/image").set(asUser())).status).toBe(404);
    db.prepare("INSERT INTO actors (name, bild) VALUES ('X', 'relativer-pfad')").run();
    expect((await request(app).get("/api/actors/X/image").set(asUser())).status).toBe(404);
  });
});
