import { useState } from "react";
import { api, type DuplikatBericht } from "../api";

type Aktion = "kodi-sync" | "kodi-poster" | "kodi-schauspieler" | "laufzeiten" | "dubletten";

const AKTIONEN: { key: Aktion; label: string; hinweis: string }[] = [
  { key: "kodi-sync", label: "Kodi-Sync", hinweis: "Importiert neue Filme aus der Kodi-Datenbank." },
  { key: "kodi-poster", label: "Kodi-Poster", hinweis: "Übernimmt lokale Poster aus der Kodi-Datenbank." },
  { key: "kodi-schauspieler", label: "Schauspielerfotos", hinweis: "Importiert fehlende Schauspielerfotos aus Kodi." },
  { key: "laufzeiten", label: "Laufzeiten", hinweis: "Ergänzt fehlende Laufzeiten aus TMDB." },
  { key: "dubletten", label: "Dubletten prüfen", hinweis: "Zeigt Filme, die mehrfach in der Sammlung liegen." },
];

function fortschrittsText(zeile: unknown, wort = "aktualisiert"): string {
  const x = zeile as { status?: string; gesamt?: number; verarbeitet?: number; aktualisiert?: number; importiert?: number; error?: string };
  if (x.status === "start") return `läuft … ${x.gesamt ?? "?"} Einträge`;
  if (x.status === "progress") return `läuft … ${x.verarbeitet ?? 0} / ${x.gesamt ?? 0}`;
  if (x.status === "done") {
    if (x.error) return `Fehler: ${x.error}`;
    return `fertig: ${x.aktualisiert ?? x.importiert ?? 0} ${wort}`;
  }
  return "";
}

export default function AdminMaintenancePanel() {
  const [busy, setBusy] = useState<Aktion | null>(null);
  const [meldung, setMeldung] = useState("");
  const [dubletten, setDubletten] = useState<DuplikatBericht | null>(null);

  async function starte(aktion: Aktion) {
    setBusy(aktion);
    setMeldung("");
    setDubletten(null);
    try {
      if (aktion === "kodi-sync") {
        const r = await api.kodiSync();
        const teile = [`fertig: ${r.importiert} importiert, ${r.übersprungen} übersprungen`];
        if (r.importierte_filme.length > 0) teile.push(`neu: ${r.importierte_filme.map((f) => f.titel).join(", ")}`);
        if (r.dubletten.length > 0) teile.push(`als Dublette übersprungen: ${r.dubletten.length}`);
        setMeldung(teile.join("\n"));
      } else if (aktion === "kodi-poster") {
        await api.kodiPoster((zeile) => setMeldung(fortschrittsText(zeile, "Poster aktualisiert")));
      } else if (aktion === "kodi-schauspieler") {
        await api.kodiSchauspieler((zeile) => setMeldung(fortschrittsText(zeile, "Fotos importiert")));
      } else if (aktion === "laufzeiten") {
        const r = await api.laufzeiten();
        setMeldung(`fertig: ${r.aktualisiert} von ${r.geprüft} ergänzt`);
      } else {
        setDubletten(await api.dubletten());
      }
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(null);
    }
  }

  const keineDubletten =
    dubletten !== null && dubletten.imdb_gruppen.length === 0 && dubletten.titel_jahr_gruppen.length === 0;

  return (
    <section className="admin-panel">
      <h2>Wartung</h2>
      <div className="admin-aktionen">
        {AKTIONEN.map((a) => (
          <button key={a.key} onClick={() => void starte(a.key)} disabled={busy !== null} title={a.hinweis}>
            {busy === a.key ? `${a.label} …` : a.label}
          </button>
        ))}
      </div>
      {meldung && <p className="admin-meldung">{meldung}</p>}
      {dubletten && (
        <div className="admin-meldung">
          {keineDubletten ? (
            <p>Keine Dubletten gefunden.</p>
          ) : (
            <>
              {dubletten.imdb_gruppen.map((g) => (
                <p key={g.imdb_id}>
                  IMDb {g.imdb_id}: {g.eintraege.map((e) => `${e.tmdb_id} „${e.titel}“`).join(" | ")}
                </p>
              ))}
              {dubletten.titel_jahr_gruppen.map((g) => (
                <p key={`${g.titel}-${g.jahr}`}>
                  „{g.titel}“ ({g.jahr}): {g.eintraege.map((e) => e.tmdb_id).join(", ")}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
