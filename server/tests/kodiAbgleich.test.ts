import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { klassifiziereAbgleich, type AbgleichEintrag, type KodiBestand } from "../src/kodiAbgleich.js";
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

function bestand(tmdbIds: string[], imdbPaare: [string, string][] = []): KodiBestand {
  return { tmdbIds: new Set(tmdbIds), imdbZuTmdb: new Map(imdbPaare) };
}

function eintrag(tmdbId: number, imdbId: string | null = null, nutzerdaten = false): AbgleichEintrag {
  return { tmdb_id: tmdbId, titel: `Film ${tmdbId}`, jahr: 2000, imdb_id: imdbId, nutzerdaten };
}

describe("Kodi-Abgleich: Klassifizierung", () => {
  it("zählt vorhandene Filme", () => {
    const b = klassifiziereAbgleich([eintrag(1), eintrag(2)], bestand(["1", "2"]));
    expect(b.vorhanden).toBe(2);
    expect(b.merges).toEqual([]);
    expect(b.waisen).toEqual([]);
  });

  it("schlägt Merge vor, wenn die IMDb-ID in Kodi unter anderer TMDB-ID steht", () => {
    const b = klassifiziereAbgleich([eintrag(115982, "tt0059153")], bestand(["133035"], [["tt0059153", "133035"]]));
    expect(b.vorhanden).toBe(0);
    expect(b.merges).toEqual([{ alt: 115982, neu: 133035, titel: "Film 115982", jahr: 2000 }]);
  });

  it("meldet Waisen ohne Nutzerdaten separat von Waisen mit Nutzerdaten", () => {
    const b = klassifiziereAbgleich([eintrag(10), eintrag(11, null, true)], bestand([]));
    expect(b.waisen.map((e) => e.tmdb_id)).toEqual([10]);
    expect(b.waisenMitNutzerdaten.map((e) => e.tmdb_id)).toEqual([11]);
  });

  it("behandelt einen Treffer mit gleicher TMDB-ID nicht als Merge", () => {
    const b = klassifiziereAbgleich([eintrag(7, "tt7")], bestand(["7"], [["tt7", "7"]]));
    expect(b.vorhanden).toBe(1);
    expect(b.merges).toEqual([]);
  });
});

describe("Kodi-Abgleich: Bereinigung", () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  function film(tmdbId: number, titel: string, mitNutzerdaten: boolean): void {
    db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                           land, regisseure, autoren, "cast", source)
       VALUES (?, ?, 2000, 'film', '[]', NULL, NULL, '{}', '[]', '[]', '[]', '[]', 'kodi')`
    ).run(tmdbId, titel);
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, 1)").run(tmdbId);
    if (mitNutzerdaten) {
      db.prepare("INSERT INTO ratings (user_id, tmdb_id, sterne) VALUES (1, ?, 4)").run(tmdbId);
    }
  }

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    cookie = admin.headers["set-cookie"][0].split(";")[0];
  });

  it("löscht Waisen ohne Nutzerdaten und überspringt Waisen mit Nutzerdaten", async () => {
    film(10, "Waise ohne Daten", false);
    film(11, "Waise mit Daten", true);

    const res = await request(app)
      .post("/api/admin/kodi-reconcile")
      .set("Cookie", cookie)
      .send({ deletes: [10, 11] });

    expect(res.status).toBe(200);
    expect(res.body.geloescht).toEqual([10]);
    expect(res.body.uebersprungen_nutzerdaten).toEqual([11]);

    const uebrig = db.prepare("SELECT tmdb_id FROM movies ORDER BY tmdb_id").all() as { tmdb_id: number }[];
    expect(uebrig.map((r) => r.tmdb_id)).toEqual([11]);
    const bewertung = db.prepare("SELECT COUNT(*) n FROM ratings WHERE tmdb_id = 11").get() as { n: number };
    expect(bewertung.n).toBe(1);
  });

  it("führt Merges aus und meldet sie", async () => {
    film(20, "Alter Eintrag", false);
    film(21, "Unbekannter Titel", false);

    const res = await request(app)
      .post("/api/admin/kodi-reconcile")
      .set("Cookie", cookie)
      .send({ merges: [{ alt: 20, neu: 21 }] });

    expect(res.status).toBe(200);
    expect(res.body.merges).toEqual([{ alt: 20, neu: 21, status: "ok", merge: true }]);
    const uebrig = db.prepare("SELECT tmdb_id, titel FROM movies ORDER BY tmdb_id").all() as { tmdb_id: number; titel: string }[];
    expect(uebrig).toEqual([{ tmdb_id: 21, titel: "Alter Eintrag" }]);
  });

  it("verlangt Adminrechte", async () => {
    const ben = await request(app).post("/api/auth/register").set("Cookie", cookie).send({ name: "Ben", password: "geheim123" });
    const benCookie = (await request(app).post("/api/auth/login").send({ name: "Ben", password: "geheim123" })).headers["set-cookie"][0].split(";")[0];
    expect(ben.status).toBe(201);
    expect((await request(app).post("/api/admin/kodi-reconcile").send({ deletes: [10] })).status).toBe(401);
    expect((await request(app).post("/api/admin/kodi-reconcile").set("Cookie", benCookie).send({ deletes: [10] })).status).toBe(403);
  });
});
