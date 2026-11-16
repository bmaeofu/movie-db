import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import type { Express } from "express";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";
import { asAdmin, asUser } from "./helpers.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie> => ({
    tmdb_id: tmdbId,
    titel: `Film ${tmdbId}`,
    jahr: 2010,
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

describe("Persönliche Listen", () => {
  let db: Database.Database;
  let app: Express;
  let anna: Record<string, string>;
  let ben: Record<string, string>;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    anna = asAdmin({ id: "sub-anna", name: "Anna" });
    ben = asUser({ id: "sub-ben", name: "Ben" });
    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 27205, medientyp: "film" });
  });

  it("Liste anlegen, umbenennen, auflisten (nur eigene)", async () => {
    const create = await request(app).post("/api/lists").set(anna).send({ name: "Science Fiction Abend" });
    expect(create.status).toBe(201);
    const listId = create.body.id;
    await request(app).put(`/api/lists/${listId}`).set(anna).send({ name: "SciFi Abend" });
    const lists = await request(app).get("/api/lists").set(anna);
    expect(lists.body).toEqual([{ id: listId, name: "SciFi Abend", item_count: 0 }]);
    const fremde = await request(app).get("/api/lists").set(ben);
    expect(fremde.body).toEqual([]);
  });

  it("nur der Besitzer darf Liste ändern/löschen", async () => {
    const create = await request(app).post("/api/lists").set(anna).send({ name: "Meine Liste" });
    const listId = create.body.id;
    const res = await request(app).delete(`/api/lists/${listId}`).set(ben);
    expect(res.status).toBe(403);
    const res2 = await request(app).put(`/api/lists/${listId}`).set(ben).send({ name: "gehackt" });
    expect(res2.status).toBe(403);
  });

  it("Film zur Liste hinzufügen (nur vorhandene Filme), Duplikat idempotent", async () => {
    const create = await request(app).post("/api/lists").set(anna).send({ name: "Meine Liste" });
    const listId = create.body.id;
    const res = await request(app).post(`/api/lists/${listId}/items`).set(anna).send({ tmdb_id: 9999 });
    expect(res.status).toBe(400); // Film existiert nicht in movies
    await request(app).post(`/api/lists/${listId}/items`).set(anna).send({ tmdb_id: 27205 });
    await request(app).post(`/api/lists/${listId}/items`).set(anna).send({ tmdb_id: 27205 });
    const rows = db.prepare("SELECT COUNT(*) AS n FROM list_items").get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it("Liste mit Items auslesen (MovieView-Shape)", async () => {
    const create = await request(app).post("/api/lists").set(anna).send({ name: "Top" });
    const listId = create.body.id;
    await request(app).post(`/api/lists/${listId}/items`).set(anna).send({ tmdb_id: 27205 });
    const res = await request(app).get(`/api/lists/${listId}`).set(anna);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tmdb_id).toBe(27205);
    expect(res.body.items[0].my_rating).toBeNull();
    expect(res.body.items[0].my_list_ids).toEqual([listId]);
  });

  it("Film bleibt in der Liste sichtbar, wenn er aus der Sammlung entfernt wird", async () => {
    const create = await request(app).post("/api/lists").set(anna).send({ name: "Top" });
    const listId = create.body.id;
    await request(app).post(`/api/lists/${listId}/items`).set(anna).send({ tmdb_id: 27205 });
    const del = await request(app).delete("/api/collection/27205").set(anna);
    expect(del.status).toBe(204);
    const res = await request(app).get(`/api/lists/${listId}`).set(anna);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tmdb_id).toBe(27205);
    expect(res.body.items[0].added_by_name).toBeNull();
  });

  it("Item entfernen und Liste löschen (löscht Items per Cascade)", async () => {
    const create = await request(app).post("/api/lists").set(anna).send({ name: "Top" });
    const listId = create.body.id;
    await request(app).post(`/api/lists/${listId}/items`).set(anna).send({ tmdb_id: 27205 });
    await request(app).delete(`/api/lists/${listId}/items/27205`).set(anna);
    expect(db.prepare("SELECT COUNT(*) AS n FROM list_items").get()).toEqual({ n: 0 });
    await request(app).delete(`/api/lists/${listId}`).set(anna);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lists").get()).toEqual({ n: 0 });
  });
});
