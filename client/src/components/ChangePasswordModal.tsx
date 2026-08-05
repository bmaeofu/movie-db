import { useState, type FormEvent } from "react";
import { api } from "../api";

export default function ChangePasswordModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setError(false);
    try {
      await api.changePassword(oldPw, newPw);
      setMsg("Passwort geändert.");
      setOldPw("");
      setNewPw("");
      onChanged?.();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Fehler");
      setError(true);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Passwort ändern</h2>
        <form onSubmit={submit} className="user-form">
          <input type="password" placeholder="Altes Passwort" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
          <input type="password" placeholder="Neues Passwort (min. 6 Zeichen)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <button type="submit" className="primary">Speichern</button>
        </form>
        {msg && <p className={error ? "error" : "ok"}>{msg}</p>}
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
