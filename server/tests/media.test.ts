import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId, medientyp) => ({
    tmdb_id: tmdbId,
    titel: "Testfilm",
    jahr: 2020,
    medientyp,
    genres: [],
    poster_url: null,
    overview: null,
    land: [],
    regisseure: [],
    autoren: [],
    cast: [],
    imdb_id: null,
    tmdb_bewertung: null,
    tmdb_stimmen: 0,
    laufzeit_minuten: null,
  }),
};

describe("Medien-Dateien", () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "media-"));
    mkdirSync(join(dir, "FilmeHD3"), { recursive: true });
    mkdirSync(join(dir, "KrimiHD"), { recursive: true });
    writeFileSync(join(dir, "FilmeHD3", "Film-poster.jpg"), "poster-inhalt");
    writeFileSync(join(dir, "KrimiHD", "Uhrwerk Orange-poster.jpg"), "krimi-poster");
    writeFileSync(join(dir, "FilmeHD3", "Film.mkv"), "videoinhalt");

    db = createDb(":memory:");
    app = createApp(db, fakeTmdb, { mediaDir: dir });
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    cookie = admin.headers["set-cookie"][0].split(";")[0];
  });

  it("liefert Bilder nur mit gültiger Sitzung", async () => {
    expect((await request(app).get("/media/FilmeHD3/Film-poster.jpg")).status).toBe(401);
    const mit = await request(app).get("/media/FilmeHD3/Film-poster.jpg").set("Cookie", cookie);
    expect(mit.status).toBe(200);
    expect(String(mit.body)).toBe("poster-inhalt");
  });

  it("liefert auch Bilder aus anderen Unterordnern", async () => {
    const res = await request(app).get("/media/KrimiHD/Uhrwerk%20Orange-poster.jpg").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(String(res.body)).toBe("krimi-poster");
  });

  it("liefert keine Videodateien aus", async () => {
    const res = await request(app).get("/media/FilmeHD3/Film.mkv").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
