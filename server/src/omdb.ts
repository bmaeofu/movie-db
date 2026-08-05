export interface OmdbClient {
  /** IMDb-Bewertung (0–10) zu einer imdb_id; null bei fehlendem Eintrag oder Abruf-Fehler (best effort). */
  rating(imdbId: string | null): Promise<number | null>;
}

export function createOmdbClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): OmdbClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async rating(imdbId: string | null): Promise<number | null> {
      if (!imdbId) return null;
      try {
        const u = new URL("https://www.omdbapi.com/");
        u.searchParams.set("apikey", options.apiKey);
        u.searchParams.set("i", imdbId);
        const res = await fetchImpl(u, { signal: AbortSignal.timeout(timeoutMs) });
        const data = (await res.json().catch(() => null)) as {
          Response?: string;
          imdbRating?: string;
        } | null;
        if (!data || data.Response !== "True") return null;
        const r = Number(data.imdbRating);
        return Number.isFinite(r) && r > 0 ? r : null;
      } catch {
        return null;
      }
    },
  };
}
