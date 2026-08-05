import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async () => {
    throw new Error("in Auth-Test nicht benutzt");
  },
};

describe("Auth", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("erster registrierter Nutzer wird Admin und bekommt Session", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    expect(res.status).toBe(201);
    expect(res.body.is_admin).toBe(1);
    expect(res.headers["set-cookie"]?.[0]).toContain("fdb_session=");
  });

  it("zweiter Nutzer braucht Admin-Session", async () => {
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const ohneAuth = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" });
    expect(ohneAuth.status).toBe(401);
    const cookie = admin.headers["set-cookie"][0].split(";")[0];
    const mitAuth = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" }).set("Cookie", cookie);
    expect(mitAuth.status).toBe(201);
    expect(mitAuth.body.is_admin).toBe(0);
  });

  it("Login mit falschem Passwort → 401", async () => {
    await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const res = await request(app).post("/api/auth/login").send({ name: "Anna", password: "falsch" });
    expect(res.status).toBe(401);
  });

  it("Login → /me → Logout invalidiert die Session", async () => {
    await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const login = await request(app).post("/api/auth/login").send({ name: "Anna", password: "geheim123" });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe("Anna");
    await request(app).post("/api/auth/logout").set("Cookie", cookie);
    const meAfter = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(meAfter.status).toBe(401);
  });

  it("ungültiges Prozent-Encoding im Cookie → 401 statt 500", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "fdb_session=%zz");
    expect(res.status).toBe(401);
  });

  it("status meldet needsBootstrap nur ohne Nutzer", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.body.needsBootstrap).toBe(true);
    await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const res2 = await request(app).get("/api/auth/status");
    expect(res2.body.needsBootstrap).toBe(false);
  });
});
