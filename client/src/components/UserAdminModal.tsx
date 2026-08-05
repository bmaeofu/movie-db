import { useEffect, useState } from "react";
import { api, type UserSummary } from "../api";

export default function UserAdminModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(false);

  async function load() {
    setUsers(await api.users());
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(fn: () => Promise<unknown>, okText: string) {
    setMsg("");
    setError(false);
    try {
      await fn();
      setMsg(okText);
      await load();
      onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Fehler");
      setError(true);
    }
  }

  function rename(u: UserSummary) {
    const name = window.prompt("Neuer Name:", u.name);
    if (!name || name.trim() === "") return;
    void act(() => api.updateUser(u.id, { name: name.trim() }), "Umbenannt.");
  }

  function resetPw(u: UserSummary) {
    const pw = window.prompt(`Neues Passwort für „${u.name}“ (min. 6 Zeichen):`);
    if (!pw || pw.length < 6) return;
    void act(() => api.updateUser(u.id, { password: pw }), "Passwort zurückgesetzt.");
  }

  function toggleAdmin(u: UserSummary) {
    void act(
      () => api.updateUser(u.id, { is_admin: u.is_admin ? 0 : 1 }),
      u.is_admin ? "Admin-Recht entzogen." : "Admin-Recht vergeben."
    );
  }

  function remove(u: UserSummary) {
    if (!window.confirm(`Nutzer „${u.name}“ löschen? Bewertungen, Notizen und Listen werden mitgelöscht.`)) return;
    void act(() => api.deleteUser(u.id), "Gelöscht.");
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Nutzer verwalten</h2>
        {users.map((u) => (
          <div className="user-row" key={u.id}>
            <span className="user-name">
              {u.name} {u.is_admin === 1 && <span className="admin-badge">Admin</span>}
            </span>
            <div className="actions">
              <button onClick={() => rename(u)}>Umbenennen</button>
              <button onClick={() => resetPw(u)}>Passwort zurücksetzen</button>
              <button onClick={() => toggleAdmin(u)}>{u.is_admin === 1 ? "Admin entziehen" : "Zum Admin machen"}</button>
              <button onClick={() => remove(u)}>Löschen</button>
            </div>
          </div>
        ))}
        {msg && <p className={error ? "error" : "ok"}>{msg}</p>}
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
