import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { createTmdbClient } from "../src/tmdb.js";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tmdbSearchResponse(): Record<string, unknown> {
  return {
    results: [
      { id: 27205, title: "Inception", release_date: "2010-07-15", media_type: "movie", genre_ids: [28, 878], overview: "Traum im Traum", poster_path: "/x.jpg" },
      { id: 1399, name: "Game of Thrones", first_air_date: "2011-04-17", media_type: "tv", genre_ids: [18], overview: "Eiserne Throne", poster_path: "/y.jpg" },
      { id: 999, name: "Jemand", media_type: "person" },
    ],
  };
}

describe("TMDB-Suche", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminCookie: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    db = createDb(":memory:");
    app = createApp(db, createTmdbClient({ apiKey: "testkey", fetchImpl: fetchMock }));
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    adminCookie = admin.headers["set-cookie"][0].split(";")[0];
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("mappt Suchergebnisse und filtert 'person' heraus", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [{ id: 28, name: "Action" }, { id: 878, name: "Science Fiction" }] });
      if (u.pathname.endsWith("/genre/tv/list")) return jsonResponse({ genres: [{ id: 18, name: "Drama" }] });
      return jsonResponse(tmdbSearchResponse());
    });
    const res = await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toMatchObject({ tmdb_id: 27205, titel: "Inception", jahr: 2010, medientyp: "film", genres: ["Action", "Science Fiction"] });
    expect(res.body.results[1]).toMatchObject({ tmdb_id: 1399, titel: "Game of Thrones", medientyp: "serie", genres: ["Drama"] });
  });

  it("cacht die zweite identische Suche (kein zweiter TMDB-Call)", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      if (u.pathname.endsWith("/genre/tv/list")) return jsonResponse({ genres: [] });
      return jsonResponse(tmdbSearchResponse());
    });
    await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    const callsNachErster = fetchMock.mock.calls.length;
    const res = await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(callsNachErster);
  });

  it("wiederholt bei HTTP 429 mit Backoff und liefert dann Ergebnisse", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      if (u.pathname.endsWith("/genre/tv/list")) return jsonResponse({ genres: [] });
      calls++;
      return calls === 1 ? jsonResponse({}, 429) : jsonResponse(tmdbSearchResponse());
    });
    const res = await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("liefert 401 ohne Session und 400 ohne q", async () => {
    const unauth = await request(app).get("/api/search?q=inception");
    expect(unauth.status).toBe(401);
    const noQ = await request(app).get("/api/search").set("Cookie", adminCookie);
    expect(noQ.status).toBe(400);
  });
});
