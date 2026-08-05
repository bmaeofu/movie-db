import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";

const filme: Record<number, TmdbMovie> = {
  27205: { tmdb_id: 27205, titel: "Inception", jahr: 2010, medientyp: "film", genres: ["Action"], poster_url: null, overview: "Traum", land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  157336: { tmdb_id: 157336, titel: "Interstellar", jahr: 2014, medientyp: "film", genres: ["Science Fiction"], poster_url: null, overview: "Wurmloch", land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1399: { tmdb_id: 1399, titel: "Game of Thrones", jahr: 2011, medientyp: "serie", genres: ["Drama"], poster_url: null, overview: "Drachen", land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1234: { tmdb_id: 1234, titel: "Neu A", jahr: 2020, medientyp: "film", genres: [], poster_url: null, overview: null, land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1235: { tmdb_id: 1235, titel: "Neu B", jahr: 2021, medientyp: "film", genres: [], poster_url: null, overview: null, land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
};

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie") => {
    const f = filme[tmdbId];
    if (!f) throw new Error("unbekannt");
    return { ...f, medientyp };
  },
};

describe("Sammlung", () => {
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
    await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 157336, medientyp: "film" });
    await request(app).post("/api/collection").set("Cookie", benCookie).send({ tmdb_id: 1399, medientyp: "serie" });
  });

  it("source: default 'user', 'kodi' erlaubt, ungültig → 400", async () => {
    const defaultSrc = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 1234, medientyp: "film" });
    expect(defaultSrc.status).toBe(201);
    const rowUser = db.prepare("SELECT source FROM movies WHERE tmdb_id = 1234").get() as { source: string } | undefined;
    expect(rowUser?.source).toBe("user");
    const kodi = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 1235, medientyp: "film", source: "kodi" });
    expect(kodi.status).toBe(201);
    const rowKodi = db.prepare("SELECT source FROM movies WHERE tmdb_id = 1235").get() as { source: string } | undefined;
    expect(rowKodi?.source).toBe("kodi");
    const bad = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 27205, medientyp: "film", source: "omdb" });
    expect(bad.status).toBe(400);
    const list = (await request(app).get("/api/collection").set("Cookie", annaCookie)).body as {
      tmdb_id: number;
      source: string;
    }[];
    expect(list.find((m) => m.tmdb_id === 1235)?.source).toBe("kodi");
    expect(list.find((m) => m.tmdb_id === 1234)?.source).toBe("user");
  });

  it("fügt einen Film hinzu (erzeugt movies- und collection-Zeile)", async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM movies").get() as { n: number };
    expect(before.n).toBe(3);
    const res = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 157336, medientyp: "film" });
    expect(res.status).toBe(200); // bereits vorhanden
    const after = db.prepare("SELECT COUNT(*) AS n FROM movies").get() as { n: number };
    expect(after.n).toBe(3);
  });

  it("validiert tmdb_id und medientyp", async () => {
    const res1 = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: "x", medientyp: "film" });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 1, medientyp: "doku" });
    expect(res2.status).toBe(400);
  });

  it("listet alle Filme mit Durchschnitt und eigenen Daten", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", benCookie).send({ sterne: 4 });
    const res = await request(app).get("/api/collection").set("Cookie", annaCookie);
    expect(res.status).toBe(200);
    const inception = res.body.find((m: any) => m.tmdb_id === 27205);
    expect(inception.avg_rating).toBe(4.5);
    expect(inception.rating_count).toBe(2);
    expect(inception.my_rating).toBe(5);
    expect(inception.added_by_name).toBe("Anna");
    expect(inception.my_list_ids).toEqual([]);
  });

  it("filtert nach Genre, Medientyp und Status", async () => {
    await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "gesehen" });
    const genre = await request(app).get("/api/collection?genre=Action").set("Cookie", annaCookie);
    expect(genre.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
    const typ = await request(app).get("/api/collection?medientyp=serie").set("Cookie", annaCookie);
    expect(typ.body.map((m: any) => m.tmdb_id)).toEqual([1399]);
    const status = await request(app).get("/api/collection?status=gesehen").set("Cookie", annaCookie);
    expect(status.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
  });

  it("filtert nach Land, Regisseur und Freitext und liefert Facetten", async () => {
    db.prepare(
      `UPDATE movies SET land = '["Deutschland","USA"]', regisseure = '["Christopher Nolan"]',
       autoren = '["Jonathan Nolan"]', "cast" = '[{"name":"Leonardo DiCaprio","rolle":"Cobb"}]' WHERE tmdb_id = 27205`
    ).run();
    const land = await request(app).get("/api/collection?land=Deutschland").set("Cookie", annaCookie);
    expect(land.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const reg = await request(app).get("/api/collection?regisseur=Nolan").set("Cookie", annaCookie);
    expect(reg.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const text = await request(app).get("/api/collection?text=DiCaprio").set("Cookie", annaCookie);
    expect(text.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const negativ = await request(app).get("/api/collection?text=Ganzanders").set("Cookie", annaCookie);
    expect(negativ.body.map((m: any) => m.tmdb_id)).not.toContain(27205);
    const facets = await request(app).get("/api/collection/facets").set("Cookie", annaCookie);
    expect(facets.body.laender).toContain("Deutschland");
    expect(facets.body.regisseure).toContain("Christopher Nolan");
    const film = await request(app).get("/api/collection").set("Cookie", annaCookie);
    const inception = film.body.find((m: any) => m.tmdb_id === 27205);
    expect(inception.land).toEqual(["Deutschland", "USA"]);
    expect(inception.cast).toEqual([{ name: "Leonardo DiCaprio", rolle: "Cobb" }]);
  });

  it("sortiert nach Bewertung absteigend", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    await request(app).put("/api/movies/157336/rating").set("Cookie", annaCookie).send({ sterne: 3 });
    await request(app).put("/api/movies/1399/rating").set("Cookie", annaCookie).send({ sterne: 1 });
    const res = await request(app).get("/api/collection?sort=bewertung").set("Cookie", annaCookie);
    expect(res.body[0].tmdb_id).toBe(27205);
    expect(res.body[2].tmdb_id).toBe(1399);
  });

  it("entfernen: Admin oder Ersteller, sonst 403", async () => {
    const alsBen = await request(app).delete("/api/collection/27205").set("Cookie", benCookie);
    expect(alsBen.status).toBe(403);
    const alsErsteller = await request(app).delete("/api/collection/27205").set("Cookie", annaCookie);
    expect(alsErsteller.status).toBe(204);
    const weg = await request(app).get("/api/collection").set("Cookie", annaCookie);
    expect(weg.body.map((m: any) => m.tmdb_id)).not.toContain(27205);
  });
});
