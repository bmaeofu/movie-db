import { useState } from "react";
import { api, type AbgleichBericht, type DuplikatBericht, type RematchBericht } from "../api";

type Aktion =
  | "kodi-sync"
  | "kodi-poster"
  | "kodi-schauspieler"
  | "kodi-abgleich"
  | "tmdb-rematch"
  | "laufzeiten"
  | "dubletten";

const AKTIONEN: { key: Aktion; label: string; hinweis: string }[] = [
  { key: "kodi-sync", label: "Kodi-Sync", hinweis: "Importiert neue Filme aus der Kodi-Datenbank." },
  { key: "kodi-abgleich", label: "Kodi-Abgleich", hinweis: "Findet movie-db-Einträge, die es in Kodi nicht mehr gibt." },
  {
    key: "tmdb-rematch",
    label: "TMDB-Neusuche",
    hinweis: "Sucht für Filme mit erloschener TMDB-ID einen passenden Eintrag über Titel und Jahr.",
  },
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
  const [abgleich, setAbgleich] = useState<AbgleichBericht | null>(null);
  const [rematch, setRematch] = useState<RematchBericht | null>(null);

  async function starte(aktion: Aktion) {
    setBusy(aktion);
    setMeldung("");
    setDubletten(null);
    setAbgleich(null);
    setRematch(null);
    try {
      if (aktion === "kodi-sync") {
        const r = await api.kodiSync();
        const teile = [`fertig: ${r.importiert} importiert, ${r.übersprungen} übersprungen`];
        if (r.importierte_filme.length > 0) teile.push(`neu: ${r.importierte_filme.map((f) => f.titel).join(", ")}`);
        if (r.dubletten.length > 0) teile.push(`als Dublette übersprungen: ${r.dubletten.length}`);
        setMeldung(teile.join("\n"));
      } else if (aktion === "kodi-abgleich") {
        const r = await api.kodiAbgleich();
        setAbgleich(r);
        setMeldung(`${r.geprüft} Kodi-Einträge geprüft: ${r.vorhanden} vorhanden, ${r.merges.length} zusammenzuführen, ${r.waisen.length} löschbar, ${r.waisenMitNutzerdaten.length} mit Nutzerdaten`);
      } else if (aktion === "tmdb-rematch") {
        const r = await api.tmdbRematch();
        setRematch(r);
        setMeldung(
          `${r.geprüft} Einträge ohne gültige TMDB-ID: ${r.vorschlaege.length} Vorschläge, ${r.unklar.length} unklar, ${r.nichts.length} nicht gefunden`
        );
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

  async function bereinigeAbgleich() {
    if (!abgleich) return;
    setBusy("kodi-abgleich");
    try {
      const r = await api.kodiAbgleichBereinigen({
        merges: abgleich.merges.map((m) => ({ alt: m.alt, neu: m.neu })),
        deletes: abgleich.waisen.map((w) => w.tmdb_id),
      });
      const zusammengefuehrt = r.merges.filter((m) => m.status === "ok").length;
      setMeldung(
        `bereinigt: ${zusammengefuehrt} zusammengeführt, ${r.geloescht.length} gelöscht` +
          (r.uebersprungen_nutzerdaten.length > 0 ? `, ${r.uebersprungen_nutzerdaten.length} mit Nutzerdaten übersprungen` : "")
      );
      setAbgleich(await api.kodiAbgleich());
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(null);
    }
  }

  async function wendeRematchAn() {
    if (!rematch || rematch.vorschlaege.length === 0) return;
    setBusy("tmdb-rematch");
    try {
      const r = await api.tmdbRematchAnwenden(
        rematch.vorschlaege.map((v) => ({ alt: v.alt, neu: v.neu, medientyp: v.medientyp }))
      );
      const umgezogen = r.merges.filter((m) => m.status === "ok").length;
      setMeldung(
        `übernommen: ${r.typ_geaendert.length} Medientyp-Korrekturen, ${umgezogen} Umzüge` +
          (r.uebersprungen.length > 0 ? `, ${r.uebersprungen.length} nicht mehr betroffen` : "")
      );
      setRematch(await api.tmdbRematch());
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
      {abgleich && (
        <div className="admin-meldung">
          {abgleich.merges.length === 0 && abgleich.waisen.length === 0 && abgleich.waisenMitNutzerdaten.length === 0 ? (
            <p>Alles abgeglichen — keine Abweichungen.</p>
          ) : (
            <>
              {abgleich.merges.length > 0 && (
                <>
                  <p>Zusammenzuführen (gleicher Film unter anderer TMDB-ID):</p>
                  {abgleich.merges.map((m) => (
                    <p key={m.alt}>
                      {m.alt} → {m.neu}: „{m.titel}“ ({m.jahr ?? "?"})
                    </p>
                  ))}
                </>
              )}
              {abgleich.waisen.length > 0 && (
                <>
                  <p>In Kodi nicht mehr vorhanden (löschbar):</p>
                  {abgleich.waisen.map((w) => (
                    <p key={w.tmdb_id}>
                      {w.tmdb_id}: „{w.titel}“ ({w.jahr ?? "?"})
                    </p>
                  ))}
                </>
              )}
              {abgleich.waisenMitNutzerdaten.length > 0 && (
                <>
                  <p>In Kodi nicht mehr vorhanden, aber mit Nutzerdaten (nicht automatisch gelöscht):</p>
                  {abgleich.waisenMitNutzerdaten.map((w) => (
                    <p key={w.tmdb_id}>
                      {w.tmdb_id}: „{w.titel}“ ({w.jahr ?? "?"})
                    </p>
                  ))}
                </>
              )}
              <button
                className="primary"
                onClick={() => void bereinigeAbgleich()}
                disabled={busy !== null || (abgleich.merges.length === 0 && abgleich.waisen.length === 0)}
              >
                Bereinigen ({abgleich.merges.length + abgleich.waisen.length})
              </button>
            </>
          )}
        </div>
      )}
      {rematch && (
        <div className="admin-meldung">
          {rematch.vorschlaege.length === 0 && rematch.unklar.length === 0 ? (
            <p>Keine passenden TMDB-Einträge gefunden.</p>
          ) : (
            <>
              {rematch.vorschlaege.length > 0 && (
                <>
                  <p>Vorschläge:</p>
                  {rematch.vorschlaege.map((v) => (
                    <p key={v.alt}>
                      {v.alt} {v.alt === v.neu ? "" : `→ ${v.neu} `}„{v.titel}“ ({v.jahr ?? "?"}) —{" "}
                      {v.art === "medientyp"
                        ? `als ${v.medientyp === "serie" ? "Serie" : "Film"} führen`
                        : `Eintrag als ${v.medientyp === "serie" ? "Serie" : "Film"} übernehmen`}
                    </p>
                  ))}
                  <button className="primary" onClick={() => void wendeRematchAn()} disabled={busy !== null}>
                    Vorschläge anwenden ({rematch.vorschlaege.length})
                  </button>
                </>
              )}
              {rematch.unklar.length > 0 && (
                <>
                  <p>Mehrdeutig (nicht automatisch übernommen):</p>
                  {rematch.unklar.map((u) => (
                    <p key={u.tmdb_id}>
                      {u.tmdb_id} „{u.titel}“ ({u.jahr ?? "?"}): {u.kandidaten.map((k) => `${k.medientyp} ${k.id}`).join(", ")}
                    </p>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
