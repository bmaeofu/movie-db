import { useState, type FormEvent } from "react";
import { api, type SearchResult } from "../api";

export default function SearchModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<"suche" | "manuell">("suche");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Manuelle Eingabe
  const [titel, setTitel] = useState("");
  const [jahr, setJahr] = useState("");
  const [medientyp, setMedientyp] = useState("film");
  const [genres, setGenres] = useState("");
  const [land, setLand] = useState("");
  const [regisseure, setRegisseure] = useState("");
  const [autoren, setAutoren] = useState("");
  const [cast, setCast] = useState("");
  const [overview, setOverview] = useState("");
  const [manualMsg, setManualMsg] = useState("");
  const [manualErr, setManualErr] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults((await api.search(q.trim())).results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suche fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function add(r: SearchResult) {
    setError("");
    try {
      await api.addToCollection(r.tmdb_id, r.medientyp);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hinzufügen fehlgeschlagen");
    }
  }

  async function addManual(e: FormEvent) {
    e.preventDefault();
    setManualMsg("");
    setManualErr(false);
    try {
      const j = jahr.trim() === "" ? null : Number(jahr);
      if (j !== null && (!Number.isInteger(j) || j < 1888 || j > 2100)) {
        throw new Error("Jahr muss eine gültige Jahreszahl sein");
      }
      await api.addCustomMovie({
        titel: titel.trim(),
        jahr: j,
        medientyp,
        genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
        land: land.split(",").map((g) => g.trim()).filter(Boolean),
        regisseure: regisseure.split(",").map((g) => g.trim()).filter(Boolean),
        autoren: autoren.split(",").map((g) => g.trim()).filter(Boolean),
        cast: cast.split("\n").map((l) => {
          const [name, rolle] = l.split("|");
          return { name: (name ?? "").trim(), rolle: (rolle ?? "").trim() };
        }).filter((c) => c.name !== ""),
        overview: overview.trim() === "" ? null : overview.trim(),
      });
      setManualMsg("Zur Sammlung hinzugefügt.");
      setTitel("");
      setJahr("");
      setGenres("");
      setLand("");
      setRegisseure("");
      setAutoren("");
      setCast("");
      setOverview("");
      onAdded();
    } catch (err) {
      setManualMsg(err instanceof Error ? err.message : "Fehler");
      setManualErr(true);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Film hinzufügen</h2>
        <div className="mode-toggle">
          <button className={mode === "suche" ? "active" : ""} onClick={() => setMode("suche")}>
            TMDB-Suche
          </button>
          <button className={mode === "manuell" ? "active" : ""} onClick={() => setMode("manuell")}>
            Manuell anlegen
          </button>
        </div>

        {mode === "suche" && (
          <>
            <form onSubmit={onSubmit}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titel bei TMDB suchen…" autoFocus />
              <button type="submit" disabled={busy}>{busy ? "Suche…" : "Suchen"}</button>
            </form>
            {error && <p className="error">{error}</p>}
            <ul className="search-results">
              {results.map((r) => (
                <li key={`${r.medientyp}-${r.tmdb_id}`}>
                  {r.poster_url && <img src={r.poster_url} alt="" />}
                  <div>
                    <strong>{r.titel}</strong> {r.jahr ? `(${r.jahr})` : ""} – {r.medientyp === "film" ? "Film" : "Serie"}
                  </div>
                  <button onClick={() => add(r)}>Hinzufügen</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {mode === "manuell" && (
          <form onSubmit={addManual} className="user-form">
            <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Titel *" autoFocus />
            <div className="manual-row">
              <input value={jahr} onChange={(e) => setJahr(e.target.value)} placeholder="Jahr" inputMode="numeric" />
              <select value={medientyp} onChange={(e) => setMedientyp(e.target.value)}>
                <option value="film">Film</option>
                <option value="serie">Serie</option>
              </select>
            </div>
            <input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Genres (kommagetrennt, optional)" />
            <input value={land} onChange={(e) => setLand(e.target.value)} placeholder="Land/Länder (kommagetrennt, optional)" />
            <input value={regisseure} onChange={(e) => setRegisseure(e.target.value)} placeholder="Regisseure (kommagetrennt, optional)" />
            <input value={autoren} onChange={(e) => setAutoren(e.target.value)} placeholder="Autoren (kommagetrennt, optional)" />
            <textarea value={cast} onChange={(e) => setCast(e.target.value)} placeholder="Schauspieler (eine Zeile pro Person: Name|Rolle, optional)" />
            <textarea value={overview} onChange={(e) => setOverview(e.target.value)} placeholder="Beschreibung (optional)" />
            <button type="submit" className="primary">Zur Sammlung hinzufügen</button>
            {manualMsg && <p className={manualErr ? "error" : "ok"}>{manualMsg}</p>}
          </form>
        )}

        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
