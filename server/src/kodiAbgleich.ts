/**
 * Abgleich movie-db ↔ Kodi für Einträge mit source="kodi".
 *
 * Reine Klassifizierung: kein Datenbankzugriff, damit sie ohne Kodi-Verbindung
 * testbar bleibt. Der Aufrufer liefert den aktuellen Kodi-Bestand.
 */

export interface AbgleichEintrag {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  imdb_id: string | null;
  /** Bewertungen, Notizen, Listen oder ein gesetzter Watch-Status vorhanden. */
  nutzerdaten: boolean;
}

export interface KodiBestand {
  /** Alle TMDB-IDs, die Kodi aktuell als Film führt (mit gültiger Datei). */
  tmdbIds: Set<string>;
  /** IMDb-ID → TMDB-ID, wie Kodi sie führt. */
  imdbZuTmdb: Map<string, string>;
}

export interface AbgleichBericht {
  geprüft: number;
  vorhanden: number;
  /** Gleicher Film in Kodi unter anderer TMDB-ID → zusammenführen. */
  merges: { alt: number; neu: number; titel: string; jahr: number | null }[];
  /** In Kodi nicht mehr vorhanden, ohne Nutzerdaten → löschbar. */
  waisen: AbgleichEintrag[];
  /** In Kodi nicht mehr vorhanden, aber mit Nutzerdaten → manuell entscheiden. */
  waisenMitNutzerdaten: AbgleichEintrag[];
}

export function klassifiziereAbgleich(eintraege: AbgleichEintrag[], kodi: KodiBestand): AbgleichBericht {
  const bericht: AbgleichBericht = {
    geprüft: eintraege.length,
    vorhanden: 0,
    merges: [],
    waisen: [],
    waisenMitNutzerdaten: [],
  };

  for (const eintrag of eintraege) {
    if (kodi.tmdbIds.has(String(eintrag.tmdb_id))) {
      bericht.vorhanden++;
      continue;
    }
    const kodiId = eintrag.imdb_id ? kodi.imdbZuTmdb.get(eintrag.imdb_id) : undefined;
    if (kodiId !== undefined && kodiId !== String(eintrag.tmdb_id)) {
      bericht.merges.push({ alt: eintrag.tmdb_id, neu: Number(kodiId), titel: eintrag.titel, jahr: eintrag.jahr });
      continue;
    }
    if (eintrag.nutzerdaten) bericht.waisenMitNutzerdaten.push(eintrag);
    else bericht.waisen.push(eintrag);
  }

  return bericht;
}
