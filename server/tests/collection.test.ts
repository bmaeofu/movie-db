import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { Express } from "express";
import { TmdbError } from "../src/tmdb.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";
import { asAdmin, asUser } from "./helpers.js";

const filme: Record<number, TmdbMovie> = {
  27205: { tmdb_id: 27205, titel: "Inception", jahr: 2010, medientyp: "film", genres: ["Action"], poster_url: null, overview: "Traum", land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  157336: { tmdb_id: 157336, titel: "Interstellar", jahr: 2014, medientyp: "film", genres: ["Science Fiction"], poster_url: null, overview: "Wurmloch", land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1399: { tmdb_id: 1399, titel: "Game of Thrones", jahr: 2011, medientyp: "serie", genres: ["Drama"], poster_url: null, overview: "Drachen", land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1234: { tmdb_id: 1234, titel: "Neu A", jahr: 2020, medientyp: "film", genres: [], poster_url: null, overview: null, land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1235: { tmdb_id: 1235, titel: "Neu B", jahr: 2021, medientyp: "film", genres: [], poster_url: null, overview: null, land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
  1236: { tmdb_id: 1236, titel: "Neu C", jahr: 2022, medientyp: "film", genres: [], poster_url: null, overview: null, land: [], imdb_id: null, tmdb_bewertung: null, tmdb_stimmen: 0, regisseure: [], autoren: [], cast: [] },
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
  let app: Express;
  let anna: Record<string, string>;
  let ben: Record<string, string>;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    anna = asAdmin({ id: "sub-anna", name: "Anna" });
    ben = asUser({ id: "sub-ben", name: "Ben" });
    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 27205, medientyp: "film" });
    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 157336, medientyp: "film" });
    await request(app).post("/api/collection").set(ben).send({ tmdb_id: 1399, medientyp: "serie" });
  });

  it("paginiert mit limit/offset und liefert Gesamtgenre als Facette", async () => {
    // 3 Filme in der Sammlung, sortiert nach Titel: Game of Thrones, Inception, Interstellar
    const ersteSeite = await request(app)
      .get("/api/collection?sort=titel&limit=2&offset=0")
      .set(anna);
    expect(ersteSeite.body.map((m: { titel: string }) => m.titel)).toEqual(["Game of Thrones", "Inception"]);

    const zweiteSeite = await request(app)
      .get("/api/collection?sort=titel&limit=2&offset=2")
      .set(anna);
    expect(zweiteSeite.body.map((m: { titel: string }) => m.titel)).toEqual(["Interstellar"]);

    const ohneGrenze = await request(app).get("/api/collection?sort=titel").set(anna);
    expect(ohneGrenze.body).toHaveLength(3);

    const gesamt = await request(app).get("/api/collection/count?sort=titel").set(anna);
    expect(gesamt.body.count).toBe(3);

    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 1234, medientyp: "film" });
    await request(app).post("/api/collection").set(anna).send({ tmdb_id: 157336, medientyp: "film" });
    const facets = await request(app).get("/api/collection/facets").set(anna);
    expect(facets.body.genres).toEqual(expect.arrayContaining(["Action", "Drama", "Science Fiction"]));
  });

  it("source: default 'user', 'kodi' erlaubt, ungültig → 400", async () => {
    const defaultSrc = await request(app).post("/api/collection").set(anna).send({ tmdb_id: 1234, medientyp: "film" });
    expect(defaultSrc.status).toBe(201);
    const rowUser = db.prepare("SELECT source FROM movies WHERE tmdb_id = 1234").get() as { source: string } | undefined;
    expect(rowUser?.source).toBe("user");
    const kodi = await request(app).post("/api/collection").set(anna).send({ tmdb_id: 1235, medientyp: "film", source: "kodi" });
    expect(kodi.status).toBe(201);
    const rowKodi = db.prepare("SELECT source FROM movies WHERE tmdb_id = 1235").get() as { source: string } | undefined;
    expect(rowKodi?.source).toBe("kodi");
    const bad = await request(app).post("/api/collection").set(anna).send({ tmdb_id: 27205, medientyp: "film", source: "omdb" });
    expect(bad.status).toBe(400);
    const list = (await request(app).get("/api/collection").set(anna)).body as {
      tmdb_id: number;
      source: string;
    }[];
    expect(list.find((m) => m.tmdb_id === 1235)?.source).toBe("kodi");
    expect(list.find((m) => m.tmdb_id === 1234)?.source).toBe("user");
  });

  it("Bewertungs-Override: tmdb/imdb-Bewertung aus dem Body wird übernommen, ungültig → 400", async () => {
    const ok = await request(app)
      .post("/api/collection")
      .set(anna)
      .send({ tmdb_id: 1236, medientyp: "film", source: "kodi", tmdb_bewertung: 7.5, imdb_bewertung: 8.1, imdb_stimmen: 4321 });
    expect(ok.status).toBe(201);
    const row = db.prepare("SELECT tmdb_bewertung, imdb_bewertung, imdb_stimmen, source FROM movies WHERE tmdb_id = 1236").get() as {
      tmdb_bewertung: number | null;
      imdb_bewertung: number | null;
      imdb_stimmen: number | null;
      source: string;
    };
    expect(row.tmdb_bewertung).toBe(7.5);
    expect(row.imdb_bewertung).toBe(8.1);
    expect(row.imdb_stimmen).toBe(4321);
    expect(row.source).toBe("kodi");
    const bad = await request(app)
      .post("/api/collection")
      .set(anna)
      .send({ tmdb_id: 1236, medientyp: "film", imdb_bewertung: 11 });
    expect(bad.status).toBe(400);
    const badVotes = await request(app)
      .post("/api/collection")
      .set(anna)
      .send({ tmdb_id: 1236, medientyp: "film", imdb_stimmen: -5 });
    expect(badVotes.status).toBe(400);
  });

  it("force_ratings aktualisiert Bewertungen bestehender Filme ohne Duplikat", async () => {
    const upd = await request(app)
      .post("/api/collection?force_ratings=1")
      .set(anna)
      .send({ tmdb_id: 27205, medientyp: "film", imdb_bewertung: 9.9, imdb_stimmen: 999 });
    expect(upd.status).toBe(200);
    const row = db.prepare("SELECT imdb_bewertung, imdb_stimmen FROM movies WHERE tmdb_id = 27205").get() as {
      imdb_bewertung: number | null;
      imdb_stimmen: number | null;
    };
    expect(row.imdb_bewertung).toBe(9.9);
    expect(row.imdb_stimmen).toBe(999);
    const anzahl = db.prepare("SELECT COUNT(*) AS n FROM collection WHERE tmdb_id = 27205").get() as { n: number };
    expect(anzahl.n).toBe(1); // kein Duplikat
  });

  it("fügt einen Film hinzu (erzeugt movies- und collection-Zeile)", async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM movies").get() as { n: number };
    expect(before.n).toBe(3);
    const res = await request(app).post("/api/collection").set(anna).send({ tmdb_id: 157336, medientyp: "film" });
    expect(res.status).toBe(200); // bereits vorhanden
    const after = db.prepare("SELECT COUNT(*) AS n FROM movies").get() as { n: number };
    expect(after.n).toBe(3);
  });

  it("validiert tmdb_id und medientyp", async () => {
    const res1 = await request(app).post("/api/collection").set(anna).send({ tmdb_id: "x", medientyp: "film" });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post("/api/collection").set(anna).send({ tmdb_id: 1, medientyp: "doku" });
    expect(res2.status).toBe(400);
  });

  it("listet alle Filme mit leeren Marken und den Listenzuordnungen", async () => {
    const res = await request(app).get("/api/collection").set(anna);
    expect(res.status).toBe(200);
    const inception = res.body.find((m: any) => m.tmdb_id === 27205);
    expect(inception.avg_rating).toBeNull();
    expect(inception.rating_count).toBe(0);
    expect(inception.my_rating).toBeNull();
    expect(inception.my_status).toBeNull();
    expect(inception.my_note).toBeNull();
    expect(inception.added_by_name).toBe("Anna");
    expect(inception.my_list_ids).toEqual([]);
  });

  it("filtert nach Genre und Medientyp", async () => {
    const genre = await request(app).get("/api/collection?genre=Action").set(anna);
    expect(genre.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
    const typ = await request(app).get("/api/collection?medientyp=serie").set(anna);
    expect(typ.body.map((m: any) => m.tmdb_id)).toEqual([1399]);
  });

  it("filtert mit ids und exclude_ids und sortiert nach order_ids", async () => {
    const nur = await request(app).get("/api/collection?ids=27205,157336").set(anna);
    expect(nur.body.map((m: any) => m.tmdb_id).sort()).toEqual([157336, 27205]);
    expect(nur.body.map((m: any) => m.tmdb_id)).toHaveLength(2);

    const ohne = await request(app).get("/api/collection?exclude_ids=27205").set(anna);
    expect(ohne.body.map((m: any) => m.tmdb_id).sort()).toEqual([1399, 157336]);

    const sortiert = await request(app).get("/api/collection?sort=bewertung&order_ids=157336,27205").set(anna);
    expect(sortiert.body.map((m: any) => m.tmdb_id)).toEqual([157336, 27205, 1399]);

    const count = await request(app).get("/api/collection/count?ids=27205,157336").set(anna);
    expect(count.body).toEqual({ count: 2 });
  });

  it("filtert nach Land, Regisseur und Freitext und liefert Facetten", async () => {
    db.prepare(
      `UPDATE movies SET land = '["Deutschland","USA"]', regisseure = '["Christopher Nolan"]',
       autoren = '["Jonathan Nolan"]', "cast" = '[{"name":"Leonardo DiCaprio","rolle":"Cobb"}]' WHERE tmdb_id = 27205`
    ).run();
    const land = await request(app).get("/api/collection?land=Deutschland").set(anna);
    expect(land.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const reg = await request(app).get("/api/collection?regisseur=Nolan").set(anna);
    expect(reg.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const text = await request(app).get("/api/collection?text=DiCaprio").set(anna);
    expect(text.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const negativ = await request(app).get("/api/collection?text=Ganzanders").set(anna);
    expect(negativ.body.map((m: any) => m.tmdb_id)).not.toContain(27205);
    const facets = await request(app).get("/api/collection/facets").set(anna);
    expect(facets.body.laender).toContain("Deutschland");
    expect(facets.body.regisseure).toContain("Christopher Nolan");
    const film = await request(app).get("/api/collection").set(anna);
    const inception = film.body.find((m: any) => m.tmdb_id === 27205);
    expect(inception.land).toEqual(["Deutschland", "USA"]);
    expect(inception.cast).toEqual([{ name: "Leonardo DiCaprio", rolle: "Cobb" }]);
  });

  it("filtert nach Jahr und liefert jahre-Facette", async () => {
    const byJahr = await request(app).get("/api/collection?jahr=2010").set(anna);
    expect(byJahr.body.map((m: any) => m.tmdb_id)).toEqual([27205]); // Inception 2010
    const keinJahr = await request(app).get("/api/collection?jahr=1960").set(anna);
    expect(keinJahr.body).toEqual([]);
    const facets = await request(app).get("/api/collection/facets").set(anna);
    expect(facets.body.jahre).toContain(2010);
    expect(facets.body.jahre).toContain(2011); // Game of Thrones
  });

  it("filtert nach Mindestbewertung (TMDb/IMDb)", async () => {
    db.prepare("UPDATE movies SET tmdb_bewertung = 8.1, imdb_bewertung = 8.6 WHERE tmdb_id = 27205").run();
    db.prepare("UPDATE movies SET tmdb_bewertung = 6.4, imdb_bewertung = 6.1 WHERE tmdb_id = 157336").run();
    db.prepare("UPDATE movies SET tmdb_bewertung = 8.3, imdb_bewertung = NULL WHERE tmdb_id = 1399").run();
    const tmdb = await request(app).get("/api/collection?tmdb_min=8").set(anna);
    expect(tmdb.body.map((m: any) => m.tmdb_id).sort()).toEqual([1399, 27205]);
    const imdb = await request(app).get("/api/collection?imdb_min=8").set(anna);
    expect(imdb.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
  });

  it("filtert unterhalb einer Bewertung (tmdb_max/imdb_max)", async () => {
    db.prepare("UPDATE movies SET tmdb_bewertung = 4.2, imdb_bewertung = 4.8 WHERE tmdb_id = 27205").run();
    db.prepare("UPDATE movies SET tmdb_bewertung = 6.4, imdb_bewertung = 6.1 WHERE tmdb_id = 157336").run();
    db.prepare("UPDATE movies SET tmdb_bewertung = 8.3, imdb_bewertung = NULL WHERE tmdb_id = 1399").run();
    const tmdb = await request(app).get("/api/collection?tmdb_max=5").set(anna);
    expect(tmdb.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
    const imdb = await request(app).get("/api/collection?imdb_max=5").set(anna);
    expect(imdb.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
  });

  it("count liefert die Trefferzahl mit denselben Filtern", async () => {
    const alle = await request(app).get("/api/collection/count").set(anna);
    expect(alle.body).toEqual({ count: 3 });
    const gefiltert = await request(app).get("/api/collection/count?genre=Action").set(anna);
    expect(gefiltert.body).toEqual({ count: 1 });
  });

  it("filtert nach Schauspieler und liefert schauspieler-Facette", async () => {
    db.prepare(`UPDATE movies SET "cast" = '[{"name":"Leonardo DiCaprio","rolle":"Cobb"}]' WHERE tmdb_id = 27205`).run();
    const gefiltert = await request(app).get("/api/collection?schauspieler=DiCaprio").set(anna);
    expect(gefiltert.body.map((m: any) => m.tmdb_id)).toContain(27205);
    const facets = await request(app).get("/api/collection/facets").set(anna);
    expect(facets.body.schauspieler).toContain("Leonardo DiCaprio");
  });

  it("filtert nach fehlenden Feldern (fehlt=…, ODER-Verknüpfung)", async () => {
    // 27205 vollständig, 157336 ohne Jahr/Plot/Land, 1399 ohne Land
    db.prepare(`UPDATE movies SET land = '["USA"]' WHERE tmdb_id = 27205`).run();
    db.prepare(`UPDATE movies SET jahr = NULL, overview = NULL, land = '[]' WHERE tmdb_id = 157336`).run();

    const jahr = await request(app).get("/api/collection?fehlt=jahr").set(anna);
    expect(jahr.body.map((m: any) => m.tmdb_id).sort()).toEqual([157336]);

    const land = await request(app).get("/api/collection?fehlt=land").set(anna);
    expect(land.body.map((m: any) => m.tmdb_id).sort()).toEqual([1399, 157336]);

    // ODER: mindestens eines der Felder fehlt
    const beides = await request(app).get("/api/collection?fehlt=jahr,land").set(anna);
    expect(beides.body.map((m: any) => m.tmdb_id).sort()).toEqual([1399, 157336]);

    // kombinierbar mit anderen Filtern
    const kombi = await request(app).get("/api/collection?fehlt=jahr&medientyp=film").set(anna);
    expect(kombi.body.map((m: any) => m.tmdb_id).sort()).toEqual([157336]);

    // count nutzt denselben Filter
    const count = await request(app).get("/api/collection/count?fehlt=jahr").set(anna);
    expect(count.body.count).toBe(1);

    // unbekannte Werte werden ignoriert
    const ungueltig = await request(app).get("/api/collection?fehlt=quatsch").set(anna);
    expect(ungueltig.body.map((m: any) => m.tmdb_id).sort()).toEqual([1399, 157336, 27205]);
  });

  it("sortiert nach TMDb- und IMDb-Bewertung", async () => {
    db.prepare("UPDATE movies SET tmdb_bewertung = 6.0, imdb_bewertung = 6.5 WHERE tmdb_id = 27205").run();
    db.prepare("UPDATE movies SET tmdb_bewertung = 8.0, imdb_bewertung = 5.5 WHERE tmdb_id = 157336").run();
    db.prepare("UPDATE movies SET tmdb_bewertung = 7.0, imdb_bewertung = 8.5 WHERE tmdb_id = 1399").run();
    const tmdb = await request(app).get("/api/collection?sort=tmdb_bewertung").set(anna);
    expect(tmdb.body.map((m: any) => m.tmdb_id)).toEqual([157336, 1399, 27205]);
    const imdb = await request(app).get("/api/collection?sort=imdb_bewertung").set(anna);
    expect(imdb.body.map((m: any) => m.tmdb_id)).toEqual([1399, 27205, 157336]);
  });

  it("enrich: unbekannte TMDB-ID meldet 404 statt Ausfall, Serverfehler melden 502", async () => {
    const db2 = createDb(":memory:");
    const anna = asAdmin({ id: "sub-anna", name: "Anna" });
    // Nutzer zuerst anlegen, damit der Sammlungseintrag einen Besitzer hat
    await request(db2App(db2, new TmdbError("TMDB antwortet mit 404", 404))).get("/api/auth/me").set(anna);
    db2.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json, land, regisseure, autoren, "cast")
       VALUES (424242, 'Altlast', 1990, 'film', '[]', NULL, NULL, '{}', '[]', '[]', '[]', '[]')`
    ).run();
    db2.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (424242, 1)").run();

    const weg = await request(db2App(db2, new TmdbError("TMDB antwortet mit 404", 404)))
      .post("/api/collection/424242/enrich")
      .set(anna);
    expect(weg.status).toBe(404);
    expect(weg.body.error).toContain("nicht vorhanden");

    const ausfall = await request(db2App(db2, new TmdbError("TMDB antwortet mit 503", 503)))
      .post("/api/collection/424242/enrich")
      .set(anna);
    expect(ausfall.status).toBe(502);
    expect(ausfall.body.error).toContain("nicht erreichbar");
  });
  it("entfernen: Admin oder Ersteller, sonst 403", async () => {
    const alsBen = await request(app).delete("/api/collection/27205").set(ben);
    expect(alsBen.status).toBe(403);
    const alsErsteller = await request(app).delete("/api/collection/27205").set(anna);
    expect(alsErsteller.status).toBe(204);
    const weg = await request(app).get("/api/collection").set(anna);
    expect(weg.body.map((m: any) => m.tmdb_id)).not.toContain(27205);
  });

});

function db2App(db: Database.Database, fehler: unknown): Express {
  const fake: TmdbClient = {
    search: async () => [],
    details: async () => {
      throw fehler;
    },
  };
  return createApp(db, fake);
}
