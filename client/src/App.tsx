import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "./auth";
import CollectionPage from "./pages/CollectionPage";
import ListsPage from "./pages/ListsPage";
import Header from "./components/Header";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page">Lädt…</div>;
  if (!user) return <p className="page">Bitte über die Hauptanwendung anmelden.</p>;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <>
                  <Header />
                  <CollectionPage />
                </>
              </RequireAuth>
            }
          />
          <Route
            path="/listen"
            element={
              <RequireAuth>
                <>
                  <Header />
                  <ListsPage />
                </>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
