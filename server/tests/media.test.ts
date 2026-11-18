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
import { asUser } from "./helpers.js";

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
  let anna: Record<string, string>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "media-"));
    mkdirSync(join(dir, "FilmeHD3"), { recursive: true });
    mkdirSync(join(dir, "KrimiHD"), { recursive: true });
    writeFileSync(join(dir, "FilmeHD3", "Film-poster.jpg"), "poster-inhalt");
    writeFileSync(join(dir, "KrimiHD", "Uhrwerk Orange-poster.jpg"), "krimi-poster");
    writeFileSync(join(dir, "FilmeHD3", "Film.mkv"), "videoinhalt");

    db = createDb(":memory:");
    app = createApp(db, fakeTmdb, { mediaDir: dir });
    anna = asUser({ id: "sub-anna", name: "Anna" });
  });

  it("liefert Bilder nur mit gültiger Sitzung", async () => {
    expect((await request(app).get("/media/FilmeHD3/Film-poster.jpg")).status).toBe(401);
    const mit = await request(app).get("/media/FilmeHD3/Film-poster.jpg").set(anna);
    expect(mit.status).toBe(200);
    expect(String(mit.body)).toBe("poster-inhalt");
  });

  it("liefert auch Bilder aus anderen Unterordnern", async () => {
    const res = await request(app).get("/media/KrimiHD/Uhrwerk%20Orange-poster.jpg").set(anna);
    expect(res.status).toBe(200);
    expect(String(res.body)).toBe("krimi-poster");
  });

  it("liefert keine Videodateien aus", async () => {
    const res = await request(app).get("/media/FilmeHD3/Film.mkv").set(anna);
    expect(res.status).toBe(404);
  });

  it("antwortet bei fehlender Datei mit 404 statt mit der SPA", async () => {
    const res = await request(app).get("/media/FilmeHD3/GibtsNicht.jpg").set(anna);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Nicht gefunden" });
  });

  it("findet ein Kodi-Poster unter dem Bibliotheks-Präfix", async () => {
    // Kodi schreibt "/media/KrimiHD/…", im Container liegt es unter "/media/tv/…".
    const praefix = mkdtempSync(join(tmpdir(), "media-prefix-"));
    mkdirSync(join(praefix, "KrimiHD"), { recursive: true });
    writeFileSync(join(praefix, "KrimiHD", "Uhrwerk Orange-poster.jpg"), "krimi-poster");
    const mitPraefix = createApp(db, fakeTmdb, { mediaDir: join(praefix, "leer"), mediaPrefixes: [praefix] });
    const res = await request(mitPraefix)
      .get("/media/KrimiHD/Uhrwerk%20Orange-poster.jpg")
      .set(anna);
    expect(res.status).toBe(200);
    expect(String(res.body)).toBe("krimi-poster");
  });
});

