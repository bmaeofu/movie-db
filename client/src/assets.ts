/**
 * Posterpfade stehen als `/media/…` in der Datenbank, also relativ zur Wurzel.
 * Unter dem Rahmen der Hauptanwendung liegt die Filmdatenbank aber unter
 * `/movie-db/`; nur diese Pfade brauchen das Praefix.
 */
export function assetUrl(url: string | null): string | null {
  if (!url || !url.startsWith("/media/")) return url;
  return import.meta.env.BASE_URL.replace(/\/$/, "") + url;
}
