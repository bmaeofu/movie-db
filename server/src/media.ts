import fs from "node:fs";
import path from "node:path";

/**
 * Wo eine gespeicherte Medien-Datei im Container liegt.
 *
 * Kodi schreibt seine Pfade ab seiner eigenen Mount-Wurzel; im Container liegt
 * dieselbe Freigabe oft eine Ebene tiefer (`/media/tv/…`). Darum wird erst der
 * direkte Pfad probiert und dann jeder konfigurierte Präfix.
 */
export function mediaPrefixes(environment: NodeJS.ProcessEnv = process.env): string[] {
  return String(environment.MEDIA_PATH_PREFIX ?? "/media/tv")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Existierenden Dateipfad für einen `/media/…`-Pfad finden, sonst `null`. */
export function resolveMediaFile(
  mediaDir: string,
  requested: string,
  prefixes: string[]
): string | null {
  const rest = requested.replace(/^\/+/, "");
  const direct = path.join(mediaDir, rest);
  if (fs.existsSync(direct)) return direct;
  for (const prefix of prefixes) {
    const candidate = path.join(prefix, rest);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
