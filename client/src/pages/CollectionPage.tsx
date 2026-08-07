import { useCallback, useEffect, useState } from "react";
import { api, type Movie } from "../api";
import MovieCard from "../components/MovieCard";
import SearchModal from "../components/SearchModal";
import MovieDetailModal from "../components/MovieDetailModal";

export default function CollectionPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [genre, setGenre] = useState("");
  const [land, setLand] = useState("");
  const [regisseur, setRegisseur] = useState("");
  const [jahr, setJahr] = useState("");
  const [tmdbMin, setTmdbMin] = useState("");
  const [imdbMin, setImdbMin] = useState("");
  const [medientyp, setMedientyp] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("zuletzt_hinzugefuegt");
  const [facets, setFacets] = useState<{ laender: string[]; regisseure: string[]; jahre: number[] }>({
    laender: [],
    regisseure: [],
    jahre: [],
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const SORT_LABELS: Record<string, string> = {
    zuletzt_hinzugefuegt: "Zuletzt hinzugefügt",
    titel: "Titel A–Z",
    jahr: "Neueste zuerst",
    bewertung: "Beste Bewertung",
    tmdb_bewertung: "Beste TMDb-Bewertung",
    imdb_bewertung: "Beste IMDb-Bewertung",
  };

  const load = useCallback(async () => {
    const filters: Record<string, string> = { sort };
    if (q) filters.q = q;
    if (text) filters.text = text;
    if (genre) filters.genre = genre;
    if (land) filters.land = land;
    if (regisseur) filters.regisseur = regisseur;
    if (jahr) filters.jahr = jahr;
    if (tmdbMin) filters.tmdb_min = tmdbMin;
    if (imdbMin) filters.imdb_min = imdbMin;
    if (medientyp) filters.medientyp = medientyp;
    if (status) filters.status = status;
    const [fresh, c] = await Promise.all([api.collection(filters), api.count(filters)]);
    setMovies(fresh);
    setCount(c.count);
    setDetail((d) => (d ? fresh.find((m) => m.tmdb_id === d.tmdb_id) ?? d : null));
  }, [q, text, genre, land, regisseur, jahr, tmdbMin, imdbMin, medientyp, status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.facets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    api.count({}).then((c) => setTotal(c.count)).catch(() => {});
  }, []);

  const genres = [...new Set(movies.flatMap((m) => m.genres))].sort();

  return (
    <main className="page">
      <div className="filterbar">
        <input placeholder="Titel suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="Alle Felder durchsuchen…" value={text} onChange={(e) => setText(e.target.value)} />
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">Alle Genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select value={land} onChange={(e) => setLand(e.target.value)}>
          <option value="">Alle Länder</option>
          {facets.laender.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select value={regisseur} onChange={(e) => setRegisseur(e.target.value)}>
          <option value="">Alle Regisseure</option>
          {facets.regisseure.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={jahr} onChange={(e) => setJahr(e.target.value)}>
          <option value="">Alle Jahre</option>
          {facets.jahre.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
        <select value={tmdbMin} onChange={(e) => setTmdbMin(e.target.value)}>
          <option value="">TMDb egal</option>
          {[8, 7.5, 7, 6.5, 6].map((v) => (
            <option key={v} value={String(v)}>TMDb ≥ {v.toFixed(1).replace(".0", "")}</option>
          ))}
        </select>
        <select value={imdbMin} onChange={(e) => setImdbMin(e.target.value)}>
          <option value="">IMDb egal</option>
          {[8, 7.5, 7, 6.5, 6].map((v) => (
            <option key={v} value={String(v)}>IMDb ≥ {v.toFixed(1).replace(".0", "")}</option>
          ))}
        </select>
        <select value={medientyp} onChange={(e) => setMedientyp(e.target.value)}>
          <option value="">Filme & Serien</option>
          <option value="film">Filme</option>
          <option value="serie">Serien</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Jeder Status</option>
          <option value="neu">Neu</option>
          <option value="schauen">Schauen</option>
          <option value="gesehen">Gesehen</option>
          <option value="kein_interesse">Kein Interesse</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="zuletzt_hinzugefuegt">Zuletzt hinzugefügt</option>
          <option value="titel">Titel A–Z</option>
          <option value="jahr">Neueste zuerst</option>
          <option value="bewertung">Beste Bewertung</option>
          <option value="tmdb_bewertung">Beste TMDb-Bewertung</option>
          <option value="imdb_bewertung">Beste IMDb-Bewertung</option>
        </select>
        <button className="primary" onClick={() => setSearchOpen(true)}>+ Film suchen</button>
      </div>

      <p className="stat">
        {count ?? "–"} von {total ?? "–"} Filmen · Sortierung: {SORT_LABELS[sort] ?? sort}
      </p>

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
