import { useEffect, useState, type FormEvent } from "react";
import { api, type ListSummary, type Movie } from "../api";

export default function ListsPage() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [openList, setOpenList] = useState<number | null>(null);
  const [items, setItems] = useState<Movie[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLists(await api.lists());
  }

  useEffect(() => {
    void load();
  }, []);

  async function open(id: number) {
    if (openList === id) {
      setOpenList(null);
      return;
    }
    setOpenList(id);
    setItems((await api.listItems(id)).items);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createList(newName);
      setNewName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  async function rename(list: ListSummary) {
    const name = window.prompt("Neuer Name:", list.name);
    if (!name || name.trim() === "") return;
    await api.renameList(list.id, name.trim());
    await load();
  }

  async function remove(list: ListSummary) {
    if (!window.confirm(`Liste „${list.name}“ löschen?`)) return;
    await api.deleteList(list.id);
    if (openList === list.id) setOpenList(null);
    await load();
  }

  async function removeItem(tmdbId: number) {
    if (!openList) return;
    await api.removeFromList(openList, tmdbId);
    setItems((await api.listItems(openList)).items);
  }

  return (
    <main className="page">
      <h2>Meine Listen</h2>
      <form onSubmit={create} className="filterbar">
        <input placeholder="Neue Liste…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="primary">Liste anlegen</button>
      </form>
      {error && <p className="error">{error}</p>}

      {lists.length === 0 && <p className="empty">Noch keine Listen angelegt.</p>}

      {lists.map((l) => (
        <div key={l.id}>
          <div className="list-row">
            <button className="list-name" onClick={() => void open(l.id)}>
              {l.name} ({l.item_count})
            </button>
            <div className="actions">
              <button onClick={() => void rename(l)}>Umbenennen</button>
              <button onClick={() => void remove(l)}>Löschen</button>
            </div>
          </div>
          {openList === l.id && (
            <div className="grid">
              {items.map((m) => (
                <div key={m.tmdb_id} className="card">
                  {m.poster_url ? (
                    <img src={m.poster_url} alt={m.titel} loading="lazy" />
                  ) : (
                    <div className="no-poster">{m.titel}</div>
                  )}
                  <div className="card-info">
                    <h3>{m.titel} {m.jahr ? `(${m.jahr})` : ""}</h3>
                    <button onClick={() => void removeItem(m.tmdb_id)}>Entfernen</button>
                  </div>
                </div>
              ))}
              {items.length === 0 && <p className="empty">Liste ist leer – Film im Detail-Modal hinzufügen.</p>}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
