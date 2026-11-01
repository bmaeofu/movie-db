/**
 * Playback-Ziele: wie ein Pfad aus der Mediathek in eine URL für den Player
 * des jeweiligen Geräts übersetzt wird.
 *
 * Die Pfade in movie-db sind container-relativ (`/media/…`), weil dort der
 * Medienbaum eingebunden ist. `path_map` übersetzt das Präfix je Ziel.
 */

export interface PlaybackZiel {
  name: string;
  template: string;
  path_map: Record<string, string>;
}

export const PLAYBACK_ZIELE: PlaybackZiel[] = [
  {
    name: "desktop",
    template: "dvbplay://{{path}}",
    path_map: { "/media": String.raw`\\192.168.178.75\media` },
  },
  {
    name: "android",
    template: "intent://{{path}}#Intent;scheme=smb;package=org.videolan.vlc;end",
    path_map: { "/media": "192.168.178.75/media" },
  },
];

/** Übersetzt einen Container-Pfad über die path_map eines Ziels. */
function bildetAb(pfad: string, pathMap: Record<string, string>): string {
  let treffer: { praefix: string; ziel: string } | null = null;
  for (const [praefix, ziel] of Object.entries(pathMap)) {
    if (pfad !== praefix && !pfad.startsWith(praefix.endsWith("/") ? praefix : `${praefix}/`)) continue;
    if (treffer === null || praefix.length > treffer.praefix.length) treffer = { praefix, ziel };
  }
  if (treffer === null) return pfad;

  const rest = pfad.slice(treffer.praefix.length);
  // UNC-Ziele (Backslash) bekommen auch im Rest Backslashes, sonst bleibt es bei Schrägstrichen.
  const angepasst = treffer.ziel.includes("\\") ? rest.replace(/\//g, "\\") : rest;
  return treffer.ziel + angepasst;
}

/** Baut für einen Mediathek-Pfad die URLs aller Ziele. */
export function bauePlayUrls(pfad: string): { name: string; url: string }[] {
  return PLAYBACK_ZIELE.map((ziel) => ({
    name: ziel.name,
    // encodeURI kodiert Leerzeichen und Umlaute, würde aber UNC-Backslashes zu %5C machen
    url: ziel.template.replace("{{path}}", encodeURI(bildetAb(pfad, ziel.path_map)).replaceAll("%5C", "\\")),
  }));
}
