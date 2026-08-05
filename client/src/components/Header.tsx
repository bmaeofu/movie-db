import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import ChangePasswordModal from "./ChangePasswordModal";
import UserAdminModal from "./UserAdminModal";

export default function Header() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [showNewUser, setShowNewUser] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showUserAdmin, setShowUserAdmin] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    try {
      await api.register(newName, newPassword);
      setMessage(`Nutzer „${newName}“ angelegt.`);
      setNewName("");
      setNewPassword("");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Fehler");
    }
  }

  return (
    <header className="header">
      <nav>
        <Link to="/">Sammlung</Link>
        <Link to="/listen">Listen</Link>
      </nav>
      <div className="user-area">
        {user?.is_admin === 1 && <button onClick={() => setShowNewUser(!showNewUser)}>Nutzer anlegen</button>}
        {user?.is_admin === 1 && <button onClick={() => setShowUserAdmin(true)}>Nutzer verwalten</button>}
        <button onClick={() => setShowChangePw(true)}>Passwort ändern</button>
        <span className="user-name">{user?.name}</span>
        <button
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          Abmelden
        </button>
      </div>
      {showNewUser && (
        <form className="new-user" onSubmit={createUser}>
          <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="Passwort (min. 6 Zeichen)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <button type="submit">Anlegen</button>
          {message && <p className={message.startsWith("Nutzer") ? "ok" : "error"}>{message}</p>}
        </form>
      )}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      {showUserAdmin && <UserAdminModal onClose={() => setShowUserAdmin(false)} onChanged={() => void refresh()} />}
    </header>
  );
}
