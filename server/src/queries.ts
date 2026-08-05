import type Database from "better-sqlite3";

export interface MovieView {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
  genres: string[];
  poster_url: string | null;
  overview: string | null;
  land: string[];
  regisseure: string[];
  autoren: string[];
  cast: { name: string; rolle: string }[];
  tmdb_bewertung: number | null;
  tmdb_stimmen: number | null;
  imdb_bewertung: number | null;
  source: string;
  added_at: string;
  added_by_name: string;
  avg_rating: number | null;
  rating_count: number;
  my_rating: number | null;
  my_status: "schauen" | "gesehen" | "kein_interesse" | null;
  my_note: string | null;
  my_list_ids: number[];
}

/**
 * Movie-Select mit Nutzerdaten.
 * `fromSql` ersetzt die Quelle (z. B. `FROM collection c JOIN movies m ON m.tmdb_id = c.tmdb_id LEFT JOIN users u ON u.id = c.added_by`
 * oder `FROM list_items c JOIN movies m ON m.tmdb_id = c.tmdb_id JOIN users u ON u.id = <added_by-Subquery>`),
 * `extraWhere`/`params` steuern Filter, `orderBy` die Sortierung.
 */
export function listMovieViews(
  db: Database.Database,
  userId: number,
  fromSql: string,
  extraWhere: string[],
  params: Record<string, unknown>,
  orderBy: string
): MovieView[] {
  const where = extraWhere.length ? "WHERE " + extraWhere.join(" AND ") : "";
  const rows = db
    .prepare(
      `SELECT m.tmdb_id, m.titel, m.jahr, m.medientyp, m.genres, m.poster_url, m.overview,
              m.land, m.regisseure, m.autoren, m."cast", m.tmdb_bewertung, m.tmdb_stimmen, m.imdb_bewertung, m.source,
              c.added_at, u.name AS added_by_name,
              ROUND(AVG(r.sterne), 1) AS avg_rating, COUNT(r.user_id) AS rating_count,
              (SELECT sterne FROM ratings WHERE tmdb_id = m.tmdb_id AND user_id = @userId) AS my_rating,
              ws.status AS my_status, n.text AS my_note,
              (SELECT json_group_array(list_id) FROM list_items
               WHERE tmdb_id = m.tmdb_id
                 AND list_id IN (SELECT id FROM lists WHERE owner_id = @userId)) AS my_list_ids
       ${fromSql}
       LEFT JOIN ratings r ON r.tmdb_id = m.tmdb_id
       LEFT JOIN watch_status ws ON ws.tmdb_id = m.tmdb_id AND ws.user_id = @userId
       LEFT JOIN notes n ON n.tmdb_id = m.tmdb_id AND n.user_id = @userId
       ${where}
       GROUP BY m.tmdb_id
       ORDER BY ${orderBy}`
    )
    .all({ userId, ...params }) as any[];

  return rows.map((r) => ({
    ...r,
    genres: JSON.parse(r.genres),
    land: JSON.parse(r.land),
    regisseure: JSON.parse(r.regisseure),
    autoren: JSON.parse(r.autoren),
    cast: JSON.parse(r.cast),
    my_list_ids: r.my_list_ids ? JSON.parse(r.my_list_ids) : [],
    my_rating: r.my_rating ?? null,
    avg_rating: r.avg_rating ?? null,
  }));
}
