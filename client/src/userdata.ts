import { api, type Movie } from "./api";

/**
 * Ergaenzt die Marken aus der Hauptanwendung: Bewertung, Watch-Status und Notiz
 * eines Kontos sowie den Durchschnitt aller Konten. Die Filmdatenbank kennt sie
 * nicht mehr, die Antwort bleibt aber dieselbe Form wie vorher.
 */
export async function withUserData(movies: Movie[]): Promise<Movie[]> {
  if (movies.length === 0) return movies;
  const data = await api.userData();
  return movies.map((movie) => {
    const meine = data.mine[String(movie.tmdb_id)] ?? { rating: null, status: null, note: null };
    const schnitt = data.ratings[String(movie.tmdb_id)] ?? { avg: null, count: 0 };
    return {
      ...movie,
      my_rating: meine.rating ?? null,
      my_status: (meine.status ?? null) as Movie["my_status"],
      my_note: meine.note ?? null,
      avg_rating: schnitt.avg ?? null,
      rating_count: schnitt.count ?? 0,
    };
  });
}
