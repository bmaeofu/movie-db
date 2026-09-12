import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTmdbClient } from "../src/tmdb.js";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function countryList(): Record<string, unknown>[] {
  return [
    { iso_3166_1: "DE", native_name: "Deutschland", english_name: "Germany" },
    { iso_3166_1: "FR", native_name: "Frankreich", english_name: "France" },
  ];
}

describe("TMDB-Details", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("nutzt die englische Overview, wenn die deutsche leer ist", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/configuration/countries")) return jsonResponse(countryList());
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      if (u.searchParams.get("language") === "en-US") {
        return jsonResponse({ id: 1, title: "Test", overview: "English plot", production_countries: [] });
      }
      return jsonResponse({ id: 1, title: "Test", overview: "", production_countries: [] });
    });

    const tmdb = createTmdbClient({ apiKey: "testkey", fetchImpl: fetchMock });
    const movie = await tmdb.details(1, "film");
    expect(movie.overview).toBe("English plot");
  });

  it("macht keinen zweiten Abruf, wenn die deutsche Overview vorhanden ist", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/configuration/countries")) return jsonResponse(countryList());
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      return jsonResponse({ id: 1, title: "Test", overview: "Deutscher Plot", production_countries: [] });
    });

    const tmdb = createTmdbClient({ apiKey: "testkey", fetchImpl: fetchMock });
    const movie = await tmdb.details(1, "film");
    expect(movie.overview).toBe("Deutscher Plot");
    const englischeAbrufe = fetchMock.mock.calls.filter(
      (call) => new URL(String(call[0])).searchParams.get("language") === "en-US"
    );
    expect(englischeAbrufe).toHaveLength(0);
  });

  it("nutzt origin_country, wenn production_countries leer ist", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/configuration/countries")) return jsonResponse(countryList());
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      return jsonResponse({ id: 2, title: "Test", overview: "Plot", production_countries: [], origin_country: ["DE", "FR"] });
    });

    const tmdb = createTmdbClient({ apiKey: "testkey", fetchImpl: fetchMock });
    const movie = await tmdb.details(2, "film");
    expect(movie.land).toEqual(["Deutschland", "Frankreich"]);
  });

  it("bevorzugt production_countries gegenüber origin_country", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/configuration/countries")) return jsonResponse(countryList());
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      return jsonResponse({
        id: 3,
        title: "Test",
        overview: "Plot",
        production_countries: [{ iso_3166_1: "FR", name: "France" }],
        origin_country: ["DE"],
      });
    });

    const tmdb = createTmdbClient({ apiKey: "testkey", fetchImpl: fetchMock });
    const movie = await tmdb.details(3, "film");
    expect(movie.land).toEqual(["Frankreich"]);
  });
});
