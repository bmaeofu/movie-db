import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import type { Express } from "express";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";
import { asUser } from "./helpers.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie> => ({
    tmdb_id: tmdbId,
    titel: "Inception",
    jahr: 2010,
    medientyp,
    genres: ["Action"],
    poster_url: null,
    overview: "Traum",
    land: [],
    regisseure: [],
    autoren: [],
    cast: [],
    imdb_id: null,
    tmdb_bewertung: null,
    tmdb_stimmen: 0,
  }),
};

describe("Wiedergabe", () => {
  let db: Database.Database;
  let app: Express;
  let anna: Record<string, string>;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    anna = asUser({ id: "sub-anna", name: "Anna" });
    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 27205, medientyp: "film" });
  });

  it("play: liefert Dateien mit Ziel-URLs, 404 ohne Mediathek-Eintrag", async () => {
    db.prepare("UPDATE movies SET datei_pfade = ? WHERE tmdb_id = 27205").run(
      JSON.stringify(["/media/tv/FilmeHD3/Inception.mkv"])
    );
    const ok = await request(app).get("/api/movies/27205/play").set(anna);
    expect(ok.status).toBe(200);
    expect(ok.body.dateien).toHaveLength(1);
    expect(ok.body.dateien[0].pfad).toBe("/media/tv/FilmeHD3/Inception.mkv");
    expect(ok.body.dateien[0].ziele.map((z: { name: string }) => z.name)).toEqual(["desktop", "android"]);
    expect(ok.body.dateien[0].ziele[1].url).toBe(
      "intent://192.168.178.75/media/tv/FilmeHD3/Inception.mkv#Intent;scheme=smb;package=org.videolan.vlc;end"
    );

    // ohne gespeicherten Pfad und ohne erreichbares Kodi → 404
    db.prepare("UPDATE movies SET datei_pfade = '[]' WHERE tmdb_id = 27205").run();
    const altHost = process.env.KODI_DB_HOST;
    const altPort = process.env.KODI_DB_PORT;
    process.env.KODI_DB_HOST = "127.0.0.1";
    process.env.KODI_DB_PORT = "1";
    try {
      const leer = await request(app).get("/api/movies/27205/play").set(anna);
      expect(leer.status).toBe(404);
      expect(leer.body).toEqual({ error: "Nicht in der Mediathek" });
    } finally {
      if (altHost === undefined) delete process.env.KODI_DB_HOST;
      else process.env.KODI_DB_HOST = altHost;
      if (altPort === undefined) delete process.env.KODI_DB_PORT;
      else process.env.KODI_DB_PORT = altPort;
    }
  });
});
