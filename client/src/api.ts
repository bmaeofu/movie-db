export interface User {
  id: number;
  name: string;
  is_admin: number;
}

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
  my_status: "schauen" | "gesehen" | "kein_interesse" | null;
  my_note: string | null;
  my_list_ids: number[];
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
  addToCollection: (tmdb_id: number, medientyp: string) =>
    request<{ message: string }>("/api/collection", { method: "POST", body: JSON.stringify({ tmdb_id, medientyp }) }),
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
