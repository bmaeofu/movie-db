import { useCallback, useEffect, useState } from "react";
import { api, type Movie } from "../api";
import MovieCard from "../components/MovieCard";
import SearchModal from "../components/SearchModal";
import MovieDetailModal from "../components/MovieDetailModal";

export default function CollectionPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [medientyp, setMedientyp] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("zuletzt_hinzugefuegt");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<Movie | null>(null);

  const load = useCallback(async () => {
    const filters: Record<string, string> = { sort };
    if (q) filters.q = q;
    if (genre) filters.genre = genre;
    if (medientyp) filters.medientyp = medientyp;
    if (status) filters.status = status;
    setMovies(await api.collection(filters));
  }, [q, genre, medientyp, status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const genres = [...new Set(movies.flatMap((m) => m.genres))].sort();

  return (
    <main className="page">
      <div className="filterbar">
        <input placeholder="Titel suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">Alle Genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select value={medientyp} onChange={(e) => setMedientyp(e.target.value)}>
          <option value="">Filme & Serien</option>
          <option value="film">Filme</option>
          <option value="serie">Serien</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Jeder Status</option>
          <option value="schauen">Schauen</option>
          <option value="gesehen">Gesehen</option>
          <option value="kein_interesse">Kein Interesse</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="zuletzt_hinzugefuegt">Zuletzt hinzugefügt</option>
          <option value="titel">Titel A–Z</option>
          <option value="jahr">Neueste zuerst</option>
          <option value="bewertung">Beste Bewertung</option>
        </select>
        <button className="primary" onClick={() => setSearchOpen(true)}>+ Film suchen</button>
      </div>

      {movies.length === 0 ? (
        <p className="empty">Noch keine Filme. Klick auf „+ Film suchen“.</p>
      ) : (
        <div className="grid">
          {movies.map((m) => (
            <MovieCard key={m.tmdb_id} movie={m} onClick={() => setDetail(m)} />
          ))}
        </div>
      )}

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onAdded={() => void load()} />}
      {detail && <MovieDetailModal movie={detail} onClose={() => setDetail(null)} onChanged={() => void load()} />}
    </main>
  );
}
