import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import type { Express } from "express";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";
import { asAdmin } from "./helpers.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie") => ({
    tmdb_id: tmdbId,
    titel: "TMDB-Film",
    jahr: 2020,
    medientyp,
    genres: ["Action"],
    poster_url: null,
    overview: null,
    imdb_id: null,
    tmdb_bewertung: null,
    tmdb_stimmen: 0,
    land: [],
    regisseure: [],
    autoren: [],
    cast: [],
  }),
};

describe("Manueller Eintrag (Custom)", () => {
  let db: Database.Database;
  let app: Express;
  let anna: Record<string, string>;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    anna = asAdmin({ id: "sub-anna", name: "Anna" });
  });

  it("401 ohne Session", async () => {
    const res = await request(app).post("/api/collection/custom").send({ titel: "Blindhänger", medientyp: "film" });
    expect(res.status).toBe(401);
  });

  it("validiert Titel, medientyp, jahr, genres", async () => {
    const send = (body: Record<string, unknown>) =>
      request(app).post("/api/collection/custom").set(anna).send(body);
    expect((await send({ medientyp: "film" })).status).toBe(400);
    expect((await send({ titel: "  ", medientyp: "film" })).status).toBe(400);
    expect((await send({ titel: "X", medientyp: "doku" })).status).toBe(400);
    expect((await send({ titel: "X", medientyp: "film", jahr: "2010" })).status).toBe(400);
    expect((await send({ titel: "X", medientyp: "film", jahr: 1800 })).status).toBe(400);
    expect((await send({ titel: "X", medientyp: "film", genres: "Action" })).status).toBe(400);
  });

  it("legt Custom-Film mit negativer ID an und listet ihn", async () => {
    const res = await request(app)
      .post("/api/collection/custom")
      .set(anna)
      .send({ titel: "Blindhänger", jahr: 2021, medientyp: "film", genres: ["Komödie"], overview: "Ohne TMDB" });
    expect(res.status).toBe(201);
    expect(res.body.tmdb_id).toBeLessThan(0);
    const list = await request(app).get("/api/collection").set(anna);
    const m = list.body.find((x: any) => x.tmdb_id === res.body.tmdb_id);
    expect(m.titel).toBe("Blindhänger");
    expect(m.jahr).toBe(2021);
    expect(m.genres).toEqual(["Komödie"]);
    expect(m.overview).toBe("Ohne TMDB");
  });

  it("erzeugt fortlaufend eindeutige negative IDs auch neben TMDB-Filmen", async () => {
    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 27205, medientyp: "film" });
    const a = await request(app).post("/api/collection/custom").set(anna).send({ titel: "A", medientyp: "film" });
    const b = await request(app).post("/api/collection/custom").set(anna).send({ titel: "B", medientyp: "film" });
    expect(a.body.tmdb_id).toBe(-1);
    expect(b.body.tmdb_id).toBe(-2);
  });

  it("Custom-Film ist entfernbar", async () => {
    const c = await request(app).post("/api/collection/custom").set(anna).send({ titel: "Blindhänger", medientyp: "film" });
    const id = c.body.tmdb_id;
    const del = await request(app).delete(`/api/collection/${id}`).set(anna);
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/collection").set(anna);
    expect(list.body.find((x: any) => x.tmdb_id === id)).toBeUndefined();
  });

  it("Doppeltes Hinzufügen derselben Custom-ID → 200", async () => {
    const c = await request(app).post("/api/collection/custom").set(anna).send({ titel: "Blindhänger", medientyp: "film" });
    const again = await request(app)
      .post("/api/collection/custom")
      .set(anna)
      .send({ titel: "Blindhänger", medientyp: "film" });
    // zweiter Aufruf erzeugt eine NEUE ID (-2) – gleicher Titel, anderes Werk: ok
    expect(again.status).toBe(201);
    expect(again.body.tmdb_id).not.toBe(c.body.tmdb_id);
  });
});
