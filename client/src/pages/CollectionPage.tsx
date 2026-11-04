import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ENRICH_FELD_LABELS, type EnrichField, type Movie } from "../api";
import MovieCard from "../components/MovieCard";
import SearchModal from "../components/SearchModal";
import MovieDetailModal from "../components/MovieDetailModal";

const SEITENGROESSE = 60;

export default function CollectionPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [ladend, setLadend] = useState(false);
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
  const [benutzerWert, setBenutzerWert] = useState("");
  const [medientyp, setMedientyp] = useState("");
  const [status, setStatus] = useState("");
  const [laufzeit, setLaufzeit] = useState("");
  const [sort, setSort] = useState("zuletzt_hinzugefuegt");
  const [facets, setFacets] = useState<{
    laender: string[];
    regisseure: string[];
    jahre: number[];
    schauspieler: string[];
    genres: string[];
  }>({
    laender: [],
    regisseure: [],
    jahre: [],
    schauspieler: [],
    genres: [],
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const fehlt = searchParams.get("fehlt") ?? "";
  const fehltFelder = fehlt.split(",").filter((f): f is EnrichField => f in ENRICH_FELD_LABELS);

  const SORT_LABELS: Record<string, string> = {
    zuletzt_hinzugefuegt: "Zuletzt hinzugefügt",
    titel: "Titel A–Z",
    jahr: "Neueste zuerst",
    bewertung: "Beste Bewertung",
    tmdb_bewertung: "Beste TMDb-Bewertung",
    imdb_bewertung: "Beste IMDb-Bewertung",
    laufzeit_aufsteigend: "Kürzeste Laufzeit",
    laufzeit_absteigend: "Längste Laufzeit",
  };

  // Alle Filter werden serverseitig ausgewertet; die Liste kommt seitenweise.
  const filters = useMemo(() => {
    const f: Record<string, string> = { sort };
    if (q) f.q = q;
    if (text) f.text = text;
    if (genre) f.genre = genre;
    if (land) f.land = land;
    if (regisseur) f.regisseur = regisseur;
    if (schauspieler) f.schauspieler = schauspieler;
    if (jahr) f.jahr = jahr;
    if (tmdbWert === "<5") f.tmdb_max = "5";
    else if (tmdbWert) f.tmdb_min = tmdbWert;
    if (imdbWert === "<5") f.imdb_max = "5";
    else if (imdbWert) f.imdb_min = imdbWert;
    if (benutzerWert) f.rating_min = benutzerWert;
    if (laufzeit === "<15") f.runtime_max = "15";
    else if (laufzeit === "15-30") { f.runtime_min = "15"; f.runtime_max = "30"; }
    else if (laufzeit === "30-60") { f.runtime_min = "30"; f.runtime_max = "60"; }
    else if (laufzeit === "60-90") { f.runtime_min = "60"; f.runtime_max = "90"; }
    else if (laufzeit === "90-120") { f.runtime_min = "90"; f.runtime_max = "120"; }
    else if (laufzeit === "120-150") { f.runtime_min = "120"; f.runtime_max = "150"; }
    else if (laufzeit === ">150") f.runtime_min = "150";
    if (medientyp) f.medientyp = medientyp;
    if (status) f.status = status;
    if (fehlt) f.fehlt = fehlt;
    return f;
  }, [q, text, genre, land, regisseur, schauspieler, jahr, tmdbWert, imdbWert, benutzerWert, medientyp, status, laufzeit, sort, fehlt]);
  const filterKey = JSON.stringify(filters);

  const ladeSeite = useCallback(
    async (offset: number) => {
      setLadend(true);
      try {
        const [frisch, c] = await Promise.all([
          api.collection({ ...filters, limit: String(SEITENGROESSE), offset: String(offset) }),
          offset === 0 ? api.count(filters) : Promise.resolve(null),
        ]);
        if (c) setCount(c.count);
        setMovies((alt) => (offset === 0 ? frisch : [...alt, ...frisch]));
      } catch {
        if (offset === 0) setMovies([]);
      } finally {
        setLadend(false);
      }
    },
    [filterKey]
  );

  useEffect(() => {
    void ladeSeite(0);
  }, [ladeSeite]);

  // Nach dem Hinzufügen öffnen, sobald der Film auf der ersten Seite auftaucht
  useEffect(() => {
    if (pendingOpen === null) return;
    const m = movies.find((x) => x.tmdb_id === pendingOpen);
    if (!m) return;
    setDetail(m);
    setPendingOpen(null);
  }, [movies, pendingOpen]);

  useEffect(() => {
    api.facets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    api.count({}).then((c) => setTotal(c.count)).catch(() => {});
  }, []);

  const genres = facets.genres;

  /** Nach einer Änderung am Film: den geladenen Bereich neu holen (ohne die Seite zu verlieren). */
  async function aktualisiere() {
    const limit = Math.min(Math.max(movies.length, SEITENGROESSE), 500);
    const frisch = await api.collection({ ...filters, limit: String(limit), offset: "0" });
    setMovies(frisch);
    setDetail((d) => (d ? frisch.find((m) => m.tmdb_id === d.tmdb_id) ?? d : null));
  }

  function resetFilters() {
    if (fehlt) {
      const next = new URLSearchParams(searchParams);
      next.delete("fehlt");
      setSearchParams(next, { replace: true });
    }
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
    setBenutzerWert("");
    setMedientyp("");
    setStatus("");
    setLaufzeit("");
    setSort("zuletzt_hinzugefuegt");
  }

  function handleAdded(tmdbId: number, titel: string) {
    setSearchOpen(false);
    setPendingOpen(tmdbId);
    // Suche auf den hinzugefügten Film setzen, damit er im Grid sichtbar ist
    setQ(titel);
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
    setBenutzerWert("");
    setMedientyp("");
    setStatus("");
    setLaufzeit("");
    setSort("zuletzt_hinzugefuegt");
  }

  const hasFilter =
    fehlt !== "" ||
    q !== "" ||
    text !== "" ||
    genre !== "" ||
    land !== "" ||
    regisseur !== "" ||
    schauspieler !== "" ||
    jahr !== "" ||
    tmdbWert !== "" ||
    imdbWert !== "" ||
    benutzerWert !== "" ||
    medientyp !== "" ||
    laufzeit !== "" ||
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
        <select value={benutzerWert} onChange={(e) => setBenutzerWert(e.target.value)}>
          <option value="">Benutzerwertung egal</option>
          {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((v) => (
            <option key={v} value={String(v)}>Benutzer ≥ {v.toFixed(1).replace(".0", "")}</option>
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
        <select value={laufzeit} onChange={(e) => setLaufzeit(e.target.value)}>
          <option value="">Laufzeit egal</option>
          <option value="&lt;15">Unter 15 Min.</option>
          <option value="15-30">15–30 Min.</option>
          <option value="30-60">30–60 Min.</option>
          <option value="60-90">60–90 Min.</option>
          <option value="90-120">90–120 Min.</option>
          <option value="120-150">120–150 Min.</option>
          <option value="&gt;150">Über 150 Min.</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="zuletzt_hinzugefuegt">Zuletzt hinzugefügt</option>
          <option value="titel">Titel A–Z</option>
          <option value="jahr">Neueste zuerst</option>
          <option value="bewertung">Beste Bewertung</option>
          <option value="tmdb_bewertung">Beste TMDb-Bewertung</option>
          <option value="imdb_bewertung">Beste IMDb-Bewertung</option>
          <option value="laufzeit_aufsteigend">Kürzeste Laufzeit</option>
          <option value="laufzeit_absteigend">Längste Laufzeit</option>
        </select>
        <button className="primary" onClick={() => setSearchOpen(true)}>+ Film hinzufügen</button>
        <button onClick={resetFilters} disabled={!hasFilter}>Alle anzeigen</button>
      </div>

      <p className="stat">
        {count ?? "–"} von {total ?? "–"} Filmen · angezeigt: {movies.length} · Sortierung:{" "}
        {SORT_LABELS[sort] ?? sort}
        {fehltFelder.length > 0 && (
          <span className="status-badge" style={{ marginLeft: "0.5rem" }}>
            Fehlt: {fehltFelder.map((f) => ENRICH_FELD_LABELS[f]).join(", ")}{" "}
            <button
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("fehlt");
                setSearchParams(next, { replace: true });
              }}
              aria-label="Filter „fehlende Felder“ entfernen"
            >
              ×
            </button>
          </span>
        )}
      </p>

      {!ladend && movies.length === 0 ? (
        <p className="empty">Keine Filme für diese Auswahl.</p>
      ) : (
        <div className="grid">
          {movies.map((m) => (
            <MovieCard key={m.tmdb_id} movie={m} onClick={() => setDetail(m)} />
          ))}
        </div>
      )}

      {movies.length > 0 && movies.length < (count ?? 0) && (
        <p className="stat">
          <button onClick={() => void ladeSeite(movies.length)} disabled={ladend}>
            {ladend ? "Lädt …" : `Weitere ${Math.min(SEITENGROESSE, (count ?? 0) - movies.length)} laden`}
          </button>
        </p>
      )}

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onAdded={(id, titel) => handleAdded(id, titel)} />}
      {detail && (
        <MovieDetailModal
          movie={detail}
          onClose={() => setDetail(null)}
          onChanged={() => void aktualisiere()}
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
