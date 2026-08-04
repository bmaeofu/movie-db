import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";

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
  }),
};

describe("Bewertung, Status, Notizen", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let annaCookie: string;
  let benCookie: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    const anna = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    annaCookie = anna.headers["set-cookie"][0].split(";")[0];
    const ben = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" }).set("Cookie", annaCookie);
    const benLogin = await request(app).post("/api/auth/login").send({ name: "Ben", password: "geheim123" });
    benCookie = benLogin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 27205, medientyp: "film" });
  });

  it("Bewertung ist ein UPSERT (zweites Setzen überschreibt)", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 3 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    const rows = db.prepare("SELECT * FROM ratings").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).sterne).toBe(5);
  });

  it("validiert Bewertung (1–5)", async () => {
    const res0 = await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 0 });
    expect(res0.status).toBe(400);
    const res6 = await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 6 });
    expect(res6.status).toBe(400);
  });

  it("Bewertungen bleiben pro Nutzer getrennt", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", benCookie).send({ sterne: 2 });
    const anna = db.prepare("SELECT sterne FROM ratings WHERE user_id = (SELECT id FROM users WHERE name = 'Anna')").get();
    const ben = db.prepare("SELECT sterne FROM ratings WHERE user_id = (SELECT id FROM users WHERE name = 'Ben')").get();
    expect((anna as any).sterne).toBe(5);
    expect((ben as any).sterne).toBe(2);
  });

  it("Watch-Status: gültige Werte, UPSERT", async () => {
    const resBad = await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "vielleicht" });
    expect(resBad.status).toBe(400);
    await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "gesehen" });
    await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "schauen" });
    const rows = db.prepare("SELECT * FROM watch_status").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).status).toBe("schauen");
  });

  it("Notiz setzen und löschen; leere Notiz → 400", async () => {
    const resLeer = await request(app).put("/api/movies/27205/note").set("Cookie", annaCookie).send({ text: "" });
    expect(resLeer.status).toBe(400);
    await request(app).put("/api/movies/27205/note").set("Cookie", annaCookie).send({ text: "Mit Popcorn" });
    const rows = db.prepare("SELECT * FROM notes").all();
    expect(rows).toHaveLength(1);
    await request(app).delete("/api/movies/27205/note").set("Cookie", annaCookie);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 0 });
  });
});
