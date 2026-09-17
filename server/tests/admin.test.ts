import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { OmdbClient } from "../src/omdb.js";
import type { TmdbClient } from "../src/tmdb.js";

describe("Admin-Backfill", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminCookie: string;
  let benCookie: string;
  let enriched: boolean;

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
      land: enriched ? ["Deutschland"] : [],
      regisseure: enriched ? ["Regisseur A"] : [],
      autoren: enriched ? ["Autor A"] : [],
      cast: enriched ? [{ name: "Schauspieler A", rolle: "Rolle A" }] : [],
      imdb_id: enriched ? "tt1234567" : null,
      tmdb_bewertung: enriched ? 7.5 : null,
      tmdb_stimmen: enriched ? 100 : 0,
    }),
  };

  const fakeOmdb: OmdbClient = {
    rating: vi.fn(async (imdbId: string | null) => (imdbId ? { bewertung: 8.2, stimmen: 12345 } : null)),
  };

  beforeEach(async () => {
    enriched = false;
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb, { omdb: fakeOmdb });
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    adminCookie = admin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/auth/register").set("Cookie", adminCookie).send({ name: "Ben", password: "benpass1" });
    const benLogin = await request(app).post("/api/auth/login").send({ name: "Ben", password: "benpass1" });
    benCookie = benLogin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/collection").set("Cookie", adminCookie).send({ tmdb_id: 27205, medientyp: "film" });
    await request(app).post("/api/collection/custom").set("Cookie", adminCookie).send({ titel: "Ohne TMDB", medientyp: "film" });
  });

  it("401 ohne Session, 403 als Nicht-Admin", async () => {
    expect((await request(app).post("/api/admin/backfill")).status).toBe(401);
    expect((await request(app).post("/api/admin/backfill").set("Cookie", benCookie)).status).toBe(403);
  });

  it("reichert TMDB-Filme an, überspringt Custom-Einträge, idempotent", async () => {
    enriched = true;
    const first = await request(app).post("/api/admin/backfill").set("Cookie", adminCookie);
    expect(first.status).toBe(200);
    expect(first.body.updated).toBe(1); // nur tmdb 27205, Custom (-1) übersprungen
    const row = db.prepare('SELECT land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen FROM movies WHERE tmdb_id = 27205').get() as {
      land: string;
      regisseure: string;
      autoren: string;
      cast: string;
    };
    expect(JSON.parse(row.land)).toEqual(["Deutschland"]);
    expect(JSON.parse(row.regisseure)).toEqual(["Regisseur A"]);
    expect(JSON.parse(row.cast)).toEqual([{ name: "Schauspieler A", rolle: "Rolle A" }]);
    expect(row.tmdb_bewertung).toBe(7.5);
    expect(row.tmdb_stimmen).toBe(100);
    expect(row.imdb_bewertung).toBe(8.2);
    expect(row.imdb_stimmen).toBe(12345);
    const custom = db.prepare("SELECT land FROM movies WHERE tmdb_id < 0").get() as { land: string };
    expect(JSON.parse(custom.land)).toEqual([]);
    const second = await request(app).post("/api/admin/backfill").set("Cookie", adminCookie);
    expect(second.body.updated).toBe(0); // idempotent
  });

  it("omdb_limit begrenzt die OMDb-Aufrufe und erhält vorhandene IMDb-Werte", async () => {
    enriched = true;
    db.prepare("UPDATE movies SET imdb_bewertung = 6.6, imdb_stimmen = 42 WHERE tmdb_id = 27205").run();
    const res = await request(app).post("/api/admin/backfill?omdb_limit=0").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1); // TMDB-Daten werden trotzdem angereichert
    const row = db.prepare('SELECT imdb_bewertung, imdb_stimmen FROM movies WHERE tmdb_id = 27205').get() as {
      imdb_bewertung: number | null;
      imdb_stimmen: number | null;
    };
    expect(row.imdb_bewertung).toBe(6.6); // vorhandene Werte bleiben erhalten
    expect(row.imdb_stimmen).toBe(42);
  });

  it("skip_omdb beim Hinzufügen lässt imdb_bewertung leer", async () => {
    enriched = true;
    const res = await request(app)
      .post("/api/collection?skip_omdb=1")
      .set("Cookie", adminCookie)
      .send({ tmdb_id: 157336, medientyp: "film" });
    expect(res.status).toBe(201);
    const row = db.prepare('SELECT imdb_bewertung FROM movies WHERE tmdb_id = 157336').get() as { imdb_bewertung: number | null };
    expect(row.imdb_bewertung).toBeNull();
  });

  it("dubletten: meldet gleiche IMDb-ID und gleichen Titel+Jahr, nur für Admins", async () => {
    const einfuegen = db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json, land, regisseure, autoren, "cast")
       VALUES (?, ?, ?, 'film', '[]', NULL, 'Plot', ?, '[]', '[]', '[]', '[]')`
    );
    const inSammlung = db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, 1)");
    einfuegen.run(9001, "Es", 1966, JSON.stringify({ imdb_id: "tt0059153" }));
    einfuegen.run(9002, "Es (Neuscan)", 1966, JSON.stringify({ imdb_id: "tt0059153" }));
    einfuegen.run(9003, "Einzelstück", 2001, JSON.stringify({ imdb_id: "tt9999999" }));
    einfuegen.run(9004, "Doppelter Titel", 2004, JSON.stringify({}));
    einfuegen.run(9005, "Doppelter Titel", 2004, JSON.stringify({}));
    // Restzeilen ohne Sammlungseintrag dürfen nicht als Dublette erscheinen
    einfuegen.run(9006, "Es (Restzeile)", 1966, JSON.stringify({ imdb_id: "tt0059153" }));
    einfuegen.run(9007, "Es (Restzeile 2)", 1966, JSON.stringify({ imdb_id: "tt0059153" }));
    for (const id of [9001, 9002, 9003, 9004, 9005]) inSammlung.run(id);

    expect((await request(app).get("/api/admin/duplicates").set("Cookie", benCookie)).status).toBe(403);

    const res = await request(app).get("/api/admin/duplicates").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const imdbGruppe = res.body.imdb_gruppen.find((g: any) => g.imdb_id === "tt0059153");
    expect(imdbGruppe.eintraege.map((e: any) => e.tmdb_id).sort()).toEqual([9001, 9002]);
    expect(res.body.imdb_gruppen.every((g: any) => g.eintraege.length > 1)).toBe(true);
    expect(res.body.imdb_gruppen.every((g: any) => g.eintraege.every((e: any) => e.tmdb_id !== 9006 && e.tmdb_id !== 9007))).toBe(true);

    const titelGruppe = res.body.titel_jahr_gruppen.find((g: any) => g.titel === "Doppelter Titel");
    expect(titelGruppe.jahr).toBe(2004);
    expect(titelGruppe.eintraege.map((e: any) => e.tmdb_id).sort()).toEqual([9004, 9005]);
  });

  it("fix-tmdb-ids: Merge übernimmt Platzhalter-Titel des alten Eintrags", async () => {
    const einfuegen = db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json, land, regisseure, autoren, "cast")
       VALUES (?, ?, 1966, 'film', '[]', NULL, 'Plot', ?, '[]', '[]', '[]', '[]')`
    );
    einfuegen.run(9101, "Es", JSON.stringify({ imdb_id: "tt0059153" }));
    einfuegen.run(9102, "Unbekannter Titel", JSON.stringify({ imdb_id: "tt0059153" }));
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (9101, 1)").run();
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (9102, 1)").run();

    const res = await request(app)
      .post("/api/admin/fix-tmdb-ids")
      .set("Cookie", adminCookie)
      .send({ fixes: [{ alt: 9101, neu: 9102 }] });
    expect(res.status).toBe(200);
    expect(res.body.fixes[0]).toMatchObject({ alt: 9101, neu: 9102, status: "ok", merge: true });

    const ueberlebt = db.prepare("SELECT titel FROM movies WHERE tmdb_id = 9102").get() as { titel: string };
    expect(ueberlebt.titel).toBe("Es");
    expect(db.prepare("SELECT COUNT(*) n FROM movies WHERE tmdb_id = 9101").get()).toEqual({ n: 0 });
  });

  it("fix-tmdb-ids: Merge überschreibt einen vorhandenen echten Titel nicht", async () => {
    const einfuegen = db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json, land, regisseure, autoren, "cast")
       VALUES (?, ?, 1966, 'film', '[]', NULL, 'Plot', ?, '[]', '[]', '[]', '[]')`
    );
    einfuegen.run(9201, "Alter Titel", JSON.stringify({ imdb_id: "tt111" }));
    einfuegen.run(9202, "Richtiger Titel", JSON.stringify({ imdb_id: "tt111" }));
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (9201, 1)").run();
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (9202, 1)").run();

    await request(app).post("/api/admin/fix-tmdb-ids").set("Cookie", adminCookie).send({ fixes: [{ alt: 9201, neu: 9202 }] });
    const ueberlebt = db.prepare("SELECT titel FROM movies WHERE tmdb_id = 9202").get() as { titel: string };
    expect(ueberlebt.titel).toBe("Richtiger Titel");
  });

  it("enrich: ersetzt Platzhaltertitel durch den TMDB-Titel", async () => {
    const einfuegen = db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                           land, regisseure, autoren, "cast", imdb_bewertung, laufzeit_minuten)
       VALUES (?, ?, 2022, 'film', '[]', 'https://bild', 'Plot', '{}',
               '["Deutschland"]', '["Regie"]', '["Autor"]', '[{"name":"N","rolle":"R"}]', 7.0, 90)`
    );
    einfuegen.run(9100, "Unbekannter Titel");
    einfuegen.run(9101, "Echter Titel");
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (9100, 1)").run();
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (9101, 1)").run();

    const res = await request(app)
      .post("/api/admin/enrich")
      .set("Cookie", adminCookie)
      .send({ fields: ["jahr"] })
      .buffer(true)
      .parse((response, callback) => {
        let text = "";
        response.on("data", (chunk: Buffer) => {
          text += chunk.toString();
        });
        response.on("end", () => callback(null, text));
      });
    expect(res.status).toBe(200);

    const platzhalter = db.prepare("SELECT titel FROM movies WHERE tmdb_id = 9100").get() as { titel: string };
    expect(platzhalter.titel).toBe("Testfilm");
    const echt = db.prepare("SELECT titel FROM movies WHERE tmdb_id = 9101").get() as { titel: string };
    expect(echt.titel).toBe("Echter Titel");
  });

  it("actors-Import: UPSERT und Validierung", async () => {
    const ok = await request(app)
      .post("/api/admin/actors")
      .set("Cookie", adminCookie)
      .send({
        actors: [
          { name: "Leonardo DiCaprio", bild: "https://image.tmdb.org/t/p/original/x.jpg" },
          { name: "Gila von Weitershausen", bild: "/media/FilmeHD7/.actors/Gila_von_Weitershausen.jpg" },
        ],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.imported).toBe(2);
    const bad = await request(app)
      .post("/api/admin/actors")
      .set("Cookie", adminCookie)
      .send({ actors: [{ name: "X", bild: "javascript:alert(1)" }] });
    expect(bad.status).toBe(400);
    const nochmal = await request(app)
      .post("/api/admin/actors")
      .set("Cookie", adminCookie)
      .send({ actors: [{ name: "Leonardo DiCaprio", bild: "https://neu" }] });
    expect(nochmal.status).toBe(200);
    const row = db.prepare("SELECT bild FROM actors WHERE name = 'Leonardo DiCaprio'").get() as { bild: string };
    expect(row.bild).toBe("https://neu"); // UPSERT
  });

  it("enrich: normaler Lauf endet mit done und füllt nur gewählte Felder", async () => {
    enriched = true;
    const res = await request(app)
      .post("/api/admin/enrich")
      .set("Cookie", adminCookie)
      .send({ fields: ["land"] })
      .buffer(true)
      .parse((response, callback) => {
        let text = "";
        response.on("data", (chunk: Buffer) => {
          text += chunk.toString();
        });
        response.on("end", () => callback(null, text));
      });
    expect(res.status).toBe(200);
    const lines = (res.body as string).trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]) as {
      status: string;
      ergänzt: number;
    };
    expect(last.status).toBe("done");
    expect(last.ergänzt).toBe(1);
    const row = db.prepare("SELECT land, overview FROM movies WHERE tmdb_id = 27205").get() as {
      land: string;
      overview: string | null;
    };
    expect(JSON.parse(row.land)).toEqual(["Deutschland"]);
    expect(row.overview).toBeNull(); // Plot war nicht ausgewählt
  });
});
