import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ENRICH_FELD_LABELS, type EnrichField, type EnrichPreview } from "../api";

const fields = Object.keys(ENRICH_FELD_LABELS) as EnrichField[];

export default function AdminEnrichPanel() {
  const controller = useRef<AbortController | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [preview, setPreview] = useState<EnrichPreview | null>(null);
  const [selected, setSelected] = useState<EnrichField[]>(fields);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const imFilter = searchParams.has("fehlt");

  useEffect(() => {
    void api.enrichPreview().then(setPreview).catch((e: unknown) => setMessage(e instanceof Error ? e.message : "Fehler"));
  }, []);

  // Auswahl folgt dem aktiven Filter
  useEffect(() => {
    const aktuell = searchParams.get("fehlt");
    if (aktuell === null) return;
    const gewuenscht = selected.join(",");
    if (aktuell === gewuenscht) return;
    const next = new URLSearchParams(searchParams);
    if (gewuenscht) next.set("fehlt", gewuenscht);
    else next.delete("fehlt");
    setSearchParams(next, { replace: true });
  }, [selected, searchParams, setSearchParams]);

  function toggle(field: EnrichField) {
    setSelected((current) => (current.includes(field) ? current.filter((x) => x !== field) : [...current, field]));
  }

  function toggleFilter(aktiv: boolean) {
    const next = new URLSearchParams(searchParams);
    if (aktiv) next.set("fehlt", selected.join(","));
    else next.delete("fehlt");
    setSearchParams(next, { replace: true });
  }

  async function run() {
    controller.current = new AbortController();
    setBusy(true);
    setMessage("");
    try {
      await api.enrich(
        selected,
        (line) => {
          const x = line as { status?: string; ergänzt?: number; gesamt?: number; verarbeitet?: number; aktuell?: { titel?: string }; felder?: string[] };
          if (x.status === "progress") setMessage(`${x.verarbeitet ?? 0} / ${x.gesamt ?? 0}: ${x.aktuell?.titel ?? "Unbekannter Film"} – ${x.felder?.join(", ") ?? ""}`);
          if (x.status === "done") setMessage(`Fertig: ${x.ergänzt ?? 0} Einträge ergänzt.`);
          if (x.status === "aborted") setMessage(`Abgebrochen nach ${x.verarbeitet ?? 0} Filmen.`);
        },
        controller.current.signal
      );
      setPreview(await api.enrichPreview());
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setMessage("Abbruch angefordert – der aktuelle Film wird noch beendet.");
      else setMessage(e instanceof Error ? e.message : "Fehler");
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  function cancel() {
    controller.current?.abort();
    setMessage("Abbruch angefordert – der aktuelle Film wird noch beendet.");
  }

  return (
    <section className="admin-enrich">
      <h2>Daten ergänzen</h2>
      <p>Aktuelle Lücken:</p>
      {preview ? (
        <div className="enrich-stats">
          {fields.map((f) => (
            <label key={f}>
              <input type="checkbox" checked={selected.includes(f)} onChange={() => toggle(f)} disabled={busy} />
              {ENRICH_FELD_LABELS[f]}: {preview[f]}
            </label>
          ))}
        </div>
      ) : (
        <p>Lade Statistik …</p>
      )}
      <label className="enrich-filter">
        <input type="checkbox" checked={imFilter} onChange={(e) => toggleFilter(e.target.checked)} />
        Nur diese Filme in der Sammlung anzeigen
      </label>
      <button className="primary" onClick={() => void run()} disabled={busy || !preview || selected.length === 0}>
        {busy ? "Ergänze …" : "Auswahl ergänzen"}
      </button>
      {busy && <button onClick={cancel}>Abbrechen</button>}
      {message && <p>{message}</p>}
    </section>
  );
}
