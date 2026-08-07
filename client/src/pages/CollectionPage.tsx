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
  const [regisseurInput, setRegisseurInput] = useState("");
  const [schauspieler, setSchauspieler] = useState("");
  const [schauspielerInput, setSchauspielerInput] = useState("");
  const [jahr, setJahr] = useState("");
  const [tmdbWert, setTmdbWert] = useState("");
  const [imdbWert, setImdbWert] = useState("");
  const [medientyp, setMedientyp] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("zuletzt_hinzugefuegt");
  const [facets, setFacets] = useState<{ laender: string[]; regisseure: string[]; jahre: number[]; schauspieler: string[] }>({
    laender: [],
    regisseure: [],
    jahre: [],
    schauspieler: [],
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
    if (schauspieler) filters.schauspieler = schauspieler;
    if (jahr) filters.jahr = jahr;
    if (tmdbWert === "<5") filters.tmdb_max = "5";
    else if (tmdbWert) filters.tmdb_min = tmdbWert;
    if (imdbWert === "<5") filters.imdb_max = "5";
    else if (imdbWert) filters.imdb_min = imdbWert;
    if (medientyp) filters.medientyp = medientyp;
    if (status) filters.status = status;
    const [fresh, c] = await Promise.all([api.collection(filters), api.count(filters)]);
    setMovies(fresh);
    setCount(c.count);
    setDetail((d) => (d ? fresh.find((m) => m.tmdb_id === d.tmdb_id) ?? d : null));
  }, [q, text, genre, land, regisseur, schauspieler, jahr, tmdbWert, imdbWert, medientyp, status, sort]);

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

  function resetFilters() {
    setQ("");
    setText("");
    setGenre("");
    setLand("");
    setRegisseur("");
    setRegisseurInput("");
    setSchauspielerInput("");
    setSchauspieler("");
    setJahr("");
    setTmdbWert("");
    setImdbWert("");
    setMedientyp("");
    setStatus("");
    setSort("zuletzt_hinzugefuegt");
  }

  const hasFilter =
    q !== "" ||
    text !== "" ||
    genre !== "" ||
    land !== "" ||
    regisseur !== "" ||
    schauspieler !== "" ||
    jahr !== "" ||
    tmdbWert !== "" ||
    imdbWert !== "" ||
    medientyp !== "" ||
    status !== "" ||
    sort !== "zuletzt_hinzugefuegt";

  return (
    <main className="page">
      <div
        className="filterbar"
        onKeyDown={(e) => {
          if (e.key === "Escape") resetFilters();
        }}
      >
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
        <input
          list="regisseur-list"
          placeholder="Regisseur suchen…"
          value={regisseurInput}
          onChange={(e) => {
            const v = e.target.value;
            setRegisseurInput(v);
            if (facets.regisseure.includes(v)) setRegisseur(v);
            else setRegisseur("");
          }}
        />
        <datalist id="regisseur-list">
          {facets.regisseure
            .filter((r) => r.toLowerCase().includes(regisseurInput.toLowerCase()))
            .slice(0, 200)
            .map((r) => (
              <option key={r} value={r} />
            ))}
        </datalist>
        <input
          list="schauspieler-list"
          placeholder="Schauspieler suchen…"
          value={schauspielerInput}
          onChange={(e) => {
            const v = e.target.value;
            setSchauspielerInput(v);
            if (facets.schauspieler.includes(v)) setSchauspieler(v);
            else setSchauspieler("");
          }}
        />
        <datalist id="schauspieler-list">
          {facets.schauspieler
            .filter((s) => s.toLowerCase().includes(schauspielerInput.toLowerCase()))
            .slice(0, 200)
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
        {schauspieler && schauspieler === schauspielerInput && (
          <img
            className="actor-photo"
            src={api.actorImageUrl(schauspieler)}
            alt={schauspieler}
            title={schauspieler}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}
        <select value={jahr} onChange={(e) => setJahr(e.target.value)}>
          <option value="">Alle Jahre</option>
          {facets.jahre.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
        <select value={tmdbWert} onChange={(e) => setTmdbWert(e.target.value)}>
          <option value="">TMDb egal</option>
          {[8, 7.5, 7, 6.5, 6, 5.5, 5].map((v) => (
            <option key={v} value={String(v)}>TMDb ≥ {v.toFixed(1).replace(".0", "")}</option>
          ))}
          <option value="<5">TMDb &lt; 5</option>
        </select>
        <select value={imdbWert} onChange={(e) => setImdbWert(e.target.value)}>
          <option value="">IMDb egal</option>
          {[8, 7.5, 7, 6.5, 6, 5.5, 5].map((v) => (
            <option key={v} value={String(v)}>IMDb ≥ {v.toFixed(1).replace(".0", "")}</option>
          ))}
          <option value="<5">IMDb &lt; 5</option>
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
        <button className="primary" onClick={() => setSearchOpen(true)}>+ Film hinzufügen</button>
        <button onClick={resetFilters} disabled={!hasFilter}>Alle anzeigen</button>
      </div>

      <p className="stat">
        {count ?? "–"} von {total ?? "–"} Filmen · Sortierung: {SORT_LABELS[sort] ?? sort}
      </p>

      {movies.length === 0 ? (
        <p className="empty">Noch keine Filme. Klick auf „+ Film hinzufügen“.</p>
      ) : (
        <div className="grid">
          {movies.map((m) => (
            <MovieCard key={m.tmdb_id} movie={m} onClick={() => setDetail(m)} />
          ))}
        </div>
      )}

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onAdded={() => void load()} />}
      {detail && (
        <MovieDetailModal
          movie={detail}
          onClose={() => setDetail(null)}
          onChanged={() => void load()}
          onSelectActor={(name) => {
            setSchauspieler(name);
            setSchauspielerInput(name);
            setDetail(null);
          }}
          onSelectGenre={(g) => {
            setGenre(g);
            setDetail(null);
          }}
          onSelectLand={(l) => {
            setLand(l);
            setDetail(null);
          }}
          onSelectRegisseur={(r) => {
            setRegisseur(r);
            setRegisseurInput(r);
            setDetail(null);
          }}
        />
      )}
    </main>
  );
}
