import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db.js";
import { syncKodiMovies, type KodiSyncConfig, type KodiVerbindung } from "../src/kodiSync.js";

const cfg: KodiSyncConfig = { host: "h", port: 3306, database: "d", user: "u", password: "p" };

function kodiZeile(tmdbId: number, titel: string, imdbId: string | null, datei: string | null = "Film.mkv"): Record<string, unknown> {
  return {
    tmdb_id: String(tmdbId),
    titel,
    datei,
    jahr: "1999",
    laufzeit: 100,
    overview: "Plot",
    genres: "Action",
    laender: "Deutschland",
    regisseure: "Regie",
    autoren: "Autor",
    imdb_bewertung: 7.1,
    imdb_stimmen: 100,
    tmdb_bewertung: 7.2,
    tmdb_stimmen: 200,
    imdb_id: imdbId,
    poster: null,
  };
}

function fakeVerbindung(movieRows: Record<string, unknown>[], castRows: Record<string, unknown>[] = []): KodiVerbindung {
  return {
    query: async (sql: string) => {
      if (sql.includes("actor_link")) return [castRows, []];
      return [movieRows, []];
    },
    end: async () => {},
  };
}

describe("Kodi-Sync", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(":memory:");
    db.prepare("INSERT INTO users (name, password_hash, is_admin) VALUES ('Anna', 'x', 1)").run();
  });

  function bekanntenFilmAnlegen(tmdbId: number, titel: string, imdbId: string): void {
    db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                           land, regisseure, autoren, "cast")
       VALUES (?, ?, 1999, 'film', '[]', NULL, 'Plot', ?, '[]', '[]', '[]', '[]')`
    ).run(tmdbId, titel, JSON.stringify({ imdb_id: imdbId }));
    db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, 1)").run(tmdbId);
  }

  it("legt neue Kodi-Filme an", async () => {
    const ergebnis = await syncKodiMovies(db, cfg, async () => fakeVerbindung([kodiZeile(555, "Neuer Film", "tt1")]));
    expect(ergebnis.importiert).toBe(1);
    expect(ergebnis.dubletten).toEqual([]);
    const zeile = db.prepare("SELECT titel FROM movies WHERE tmdb_id = 555").get() as { titel: string } | undefined;
    expect(zeile?.titel).toBe("Neuer Film");
  });

  it("legt keinen zweiten Eintrag an, wenn die IMDb-ID schon unter anderer TMDB-ID existiert", async () => {
    bekanntenFilmAnlegen(115982, "Es", "tt0059153");
    const ergebnis = await syncKodiMovies(db, cfg, async () => fakeVerbindung([kodiZeile(133035, "", "tt0059153")]));

    expect(ergebnis.importiert).toBe(0);
    expect(ergebnis.dubletten).toEqual([
      { imdb_id: "tt0059153", vorhandene_tmdb_id: 115982, kodi_tmdb_id: 133035, titel: "" },
    ]);
    const neu = db.prepare("SELECT COUNT(*) n FROM movies WHERE tmdb_id = 133035").get() as { n: number };
    expect(neu.n).toBe(0);
    // bestehender Eintrag bleibt unverändert
    const alt = db.prepare("SELECT titel FROM movies WHERE tmdb_id = 115982").get() as { titel: string };
    expect(alt.titel).toBe("Es");
  });

  it("importiert Filme mit anderer IMDb-ID weiterhin", async () => {
    bekanntenFilmAnlegen(115982, "Es", "tt0059153");
    const ergebnis = await syncKodiMovies(db, cfg, async () =>
      fakeVerbindung([kodiZeile(1, "A", "ttA"), kodiZeile(133035, "B", "tt0059153"), kodiZeile(2, "C", "ttC")])
    );
    expect(ergebnis.importiert).toBe(2);
    expect(ergebnis.dubletten).toHaveLength(1);
    expect(ergebnis.importierte_filme.map((f) => f.tmdb_id)).toEqual([1, 2]);
  });

  it("überspringt nicht, wenn die IMDb-ID nur an einer Zeile außerhalb der Sammlung hängt", async () => {
    db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json, land, regisseure, autoren, "cast")
       VALUES (11190, 'The Return - Die Rückkehr', 2003, 'film', '[]', NULL, 'Plot', ?, '[]', '[]', '[]', '[]')`
    ).run(JSON.stringify({ imdb_id: "tt0376968" }));

    const ergebnis = await syncKodiMovies(db, cfg, async () => fakeVerbindung([kodiZeile(999, "Die Rückkehr", "tt0376968")]));
    expect(ergebnis.importiert).toBe(1);
    expect(ergebnis.dubletten).toEqual([]);
  });

  it("nimmt den Dateinamen, wenn Kodi keinen Titel liefert", async () => {
    const ergebnis = await syncKodiMovies(db, cfg, async () =>
      fakeVerbindung([kodiZeile(601, "", null, "Eine fremde Tochter.mkv"), kodiZeile(602, "   ", null, "Rückkehr nach Rimini.mkv")])
    );
    expect(ergebnis.importiert).toBe(2);
    const titel = db.prepare("SELECT tmdb_id, titel FROM movies ORDER BY tmdb_id").all() as { tmdb_id: number; titel: string }[];
    expect(titel).toEqual([
      { tmdb_id: 601, titel: "Eine fremde Tochter" },
      { tmdb_id: 602, titel: "Rückkehr nach Rimini" },
    ]);
  });

  it("überspringt Kodi-Filme ohne IMDb-ID nicht fälschlich", async () => {
    bekanntenFilmAnlegen(115982, "Es", "tt0059153");
    const ergebnis = await syncKodiMovies(db, cfg, async () => fakeVerbindung([kodiZeile(777, "Ohne IMDb", null)]));
    expect(ergebnis.importiert).toBe(1);
    expect(ergebnis.dubletten).toEqual([]);
  });
});
