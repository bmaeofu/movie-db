import { useEffect, useState } from "react";
import { api, type EnrichField, type EnrichPreview } from "../api";

const fields: { key: EnrichField; label: string }[] = [
  { key: "jahr", label: "Jahr" }, { key: "poster", label: "Poster" }, { key: "overview", label: "Plot" },
  { key: "land", label: "Land" }, { key: "regisseure", label: "Regie" }, { key: "autoren", label: "Autoren" },
  { key: "cast", label: "Cast" }, { key: "imdb_bewertung", label: "IMDb-Bewertung" }, { key: "laufzeit", label: "Laufzeit" },
];

export default function AdminEnrichPanel() {
  const [preview, setPreview] = useState<EnrichPreview | null>(null);
  const [selected, setSelected] = useState<EnrichField[]>(fields.map((x) => x.key));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void api.enrichPreview().then(setPreview).catch((e: unknown) => setMessage(e instanceof Error ? e.message : "Fehler")); }, []);
  function toggle(field: EnrichField) { setSelected((current) => current.includes(field) ? current.filter((x) => x !== field) : [...current, field]); }
  async function run() {
    setBusy(true); setMessage("");
    try { await api.enrich(selected, (line) => { const x = line as { status?: string; ergänzt?: number; gesamt?: number; verarbeitet?: number; aktuell?: { titel?: string }; felder?: string[] }; if (x.status === "progress") setMessage(`${x.verarbeitet ?? 0} / ${x.gesamt ?? 0}: ${x.aktuell?.titel ?? "Unbekannter Film"} – ${x.felder?.join(", ") ?? ""}`); if (x.status === "done") setMessage(`Fertig: ${x.ergänzt ?? 0} Einträge ergänzt.`); }); setPreview(await api.enrichPreview()); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Fehler"); } finally { setBusy(false); }
  }
  return <section className="admin-enrich"><h2>Daten ergänzen</h2><p>Aktuelle Lücken:</p>{preview ? <div className="enrich-stats">{fields.map((f) => <label key={f.key}><input type="checkbox" checked={selected.includes(f.key)} onChange={() => toggle(f.key)} disabled={busy} />{f.label}: {preview[f.key]}</label>)}</div> : <p>Lade Statistik …</p>}<button className="primary" onClick={() => void run()} disabled={busy || !preview || selected.length === 0}>{busy ? "Ergänze …" : "Auswahl ergänzen"}</button>{message && <p>{message}</p>}</section>;
}
