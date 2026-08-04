import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function LoginPage() {
  const { login, refresh } = useAuth();
  const navigate = useNavigate();
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.status().then((s) => setNeedsBootstrap(s.needsBootstrap)).catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (needsBootstrap) {
        await api.register(name, password); // erster Nutzer → Admin + Session-Cookie
      } else {
        await login(name, password);
      }
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  return (
    <div className="login">
      <h1>Filmdatenbank</h1>
      <form onSubmit={onSubmit}>
        <h2>{needsBootstrap ? "Ersten Nutzer anlegen (wird Admin)" : "Anmelden"}</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort" type="password" />
        {error && <p className="error">{error}</p>}
        <button type="submit">{needsBootstrap ? "Einrichtung starten" : "Anmelden"}</button>
      </form>
    </div>
  );
}
