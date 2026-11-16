import type Database from "better-sqlite3";

/** Was die Hauptanwendung über den angemeldeten Menschen weiterreicht. */
export interface ProxiedIdentity {
  id: string;
  name: string;
  email: string;
  groups: string[];
}

export interface DbUser {
  id: number;
  name: string;
  is_admin: number;
}

/**
 * Der lokale Datensatz zu einer Anbieter-Identität.
 *
 * Die Anmeldung passiert in der Hauptanwendung; hier bleibt nur, wem eine Liste
 * oder ein Sammlungseintrag gehört. Die Zuordnung ist stabil über `oidc_sub`;
 * ein Bestandsdatensatz wird beim ersten Anmelden verknüpft (gleicher Name oder
 * gleicher Teil der E-Mail-Adresse vor dem @).
 */
export function ensureUser(
  db: Database.Database,
  identity: ProxiedIdentity,
  admin: boolean
): DbUser {
  const bySubject = db
    .prepare("SELECT id, name, is_admin FROM users WHERE oidc_sub = ?")
    .get(identity.id) as DbUser | undefined;
  if (bySubject) {
    setAdmin(db, bySubject.id, admin);
    return { ...bySubject, is_admin: admin ? 1 : 0 };
  }

  const kandidaten = [identity.name, identity.email.split("@")[0] ?? ""]
    .map((wert) => wert.trim())
    .filter((wert) => wert.length > 0);
  for (const name of kandidaten) {
    const byName = db
      .prepare("SELECT id, name, is_admin, oidc_sub FROM users WHERE name = ?")
      .get(name) as (DbUser & { oidc_sub: string | null }) | undefined;
    if (byName && !byName.oidc_sub) {
      db.prepare("UPDATE users SET oidc_sub = ? WHERE id = ?").run(identity.id, byName.id);
      setAdmin(db, byName.id, admin);
      return { ...byName, is_admin: admin ? 1 : 0 };
    }
  }

  const gewuenscht = identity.name || identity.email.split("@")[0] || identity.id;
  let name = gewuenscht;
  const belegt = db.prepare("SELECT oidc_sub FROM users WHERE name = ?").get(name) as
    | { oidc_sub: string | null }
    | undefined;
  if (belegt) {
    // Der Name gehört bereits jemand anderem: die Anbieter-Kennung macht ihn eindeutig.
    name = `${gewuenscht} (${identity.id.slice(-6)})`;
  }
  const info = db
    .prepare("INSERT INTO users (name, password_hash, is_admin, oidc_sub) VALUES (?, '!', ?, ?)")
    .run(name, admin ? 1 : 0, identity.id);
  return { id: Number(info.lastInsertRowid), name, is_admin: admin ? 1 : 0 };
}

function setAdmin(db: Database.Database, id: number, admin: boolean): void {
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(admin ? 1 : 0, id);
}
