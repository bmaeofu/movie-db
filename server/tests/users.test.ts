import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie") => ({
    tmdb_id: tmdbId,
    titel: "Testfilm",
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

async function login(app: ReturnType<typeof createApp>, name: string, password: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ name, password });
  return res.headers["set-cookie"][0].split(";")[0];
}

describe("User-Verwaltung", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminCookie: string;
  let benCookie: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    adminCookie = admin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/auth/register").set("Cookie", adminCookie).send({ name: "Ben", password: "benpass1" });
    benCookie = await login(app, "Ben", "benpass1");
  });

  it("eigenes Passwort: falsches altes → 401, zu kurz → 400, Erfolg invalidiert andere Sessions", async () => {
    const zweite = await login(app, "Ben", "benpass1");
    const falsch = await request(app)
      .put("/api/auth/password")
      .set("Cookie", benCookie)
      .send({ altes_password: "falsch", neues_password: "neu12345" });
    expect(falsch.status).toBe(401);
    const kurz = await request(app)
      .put("/api/auth/password")
      .set("Cookie", benCookie)
      .send({ altes_password: "benpass1", neues_password: "kurz" });
    expect(kurz.status).toBe(400);
    const ok = await request(app)
      .put("/api/auth/password")
      .set("Cookie", benCookie)
      .send({ altes_password: "benpass1", neues_password: "neu12345" });
    expect(ok.status).toBe(204);
    // eigene Session bleibt, zweite ist weg
    expect((await request(app).get("/api/auth/me").set("Cookie", benCookie)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", zweite)).status).toBe(401);
    // altes Passwort geht nicht mehr, neues schon
    expect((await request(app).post("/api/auth/login").send({ name: "Ben", password: "benpass1" })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ name: "Ben", password: "neu12345" })).status).toBe(200);
  });

  it("GET /api/users: 401 ohne Session, 403 als Nicht-Admin, 200 mit Liste für Admin", async () => {
    expect((await request(app).get("/api/users")).status).toBe(401);
    expect((await request(app).get("/api/users").set("Cookie", benCookie)).status).toBe(403);
    const res = await request(app).get("/api/users").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const anna = res.body.find((u: any) => u.name === "Anna");
    const ben = res.body.find((u: any) => u.name === "Ben");
    expect(anna.is_admin).toBe(1);
    expect(ben.is_admin).toBe(0);
    expect(ben.id).toBeGreaterThan(0);
  });

  it("Admin benennt User um; Duplikat → 409", async () => {
    const ben = db.prepare("SELECT id FROM users WHERE name = 'Ben'").get() as { id: number };
    const ok = await request(app)
      .put(`/api/users/${ben.id}`)
      .set("Cookie", adminCookie)
      .send({ name: "Benjamin" });
    expect(ok.status).toBe(204);
    expect((await request(app).post("/api/auth/login").send({ name: "Benjamin", password: "benpass1" })).status).toBe(200);
    const dup = await request(app)
      .put(`/api/users/${ben.id}`)
      .set("Cookie", adminCookie)
      .send({ name: "Anna" });
    expect(dup.status).toBe(409);
  });

  it("Admin-Reset eines Passworts invalidiert alle Sessions des Users", async () => {
    const ben = db.prepare("SELECT id FROM users WHERE name = 'Ben'").get() as { id: number };
    const res = await request(app)
      .put(`/api/users/${ben.id}`)
      .set("Cookie", adminCookie)
      .send({ password: "reset1234" });
    expect(res.status).toBe(204);
    expect((await request(app).get("/api/auth/me").set("Cookie", benCookie)).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ name: "Ben", password: "reset1234" })).status).toBe(200);
  });

  it("Admin-Recht vergeben; letzter Admin kann sein Recht nicht verlieren", async () => {
    const anna = db.prepare("SELECT id FROM users WHERE name = 'Anna'").get() as { id: number };
    const ben = db.prepare("SELECT id FROM users WHERE name = 'Ben'").get() as { id: number };
    // letzter Admin entmachten → 400
    const demote = await request(app)
      .put(`/api/users/${anna.id}`)
      .set("Cookie", adminCookie)
      .send({ is_admin: 0 });
    expect(demote.status).toBe(400);
    // Ben zum Admin machen → 204
    const promote = await request(app)
      .put(`/api/users/${ben.id}`)
      .set("Cookie", adminCookie)
      .send({ is_admin: 1 });
    expect(promote.status).toBe(204);
    expect((await request(app).get("/api/auth/me").set("Cookie", benCookie)).body.is_admin).toBe(1);
  });

  it("neuer Benutzer bekommt Status 'neu' für alle vorhandenen Filme", async () => {
    await request(app).post("/api/collection").set("Cookie", adminCookie).send({ tmdb_id: 27205, medientyp: "film" });
    const reg = await request(app)
      .post("/api/auth/register")
      .set("Cookie", adminCookie)
      .send({ name: "Neuling", password: "neuling1" });
    expect(reg.status).toBe(201);
    const neuUserId = reg.body.id as number;
    const rows = db
      .prepare("SELECT tmdb_id, status FROM watch_status WHERE user_id = ?")
      .all(neuUserId) as { tmdb_id: number; status: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.status).toBe("neu");
  });

  it("Löschen: nicht sich selbst, nicht letzten Admin; Kaskaden + added_by SET NULL", async () => {
    const anna = db.prepare("SELECT id FROM users WHERE name = 'Anna'").get() as { id: number };
    const ben = db.prepare("SELECT id FROM users WHERE name = 'Ben'").get() as { id: number };
    const selbst = await request(app).delete(`/api/users/${anna.id}`).set("Cookie", adminCookie);
    expect(selbst.status).toBe(400);
    const letzterAdmin = await request(app).delete(`/api/users/${anna.id}`).set("Cookie", adminCookie);
    expect(letzterAdmin.status).toBe(400);
    // Daten von Ben anlegen: Film hinzufügen (added_by=Ben), bewerten, Liste
    await request(app).post("/api/collection").set("Cookie", benCookie).send({ tmdb_id: 27205, medientyp: "film" });
    await request(app).put("/api/movies/27205/rating").set("Cookie", benCookie).send({ sterne: 5 });
    const list = await request(app).post("/api/lists").set("Cookie", benCookie).send({ name: "Bens Liste" });
    // Löschen
    const del = await request(app).delete(`/api/users/${ben.id}`).set("Cookie", adminCookie);
    expect(del.status).toBe(204);
    // Sessions, Ratings, Listen weg; Film bleibt mit added_by NULL
    expect((await request(app).get("/api/auth/me").set("Cookie", benCookie)).status).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ratings").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM lists").get()).toEqual({ n: 0 });
    const film = db.prepare("SELECT added_by FROM collection WHERE tmdb_id = 27205").get() as { added_by: number | null };
    expect(film.added_by).toBeNull();
  });
});
