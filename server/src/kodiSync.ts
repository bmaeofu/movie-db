import type Database from "better-sqlite3";
import mysql from "mysql2/promise";

export interface KodiSyncConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

interface KodiMovieRow {
  tmdb_id: string;
  titel: string | null;
  jahr: string | null;
  laufzeit: number | null;
  overview: string | null;
  genres: string | null;
  laender: string | null;
  regisseure: string | null;
  autoren: string | null;
  imdb_bewertung: number | null;
  imdb_stimmen: number | null;
  tmdb_bewertung: number | null;
  tmdb_stimmen: number | null;
  imdb_id: string | null;
  poster: string | null;
}

interface KodiCastRow {
  tmdb_id: string;
  name: string | null;
  rolle: string | null;
}

const SMB_PREFIX = "smb://UMS/media/tv/FilmeHD";

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Kodi-SMB-Posterpfad → vom Frontend ladbarer /media-Pfad (nur im gemounteten Ordner). */
function posterUrl(smb: string | null): string | null {
  if (!smb || !smb.startsWith(SMB_PREFIX)) return null;
  const rel = smb.slice(SMB_PREFIX.length);
  return rel ? "/media" + rel : null;
}

export async function syncKodiMovies(db: Database.Database, cfg: KodiSyncConfig): Promise<{
  geprüft: number;
  importiert: number;
  übersprungen: number;
}> {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
  });

  try {
    const [movieRows] = await conn.query(`
      SELECT
        u.value AS tmdb_id,
        m.c00 AS titel,
        NULLIF(TRIM(m.c03), '') AS jahr,
        ROUND(m.c11 / 60) AS laufzeit,
        NULLIF(TRIM(m.c01), '') AS overview,
        NULLIF(TRIM(m.c14), '') AS genres,
        NULLIF(TRIM(m.c21), '') AS laender,
        NULLIF(TRIM(m.c15), '') AS regisseure,
        NULLIF(TRIM(m.c06), '') AS autoren,
        (SELECT MAX(rating) FROM rating
          WHERE media_id = m.idMovie AND media_type = 'movie' AND rating_type = 'imdb') AS imdb_bewertung,
        (SELECT MAX(votes) FROM rating
          WHERE media_id = m.idMovie AND media_type = 'movie' AND rating_type = 'imdb') AS imdb_stimmen,
        (SELECT MAX(rating) FROM rating
          WHERE media_id = m.idMovie AND media_type = 'movie' AND rating_type = 'themoviedb') AS tmdb_bewertung,
        (SELECT MAX(votes) FROM rating
          WHERE media_id = m.idMovie AND media_type = 'movie' AND rating_type = 'themoviedb') AS tmdb_stimmen,
        (SELECT value FROM uniqueid
          WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'imdb' LIMIT 1) AS imdb_id,
        (SELECT url FROM art
          WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'poster' LIMIT 1) AS poster
      FROM movie m
      JOIN uniqueid u
        ON u.media_id = m.idMovie AND u.media_type = 'movie'
       AND u.type = 'tmdb' AND u.value REGEXP '^[0-9]+$'
    `) as [KodiMovieRow[], unknown];

    const [castRows] = await conn.query(`
      SELECT u.value AS tmdb_id, a.name, COALESCE(al.role, '') AS rolle
      FROM actor_link al
      JOIN actor a ON a.actor_id = al.actor_id
      JOIN uniqueid u
        ON u.media_id = al.media_id AND u.media_type = 'movie'
       AND u.type = 'tmdb' AND u.value REGEXP '^[0-9]+$'
      WHERE al.media_type = 'movie'
      ORDER BY al.media_id, al.cast_order
    `) as [KodiCastRow[], unknown];

    const castByMovie = new Map<string, { name: string; rolle: string }[]>();
    for (const row of castRows) {
      if (!row.name) continue;
      const list = castByMovie.get(row.tmdb_id) ?? [];
      list.push({ name: row.name, rolle: row.rolle ?? "" });
      castByMovie.set(row.tmdb_id, list);
    }

    const upsert = db.prepare(
      `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json,
                          land, regisseure, autoren, "cast", tmdb_bewertung, tmdb_stimmen, imdb_bewertung, imdb_stimmen, laufzeit_minuten, source)
       VALUES (@tmdb_id, @titel, @jahr, @medientyp, @genres, @poster_url, @overview, @tmdb_json,
               @land, @regisseure, @autoren, @cast, @tmdb_bewertung, @tmdb_stimmen, @imdb_bewertung, @imdb_stimmen, @laufzeit_minuten, 'kodi')
       ON CONFLICT(tmdb_id) DO UPDATE SET
         titel = excluded.titel, jahr = excluded.jahr, medientyp = excluded.medientyp,
         genres = excluded.genres, poster_url = excluded.poster_url, overview = excluded.overview,
         tmdb_json = excluded.tmdb_json, land = excluded.land, regisseure = excluded.regisseure,
         autoren = excluded.autoren, "cast" = excluded.cast, tmdb_bewertung = excluded.tmdb_bewertung,
         tmdb_stimmen = excluded.tmdb_stimmen, imdb_bewertung = excluded.imdb_bewertung,
         imdb_stimmen = excluded.imdb_stimmen, laufzeit_minuten = excluded.laufzeit_minuten, zuletzt_aktualisiert = datetime('now')`
    );
    const inCollection = db.prepare("SELECT 1 FROM collection WHERE tmdb_id = ?");
    const addCollection = db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)");
    const markNeu = db.prepare(
      "INSERT OR IGNORE INTO watch_status (user_id, tmdb_id, status) SELECT id, ?, 'neu' FROM users"
    );

    // added_by: erster Admin (Fallback 0)
    const admin = (db.prepare("SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1").get() as
      | { id: number }
      | undefined)?.id ?? 0;

    let importiert = 0;
    let übersprungen = 0;
    const apply = db.transaction(() => {
      for (const row of movieRows) {
        const tmdbId = Number(row.tmdb_id);
        if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;
        if (inCollection.get(tmdbId)) {
          übersprungen++;
          continue;
        }
        const jahrRaw = Number(row.jahr);
        const jahr = Number.isInteger(jahrRaw) && jahrRaw >= 1888 && jahrRaw <= 2100 ? jahrRaw : null;
        const laufzeit = row.laufzeit !== null && Number.isInteger(row.laufzeit) && row.laufzeit > 0 ? row.laufzeit : null;
        upsert.run({
          tmdb_id: tmdbId,
          titel: row.titel?.trim() || "Unbekannter Titel",
          jahr,
          medientyp: "film",
          genres: JSON.stringify(splitList(row.genres)),
          poster_url: posterUrl(row.poster),
          overview: row.overview?.trim() || null,
          tmdb_json: JSON.stringify({ imdb_id: row.imdb_id }),
          land: JSON.stringify(splitList(row.laender)),
          regisseure: JSON.stringify(splitList(row.regisseure)),
          autoren: JSON.stringify(splitList(row.autoren)),
          cast: JSON.stringify(castByMovie.get(row.tmdb_id) ?? []),
          tmdb_bewertung: row.tmdb_bewertung ?? null,
          tmdb_stimmen: row.tmdb_stimmen ?? null,
          imdb_bewertung: row.imdb_bewertung ?? null,
          imdb_stimmen: row.imdb_stimmen ?? null,
          laufzeit_minuten: laufzeit,
        });
        addCollection.run(tmdbId, admin);
        markNeu.run(tmdbId);
        importiert++;
      }
    });
    apply();

    return { geprüft: movieRows.length, importiert, übersprungen };
  } finally {
    await conn.end();
  }
}
