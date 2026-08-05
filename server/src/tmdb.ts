export interface TmdbMovie {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
  genres: string[];
  poster_url: string | null;
  overview: string | null;
  land: string[];
  regisseure: string[];
  autoren: string[];
  cast: { name: string; rolle: string }[];
}

export interface TmdbClient {
  search(query: string): Promise<TmdbMovie[]>;
  details(tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie>;
}

export class TmdbError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

export function createTmdbClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}): TmdbClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 3;

  let movieGenres: Map<number, string> | null = null;
  let tvGenres: Map<number, string> | null = null;
  let countries: Map<string, string> | null = null;

  async function request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set("api_key", options.apiKey);
    url.searchParams.set("language", "de-DE");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
      let res: Response;
      try {
        res = await fetchImpl(url);
      } catch (err) {
        lastError = err;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new TmdbError(`TMDB antwortet mit ${res.status}`, res.status);
        continue;
      }
      if (!res.ok) {
        throw new TmdbError(`TMDB antwortet mit ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    }
    throw lastError instanceof Error ? lastError : new TmdbError("TMDB nicht erreichbar");
  }

  async function genreMap(medientyp: "film" | "serie"): Promise<Map<number, string>> {
    const cached = medientyp === "film" ? movieGenres : tvGenres;
    if (cached) return cached;
    const list = await request<{ genres: { id: number; name: string }[] }>(
      medientyp === "film" ? "/genre/movie/list" : "/genre/tv/list",
      {}
    );
    const map = new Map(list.genres.map((g) => [g.id, g.name]));
    if (medientyp === "film") movieGenres = map;
    else tvGenres = map;
    return map;
  }

  async function countryNames(): Promise<Map<string, string>> {
    if (countries) return countries;
    // TMDB liefert ein rohes Array mit english_name/native_name (kein { countries: [...] }-Objekt, kein 'name')
    const list = await request<any[]>("/configuration/countries", {});
    countries = new Map(
      list.map((c) => [c.iso_3166_1, c.native_name || c.english_name || c.name || c.iso_3166_1])
    );
    return countries;
  }

  function mapResult(raw: Record<string, any>, medientyp: "film" | "serie", genres: Map<number, string>): TmdbMovie {
    const date = raw.release_date ?? raw.first_air_date;
    return {
      tmdb_id: raw.id,
      titel: raw.title ?? raw.name ?? "Unbekannter Titel",
      jahr: date ? (Number(date.slice(0, 4)) || null) : null,
      medientyp,
      genres: ((raw.genre_ids ?? []) as number[])
        .map((id) => genres.get(id))
        .filter((g): g is string => Boolean(g)),
      poster_url: raw.poster_path ? POSTER_BASE + raw.poster_path : null,
      overview: raw.overview || null,
      land: [],
      regisseure: [],
      autoren: [],
      cast: [],
    };
  }

  return {
    async search(query: string): Promise<TmdbMovie[]> {
      const data = await request<{ results: any[] }>("/search/multi", { query, include_adult: "false" });
      const [movieMap, tvMap] = await Promise.all([genreMap("film"), genreMap("serie")]);
      return data.results
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .map((r) => mapResult(r, r.media_type === "tv" ? "serie" : "film", r.media_type === "tv" ? tvMap : movieMap));
    },
    async details(tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie> {
      const path = medientyp === "film" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
      const raw = await request<any>(path, { append_to_response: "credits" });
      const genres = await genreMap(medientyp);
      const genreIds = ((raw.genres ?? []) as { id: number }[]).map((g) => g.id);
      const movie = mapResult({ ...raw, genre_ids: genreIds }, medientyp, genres);
      const credits = (raw.credits ?? {}) as { crew?: any[]; cast?: any[] };
      const cn = await countryNames();
      movie.land = ((raw.production_countries ?? []) as { iso_3166_1: string; name: string }[])
        .map((c) => cn.get(c.iso_3166_1) ?? c.name)
        .filter(Boolean);
      if (medientyp === "film") {
        movie.regisseure = (credits.crew ?? [])
          .filter((c) => c.job === "Director")
          .map((c) => c.name);
      } else {
        movie.regisseure = ((raw.created_by ?? []) as { name: string }[]).map((c) => c.name);
      }
      movie.autoren = Array.from(
        new Set(
          (credits.crew ?? [])
            .filter((c) => c.department === "Writing")
            .map((c) => c.name)
        )
      );
      movie.cast = (credits.cast ?? [])
        .slice(0, 15)
        .map((c) => ({ name: c.name, rolle: c.character ?? "" }));
      return movie;
    },
  };
}
