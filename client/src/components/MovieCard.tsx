import type { Movie } from "../api";

export default function MovieCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  return (
    <button className="card" onClick={onClick} aria-label={movie.titel}>
      {movie.poster_url ? (
        <img src={movie.poster_url} alt={movie.titel} loading="lazy" />
      ) : (
        <div className="no-poster">{movie.titel}</div>
      )}
      <div className="card-info">
        <h3>{movie.titel} {movie.jahr ? `(${movie.jahr})` : ""}</h3>
        <div className="meta">
          <span>{movie.medientyp === "film" ? "Film" : "Serie"}</span>
          {movie.source === "kodi" && <span className="status-badge">Kodi</span>}
          {movie.laufzeit_minuten !== null && <span aria-label="Laufzeit">{movie.laufzeit_minuten} Min.</span>}
          <span aria-label="Durchschnittsbewertung">★ {movie.avg_rating ?? "–"} ({movie.rating_count})</span>
          {movie.tmdb_bewertung !== null && <span aria-label="TMDB-Bewertung">TMDb {movie.tmdb_bewertung.toFixed(1)}</span>}
          {movie.imdb_bewertung !== null && <span aria-label="IMDb-Bewertung">IMDb {movie.imdb_bewertung.toFixed(1)}</span>}
          {movie.my_status && <span className="status-badge">{movie.my_status}</span>}
        </div>
      </div>
    </button>
  );
}
