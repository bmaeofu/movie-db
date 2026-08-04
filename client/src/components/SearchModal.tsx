import { useState, type FormEvent } from "react";
import { api, type SearchResult } from "../api";

export default function SearchModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Film suchen</h2>
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
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
