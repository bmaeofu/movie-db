export interface User {
  id: number;
  name: string;
  is_admin: number;
}

export interface EnrichPreview {
  gesamt: number;
  jahr: number;
  poster: number;
  overview: number;
  land: number;
  regisseure: number;
  autoren: number;
  cast: number;
  imdb_bewertung: number;
  laufzeit: number;
}

export type EnrichField = "jahr" | "poster" | "overview" | "land" | "regisseure" | "autoren" | "cast" | "imdb_bewertung" | "laufzeit";

/** Anzeigenamen der Enrich-Felder; identisch zur Feldauswahl im Backend. */
export const ENRICH_FELD_LABELS: Record<EnrichField, string> = {
  jahr: "Jahr",
  poster: "Poster",
  overview: "Plot",
  land: "Land",
  regisseure: "Regie",
  autoren: "Autoren",
  cast: "Cast",
  imdb_bewertung: "IMDb-Bewertung",
  laufzeit: "Laufzeit",
};

export interface SearchResult {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
  genres: string[];
  poster_url: string | null;
  overview: string | null;
}

export interface Movie extends SearchResult {
  added_at: string;
  added_by_name: string;
  avg_rating: number | null;
  rating_count: number;
  my_rating: number | null;
  my_status: "neu" | "schauen" | "gesehen" | "kein_interesse" | null;
  my_note: string | null;
  my_list_ids: number[];
  land: string[];
  regisseure: string[];
  autoren: string[];
  cast: { name: string; rolle: string }[];
  tmdb_bewertung: number | null;
  tmdb_stimmen: number | null;
  imdb_bewertung: number | null;
  imdb_stimmen: number | null;
  imdb_id: string | null;
  laufzeit_minuten: number | null;
  source: string;
}

export interface ListSummary {
  id: number;
  name: string;
  item_count: number;
}

export interface ListDetail {
  id: number;
  name: string;
  items: Movie[];
}

export interface UserSummary extends User {
  created_at: string;
}

export interface DuplikatEintrag {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: string;
  source: string;
  imdb_id: string | null;
}

export interface DuplikatBericht {
  imdb_gruppen: { imdb_id: string; eintraege: DuplikatEintrag[] }[];
  titel_jahr_gruppen: { titel: string; jahr: number | null; eintraege: DuplikatEintrag[] }[];
}

export interface KodiSyncErgebnis {
  geprüft: number;
  importiert: number;
  übersprungen: number;
  importierte_filme: { tmdb_id: number; titel: string }[];
  dubletten: { imdb_id: string; vorhandene_tmdb_id: number; kodi_tmdb_id: number; titel: string }[];
}

export interface LaufzeitErgebnis {
  geprüft: number;
  aktualisiert: number;
  ohne_laufzeit: number;
}

/** Liest eine NDJSON-Antwort zeilenweise mit, damit Zwischenstände live erscheinen. */
async function leseNdjson(res: Response, onLine: (line: unknown) => void): Promise<void> {
  if (!res.body) throw new Error("Keine Antwort erhalten");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let puffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    puffer += decoder.decode(value, { stream: true });
    const zeilen = puffer.split("\n");
    puffer = zeilen.pop() ?? "";
    for (const zeile of zeilen) if (zeile.trim()) onLine(JSON.parse(zeile));
  }
  if (puffer.trim()) onLine(JSON.parse(puffer));
}

async function adminStream(
  path: string,
  body: unknown,
  onLine: (line: unknown) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`Fehler ${res.status}`);
  await leseNdjson(res, onLine);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body as { error?: string }).error) ?? `Fehler ${res.status}`);
  return body as T;
}

export const api = {
  status: () => request<{ needsBootstrap: boolean }>("/api/auth/status"),
  login: (name: string, password: string) => request<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ name, password }) }),
  register: (name: string, password: string) => request<User>("/api/auth/register", { method: "POST", body: JSON.stringify({ name, password }) }),
  changePassword: (altes_password: string, neues_password: string) =>
    request<void>("/api/auth/password", { method: "PUT", body: JSON.stringify({ altes_password, neues_password }) }),
  users: () => request<UserSummary[]>("/api/users"),
  updateUser: (id: number, changes: { name?: string; password?: string; is_admin?: number }) =>
    request<void>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(changes) }),
  deleteUser: (id: number) => request<void>(`/api/users/${id}`, { method: "DELETE" }),
  me: () => request<User>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  search: (q: string) => request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  collection: (filters: Record<string, string>) => request<Movie[]>("/api/collection?" + new URLSearchParams(filters).toString()),
  count: (filters: Record<string, string>) =>
    request<{ count: number }>("/api/collection/count?" + new URLSearchParams(filters).toString()),
  addToCollection: (tmdb_id: number, medientyp: string) =>
    request<{ message: string }>("/api/collection", { method: "POST", body: JSON.stringify({ tmdb_id, medientyp }) }),
  enrichFilm: (tmdb_id: number) =>
    request<{ ergänzt: string[] }>(`/api/collection/${tmdb_id}/enrich`, { method: "POST", body: "{}" }),
  enrichPreview: () => request<EnrichPreview>("/api/admin/enrich-preview"),
  enrich: (fields: EnrichField[], onLine: (line: unknown) => void, signal?: AbortSignal) =>
    adminStream("/api/admin/enrich?omdb_limit=900", { fields }, onLine, signal),
  kodiSync: () => request<KodiSyncErgebnis>("/api/admin/kodi-full-sync", { method: "POST", body: "{}" }),
  kodiPoster: (onLine: (line: unknown) => void) => adminStream("/api/admin/enrich-posters", {}, onLine),
  kodiSchauspieler: (onLine: (line: unknown) => void) => adminStream("/api/admin/enrich-actors", {}, onLine),
  laufzeiten: () => request<LaufzeitErgebnis>("/api/admin/runtime-backfill-tmdb", { method: "POST", body: "{}" }),
  dubletten: () => request<DuplikatBericht>("/api/admin/duplicates"),
  addCustomMovie: (payload: {
    titel: string;
    jahr?: number | null;
    medientyp: string;
    genres?: string[];
    overview?: string | null;
    land?: string[];
    regisseure?: string[];
    autoren?: string[];
    cast?: { name: string; rolle: string }[];
  }) =>
    request<{ message: string; tmdb_id: number }>("/api/collection/custom", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  facets: () =>
    request<{ laender: string[]; regisseure: string[]; jahre: number[]; schauspieler: string[] }>(
      "/api/collection/facets"
    ),
  actorImageUrl: (name: string) => `/api/actors/${encodeURIComponent(name)}/image`,
  removeFromCollection: (tmdbId: number) => request<void>(`/api/collection/${tmdbId}`, { method: "DELETE" }),
  setRating: (tmdbId: number, sterne: number) =>
    request<void>(`/api/movies/${tmdbId}/rating`, { method: "PUT", body: JSON.stringify({ sterne }) }),
  setWatchStatus: (tmdbId: number, status: string) =>
    request<void>(`/api/movies/${tmdbId}/watch-status`, { method: "PUT", body: JSON.stringify({ status }) }),
  setNote: (tmdbId: number, text: string) =>
    request<void>(`/api/movies/${tmdbId}/note`, { method: "PUT", body: JSON.stringify({ text }) }),
  deleteNote: (tmdbId: number) => request<void>(`/api/movies/${tmdbId}/note`, { method: "DELETE" }),
  lists: () => request<ListSummary[]>("/api/lists"),
  createList: (name: string) => request<{ id: number; name: string }>("/api/lists", { method: "POST", body: JSON.stringify({ name }) }),
  renameList: (id: number, name: string) => request<void>(`/api/lists/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteList: (id: number) => request<void>(`/api/lists/${id}`, { method: "DELETE" }),
  listItems: (id: number) => request<ListDetail>(`/api/lists/${id}`),
  addToList: (listId: number, tmdbId: number) =>
    request<void>(`/api/lists/${listId}/items`, { method: "POST", body: JSON.stringify({ tmdb_id: tmdbId }) }),
  removeFromList: (listId: number, tmdbId: number) =>
    request<void>(`/api/lists/${listId}/items/${tmdbId}`, { method: "DELETE" }),
};
