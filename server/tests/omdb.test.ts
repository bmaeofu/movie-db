import { describe, expect, it, vi } from "vitest";
import { createOmdbClient } from "../src/omdb.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("OMDb-Client", () => {
  it("parst die IMDb-Bewertung aus einer erfolgreichen Antwort", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ Response: "True", imdbRating: "8.1", imdbVotes: "1234" }));
    const client = createOmdbClient({ apiKey: "k", fetchImpl: fetchMock as any });
    expect(await client.rating("tt1375666")).toBe(8.1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("apikey=k");
    expect(url).toContain("i=tt1375666");
  });

  it("liefert null bei Fehlerantwort, kaputtem JSON, Fehler und ohne imdb_id", async () => {
    const fail = vi.fn(async () => jsonResponse({ Response: "False", Error: "Movie not found!" }));
    expect(await createOmdbClient({ apiKey: "k", fetchImpl: fail as any }).rating("tt9999999")).toBeNull();
    const broken = vi.fn(async () => new Response("kaputt", { status: 200 }));
    expect(await createOmdbClient({ apiKey: "k", fetchImpl: broken as any }).rating("tt1")).toBeNull();
    const throws = vi.fn(async () => {
      throw new Error("netz");
    });
    expect(await createOmdbClient({ apiKey: "k", fetchImpl: throws as any }).rating("tt1")).toBeNull();
    expect(await createOmdbClient({ apiKey: "k", fetchImpl: vi.fn() as any }).rating(null)).toBeNull();
  });
});
