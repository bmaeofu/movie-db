import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import AdminEnrichPanel from "./AdminEnrichPanel";
import AdminMaintenancePanel from "./AdminMaintenancePanel";

// Anlegen, Passwort und Nutzerverwaltung gehoeren der Hauptanwendung; hier bleibt
// die Arbeit an den Filmdaten.
export default function Header() {
  const { user } = useAuth();
  const [showEnrich, setShowEnrich] = useState(false);
  const [showWartung, setShowWartung] = useState(false);

  return (
    <header className="header">
      <nav>
        <Link to="/">Sammlung</Link>
        <Link to="/listen">Listen</Link>
      </nav>
      <div className="user-area">
        {user?.is_admin === 1 && <button onClick={() => setShowEnrich(!showEnrich)}>Daten ergänzen</button>}
        {user?.is_admin === 1 && <button onClick={() => setShowWartung(!showWartung)}>Wartung</button>}
        <span className="user-name">{user?.name}</span>
      </div>
      {showEnrich && user?.is_admin === 1 && <AdminEnrichPanel />}
      {showWartung && user?.is_admin === 1 && <AdminMaintenancePanel />}
    </header>
  );
}
