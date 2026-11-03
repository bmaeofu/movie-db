/**
 * Neuzuordnung von Filmen, deren TMDB-ID nicht mehr existiert.
 *
 * Reine Klassifizierung: der Aufrufer liefert die Suchtreffer, damit die Logik
 * ohne TMDB-Zugriff testbar bleibt. Übernommen wird nur ein exakter Titeltreffer
 * mit passendem Jahr (Abweichung ±1); alles andere gilt als unklar oder nicht gefunden.
 */

export interface RematchEintrag {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
}

export interface RematchTreffer {
  id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
}

export interface RematchVorschlag {
  alt: number;
  neu: number;
  medientyp: "film" | "serie";
  titel: string;
  jahr: number | null;
  /** "medientyp": gleiche ID, nur der Namensraum war falsch. "id": anderer Eintrag. */
  art: "medientyp" | "id";
}

export interface RematchBericht {
  geprüft: number;
  vorschlaege: RematchVorschlag[];
  unklar: { tmdb_id: number; titel: string; jahr: number | null; kandidaten: RematchTreffer[] }[];
  nichts: { tmdb_id: number; titel: string; jahr: number | null }[];
}

export function normalisiereTitel(titel: string): string {
  return titel.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * Fragt für jeden Titel genau einmal und klassifiziert die Treffer.
 * Der Aufrufer liefert die Suche, damit weder Netz noch TMDB-Client nötig sind.
 */
export async function sammleVorschlaege(
  eintraege: RematchEintrag[],
  suche: (titel: string) => Promise<RematchTreffer[]>
): Promise<RematchBericht> {
  const nachTitel = new Map<string, RematchTreffer[]>();
  for (const eintrag of eintraege) {
    if (nachTitel.has(eintrag.titel)) continue;
    try {
      nachTitel.set(eintrag.titel, await suche(eintrag.titel));
    } catch {
      nachTitel.set(eintrag.titel, []);
    }
  }
  return klassifiziereRematch(eintraege, (e) => nachTitel.get(e.titel) ?? []);
}

export function klassifiziereRematch(
  eintraege: RematchEintrag[],
  kandidatenFuer: (eintrag: RematchEintrag) => RematchTreffer[]
): RematchBericht {
  const bericht: RematchBericht = { geprüft: eintraege.length, vorschlaege: [], unklar: [], nichts: [] };

  for (const eintrag of eintraege) {
    const ziel = normalisiereTitel(eintrag.titel);
    const passend = kandidatenFuer(eintrag).filter((k) => {
      if (normalisiereTitel(k.titel) !== ziel) return false;
      // fehlendes Jahr auf einer Seite gilt als passend, sonst höchstens ein Jahr Abweichung
      if (eintrag.jahr === null || k.jahr === null) return true;
      return Math.abs(eintrag.jahr - k.jahr) <= 1;
    });

    if (passend.length === 1) {
      const treffer = passend[0];
      bericht.vorschlaege.push({
        alt: eintrag.tmdb_id,
        neu: treffer.id,
        medientyp: treffer.medientyp,
        titel: treffer.titel,
        jahr: treffer.jahr,
        art: treffer.id === eintrag.tmdb_id ? "medientyp" : "id",
      });
      continue;
    }
    if (passend.length > 1) {
      bericht.unklar.push({ tmdb_id: eintrag.tmdb_id, titel: eintrag.titel, jahr: eintrag.jahr, kandidaten: passend });
      continue;
    }
    bericht.nichts.push({ tmdb_id: eintrag.tmdb_id, titel: eintrag.titel, jahr: eintrag.jahr });
  }

  return bericht;
}
