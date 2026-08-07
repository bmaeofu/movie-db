export interface OmdbRating {
  bewertung: number;
  stimmen: number | null;
}

export interface OmdbClient {
  /** IMDb-Bewertung + Stimmen zu einer imdb_id; null bei fehlendem Eintrag oder Abruf-Fehler (best effort). */
  rating(imdbId: string | null): Promise<OmdbRating | null>;
}

export function createOmdbClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): OmdbClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async rating(imdbId: string | null): Promise<OmdbRating | null> {
      if (!imdbId) return null;
      try {
        const u = new URL("https://www.omdbapi.com/");
        u.searchParams.set("apikey", options.apiKey);
        u.searchParams.set("i", imdbId);
        const res = await fetchImpl(u, { signal: AbortSignal.timeout(timeoutMs) });
        const data = (await res.json().catch(() => null)) as {
          Response?: string;
          imdbRating?: string;
          imdbVotes?: string;
        } | null;
        if (!data || data.Response !== "True") return null;
        const r = Number(data.imdbRating);
        if (!Number.isFinite(r) || r <= 0) return null;
        const votesRaw = data.imdbVotes && data.imdbVotes !== "N/A" ? Number(data.imdbVotes.replace(/,/g, "")) : null;
        return {
          bewertung: Math.round(r * 10) / 10,
          stimmen: Number.isFinite(votesRaw as number) ? (votesRaw as number) : null,
        };
      } catch {
        return null;
      }
    },
  };
}
