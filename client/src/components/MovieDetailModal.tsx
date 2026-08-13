import { useEffect, useState } from "react";
import { api, type ListSummary, type Movie } from "../api";

const STATUS_OPTIONS: Array<["neu" | "schauen" | "gesehen" | "kein_interesse", string]> = [
  ["neu", "Neu"],
  ["schauen", "Schauen"],
  ["gesehen", "Gesehen"],
  ["kein_interesse", "Kein Interesse"],
];

export default function MovieDetailModal({
  movie,
  onClose,
  onChanged,
  onSelectActor,
  onSelectGenre,
  onSelectLand,
  onSelectRegisseur,
}: {
  movie: Movie;
  onClose: () => void;
  onChanged: () => void;
  onSelectActor?: (name: string) => void;
  onSelectGenre?: (genre: string) => void;
  onSelectLand?: (land: string) => void;
  onSelectRegisseur?: (name: string) => void;
}) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [inLists, setInLists] = useState<Set<number>>(new Set(movie.my_list_ids));
  const [note, setNote] = useState(movie.my_note ?? "");
  const [saved, setSaved] = useState("");
  const [savedIsError, setSavedIsError] = useState(false);
  const [showPictures, setShowPictures] = useState(false);

  useEffect(() => {
    api.lists().then(setLists).catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key.toLowerCase() === "p") setShowPictures((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function change(action: () => Promise<void>, okText: string): Promise<boolean> {
    setSaved("");
    setSavedIsError(false);
    try {
      await action();
      setSaved(okText);
      onChanged();
      return true;
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Fehler");
      setSavedIsError(true);
      return false;
    }
  }

  async function toggleList(listId: number) {
    const next = new Set(inLists);
    if (next.has(listId)) {
      next.delete(listId);
      if (await change(() => api.removeFromList(listId, movie.tmdb_id), "Aus Liste entfernt.")) {
        setInLists(next);
      }
    } else {
      next.add(listId);
      if (await change(() => api.addToList(listId, movie.tmdb_id), "Zur Liste hinzugefügt.")) {
        setInLists(next);
      }
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal movie-detail" onClick={(e) => e.stopPropagation()}>
        <h2>{movie.titel} {movie.jahr ? `(${movie.jahr})` : ""}</h2>
        <p className="genres">
          Quelle: {movie.source === "kodi" ? "Kodi" : `Manuell hinzugefügt${movie.added_by_name ? ` von ${movie.added_by_name}` : ""}`}
        </p>
        {movie.laufzeit_minuten !== null && <p className="genres">Laufzeit: {movie.laufzeit_minuten} Min.</p>}
        {movie.overview && <p className="overview">{movie.overview}</p>}
        {movie.genres.length > 0 && (
          <p className="genres">Genres: {movie.genres.map((g) => (
            <button key={g} className="chip" onClick={onSelectGenre ? () => onSelectGenre(g) : undefined}>{g}</button>
          ))}</p>
        )}
        {(movie.tmdb_bewertung !== null || movie.imdb_bewertung !== null) && (
          <p className="genres">
            {movie.tmdb_bewertung !== null && (
              <span>TMDB: {movie.tmdb_bewertung.toFixed(1)}{movie.tmdb_stimmen ? ` (${movie.tmdb_stimmen.toLocaleString("de-DE")} Stimmen)` : ""}</span>
            )}
            {movie.tmdb_bewertung !== null && movie.imdb_bewertung !== null && " · "}
            {movie.imdb_bewertung !== null && (
              <span>IMDb: {movie.imdb_bewertung.toFixed(1)}{movie.imdb_stimmen ? ` (${movie.imdb_stimmen.toLocaleString("de-DE")} Stimmen)` : ""}</span>
            )}
          </p>
        )}
        {movie.land.length > 0 && (
          <p className="genres">Land: {movie.land.map((l) => (
            <button key={l} className="chip" onClick={onSelectLand ? () => onSelectLand(l) : undefined}>{l}</button>
          ))}</p>
        )}
        {movie.regisseure.length > 0 && (
          <p className="genres">Regie: {movie.regisseure.map((r) => (
            <button key={r} className="chip" onClick={onSelectRegisseur ? () => onSelectRegisseur(r) : undefined}>{r}</button>
          ))}</p>
        )}
        {movie.autoren.length > 0 && <p className="genres">Autoren: {movie.autoren.join(", ")}</p>}
        {movie.cast.length > 0 && (
          <>
            <div className="cast-head">
              <span>Besetzung:</span>
              <button onClick={() => setShowPictures((v) => !v)}>
                {showPictures ? "Bilder ausblenden (P)" : "Bilder zeigen (P)"}
              </button>
            </div>
            <ul className="cast-list">
              {movie.cast.map((c, i) => (
                <li
                  key={i}
                  className={`cast-item${onSelectActor ? " clickable" : ""}`}
                  onClick={onSelectActor ? () => onSelectActor(c.name) : undefined}
                  title={onSelectActor ? `In Schauspieler-Filter übernehmen: ${c.name}` : undefined}
                >
                  {showPictures && (
                    <img
                      className="cast-photo"
                      src={api.actorImageUrl(c.name)}
                      alt={c.name}
                      loading="lazy"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    />
                  )}
                  <span>{c.name}{c.rolle ? ` → ${c.rolle}` : ""}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p>Durchschnitt: ★ {movie.avg_rating ?? "–"} ({movie.rating_count} Bewertungen)</p>

        <div className="rating">
          <span>Meine Bewertung:</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={movie.my_rating === n ? "star active" : "star"}
              onClick={() => change(() => api.setRating(movie.tmdb_id, n), "Bewertung gespeichert.")}
              aria-label={`${n} Sterne`}
            >
              ★
            </button>
          ))}
        </div>

        <div className="status">
          <span>Status:</span>
          {STATUS_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              className={movie.my_status === value ? "active" : ""}
              onClick={() => change(() => api.setWatchStatus(movie.tmdb_id, value), "Status gespeichert.")}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz…" />
          <button onClick={() => change(() => api.setNote(movie.tmdb_id, note), "Notiz gespeichert.")}>Notiz speichern</button>
          {movie.my_note && <button onClick={() => change(() => api.deleteNote(movie.tmdb_id), "Notiz gelöscht.")}>Notiz löschen</button>}
        </div>

        <div className="lists">
          <span>In meinen Listen:</span>
          {lists.map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={inLists.has(l.id)} onChange={() => void toggleList(l.id)} /> {l.name}
            </label>
          ))}
          {lists.length === 0 && <span className="muted">Noch keine Listen – unter „Listen" anlegen.</span>}
        </div>

        {saved && <p className={savedIsError ? "error" : "ok"}>{saved}</p>}
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
