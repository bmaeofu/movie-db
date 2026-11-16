import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";
import { asAdmin, asUser } from "./helpers.js";

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

describe("Nutzer aus der Anbieter-Identität", () => {
  let db: Database.Database;
  let app: Express;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("legt beim ersten Aufruf genau einen Datensatz an und wiederverwendet ihn", async () => {
    const first = await request(app).get("/api/auth/me").set(asUser({ id: "sub-a", name: "Anna" }));
    expect(first.status).toBe(200);
    const second = await request(app).get("/api/auth/me").set(asUser({ id: "sub-a", name: "Anna" }));
    expect(second.body.id).toBe(first.body.id);
    const rows = db.prepare("SELECT name, oidc_sub FROM users").all();
    expect(rows).toEqual([{ name: "Anna", oidc_sub: "sub-a" }]);
  });

  it("verknüpft einen Bestandsnutzer über den Namen", async () => {
    db.prepare("INSERT INTO users (name, password_hash, is_admin) VALUES ('Anna', '!', 0)").run();
    const res = await request(app).get("/api/auth/me").set(asUser({ id: "sub-a", name: "Anna" }));
    expect(res.body.id).toBe(1);
    const row = db.prepare("SELECT oidc_sub FROM users WHERE id = 1").get() as { oidc_sub: string };
    expect(row.oidc_sub).toBe("sub-a");
  });

  it("verknüpft einen Bestandsnutzer über den Teil der E-Mail-Adresse", async () => {
    db.prepare("INSERT INTO users (name, password_hash, is_admin) VALUES ('anna', '!', 0)").run();
    const res = await request(app)
      .get("/api/auth/me")
      .set(asUser({ id: "sub-b", name: "Anna Neu", email: "anna@example.org" }));
    expect(res.body.id).toBe(1);
  });

  it("folgt der Administratorgruppe des Anbieters bei jedem Aufruf", async () => {
    const first = await request(app).get("/api/auth/me").set(asUser({ id: "sub-c", name: "Cem" }));
    expect(first.body.is_admin).toBe(0);
    const promoted = await request(app).get("/api/auth/me").set(asAdmin({ id: "sub-c", name: "Cem" }));
    expect(promoted.body.is_admin).toBe(1);
    const demoted = await request(app).get("/api/auth/me").set(asUser({ id: "sub-c", name: "Cem" }));
    expect(demoted.body.is_admin).toBe(0);
  });

  it("weist einen Aufruf ohne x-user-id ab", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Nicht angemeldet" });
  });

  it("macht einen belegten Namen eindeutig, statt den fremden Datensatz zu übernehmen", async () => {
    await request(app).get("/api/auth/me").set(asUser({ id: "sub-first", name: "Anna" }));
    const second = await request(app)
      .get("/api/auth/me")
      .set(asUser({ id: "sub-second", name: "Anna" }));
    expect(second.body.id).not.toBe(1);
    expect(second.body.name).toBe("Anna (second)");
  });

  it("meldet den angemeldeten Menschen und braucht kein Bootstrap", async () => {
    const me = await request(app).get("/api/auth/me").set(asUser({ id: "sub-d", name: "Dana" }));
    expect(me.body).toEqual({ id: 1, name: "Dana", is_admin: 0 });
    const status = await request(app).get("/api/auth/status").set(asUser());
    expect(status.body).toEqual({ needsBootstrap: false });
  });
});
