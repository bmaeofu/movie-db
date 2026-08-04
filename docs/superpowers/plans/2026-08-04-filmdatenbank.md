# Filmdatenbank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine gemeinsame Filmdatenbank für Familie/Freunde als Docker-Container im Heimnetz: kuratierte Sammlung (TMDB-Suche), Bewertungen, Watch-Status, Notizen, Suche & Filter und persönliche Listen – mit Passwort-Login.

**Architecture:** Ein Docker-Container mit Node.js/TypeScript-Monolith: Express-API (better-sqlite3, Session-Cookies) und statisch ausgeliefertes React-Frontend (Vite-Build). Der TMDB-API-Key bleibt serverseitig; Suchen laufen über einen Proxy mit SQLite-Cache. Die App wird per Dependency-Injection (`createDb`, `createTmdbClient`, `createApp`) testbar aufgebaut.

**Tech Stack:** Node 20+, TypeScript (strict), Express 4, better-sqlite3, Vite + React 18 + react-router-dom 6, Vitest + supertest (Backend), Playwright (E2E), Docker Compose.

## Global Constraints

(Verbatim aus der Spec – jede Task erbt diese implizit.)

- **Stack:** npm workspaces im Root (`server`, `client`); TypeScript `strict` in beiden Paketen; Node >= 20.
- **Datenbank:** better-sqlite3, `journal_mode = WAL`, `foreign_keys = ON`; DB-Pfad über `DB_PATH` (Container: `/data/filmdatenbank.db`, Volume).
- **Wertebereiche:** `medientyp IN ('film','serie')`; `sterne` 1–5 (Integer); `status IN ('schauen','gesehen','kein_interesse')`.
- **Auth:** Erster registrierter Nutzer wird Admin (`POST /api/auth/register` ohne vorhandene Nutzer); danach nur mit Admin-Session. Passwort-Mindestlänge 6, Name >= 2 Zeichen. Passwort-Hashing: `node:crypto` scrypt (keine Fremdabhängigkeit). Session-Cookie `fdb_session`, `HttpOnly`, `SameSite=Lax`, Gültigkeit 30 Tage (Unix-Sekunden in Tabelle `sessions`, Vergleich mit `strftime('%s','now')`).
- **TMDB:** `TMDB_API_KEY` Pflicht – ohne ihn startet die App nicht (Fehlermeldung + `process.exit(1)`). Sprache `de-DE`; Poster-Basis `https://image.tmdb.org/t/p/w342`; Retry/Backoff bei HTTP 429 und 5xx (bis 3 Versuche, Backoff 500 ms · 2^Versuch). Such-Cache in Tabelle `search_cache`, TTL 7 Tage.
- **Hinzufügen zur Sammlung:** `POST /api/collection` akzeptiert nur `{ tmdb_id, medientyp }`; der Server holt die Details kanonisch von TMDB (`/movie/:id` bzw. `/tv/:id`) und speichert sie in `movies`. [Präzisierung der Spec: Body enthält `medientyp`, weil TMDB-IDs über Filme/Serien hinweg kollidieren.]
- **API-Antworten:** Fehler immer als JSON `{ "error": string }`; Erfolg ohne Body → 204; `GET /api/collection` liefert pro Film `avg_rating` (1 Dezimalstelle) und eigene Daten (`my_rating`, `my_status`, `my_note`, `my_list_ids`).
- **UI-Sprache:** Deutsch (Buttons, Labels, Fehlermeldungen).
- **Port:** 3000 (Container-Expose, Compose-Mapping `3000:3000`).
- **Berechtigungen:** Bewertung/Status/Notiz nur für die eigene Session; Listen nur vom Besitzer; Sammlungs-Eintrag nur von Admin oder `added_by` entfernbar.
- **Commits:** Nach jeder Task ein Commit mit aussagekräftiger Message.

## File Structure

```
Filme_und_Serien_Auswahl/
├── package.json                  # Workspace-Root, Scripts, devDep concurrently
├── package-lock.json             # nach erstem npm install
├── .gitignore
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── README.md                     # deutsche Setup-Anleitung
├── docs/superpowers/…
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts              # Einstieg: env-Check, createDb, createTmdbClient, createApp, listen
│   │   ├── app.ts                # Express-Assembly, Statik, SPA-Fallback, Fehlerhandler
│   │   ├── db.ts                 # createDb + initSchema (alle Tabellen)
│   │   ├── queries.ts            # gemeinsame Movie-Selects (Sammlung & Listen-Items)
│   │   ├── passwords.ts          # scrypt hash/verify
│   │   ├── sessions.ts           # Session-Tabelle: create/delete/find, Cookie-Konstante
│   │   ├── middleware.ts         # parseCookies, requireAuth, requireAdmin, asyncHandler
│   │   ├── tmdb.ts               # createTmdbClient (search, details, Genre-Maps, Retry)
│   │   └── routes/
│   │       ├── authRoutes.ts     # /api/auth/* (status, register, login, logout, me)
│   │       ├── searchRoutes.ts   # GET /api/search?q=
│   │       ├── collectionRoutes.ts  # GET/POST /api/collection, DELETE /:tmdbId
│   │       ├── movieRoutes.ts    # rating, watch-status, note
│   │       └── listRoutes.ts     # /api/lists CRUD + items
│   └── tests/
│       ├── auth.test.ts
│       ├── search.test.ts
│       ├── collection.test.ts
│       ├── movie.test.ts
│       ├── lists.test.ts
│       └── app.test.ts
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx               # Router + RequireAuth
│       ├── auth.tsx              # AuthProvider/useAuth
│       ├── api.ts                # fetch-Wrapper + typisierte Endpoints
│       ├── styles.css
│       ├── components/
│       │   ├── Header.tsx        # Nav, Nutzer, Admin-Formular, Abmelden
│       │   ├── MovieCard.tsx
│       │   ├── SearchModal.tsx
│       │   └── MovieDetailModal.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── CollectionPage.tsx
│           └── ListsPage.tsx
└── e2e/
    ├── package.json
    ├── playwright.config.ts
    └── smoke.spec.ts
```

---

### Task 1: Projekt-Scaffold & Datenbankschema

**Files:**
- Create: `package.json` (Root)
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `.gitignore`
- Create: `server/src/db.ts`
- Test: `server/tests/db.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `createDb(dbPath: string): Database.Database` (legt Schema an, WAL + Foreign Keys), `initSchema(db: Database.Database): void` – von allen späteren Tasks importiert.

- [ ] **Step 1: Root- und Server-Package anlegen**

`package.json` (Root):
```json
{
  "name": "filmdatenbank",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm run dev -w server\" \"npm run dev -w client\"",
    "build": "npm run build -w client && npm run build -w server",
    "test": "npm run test -w server",
    "start": "npm run start -w server"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

`server/package.json`:
```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: tsconfig, Vitest-Config, .gitignore anlegen**

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

`.gitignore` (Root):
```
node_modules/
dist/
data/
.env
*.db
*.db-journal
*.db-wal
*.db-shm
test-results/
playwright-report/
```

- [ ] **Step 3: Den fehlschlagenden Test schreiben**

`server/tests/db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, initSchema } from "../src/db.js";

describe("Datenbankschema", () => {
  it("legt alle Tabellen an", () => {
    const db = createDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r: any) => r.name);
    for (const t of ["users", "movies", "collection", "ratings", "watch_status", "notes", "sessions", "lists", "list_items", "search_cache"]) {
      expect(tables).toContain(t);
    }
  });

  it("ist idempotent (mehrfaches initSchema wirft nicht)", () => {
    const db = createDb(":memory:");
    expect(() => initSchema(db)).not.toThrow();
  });

  it("aktiviert WAL und Foreign Keys", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fdb-"));
    const db = createDb(path.join(dir, "test.db"));
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("durchsetzt die CHECK-Constraints", () => {
    const db = createDb(":memory:");
    const userId = Number(
      db.prepare("INSERT INTO users (name, password_hash) VALUES ('Anna', 'x')").run().lastInsertRowid
    );
    db.prepare("INSERT INTO movies (tmdb_id, titel, medientyp, tmdb_json) VALUES (27205, 'Inception', 'film', '{}')").run();
    expect(() =>
      db.prepare("INSERT INTO movies (tmdb_id, titel, medientyp, tmdb_json) VALUES (1, 'X', 'doku', '{}')").run()
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.prepare("INSERT INTO ratings (user_id, tmdb_id, sterne) VALUES (?, 27205, 6)").run(userId)
    ).toThrow(/CHECK constraint failed/);
  });
});
```

- [ ] **Step 4: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – `Cannot find module '../src/db.js'` bzw. Datei existiert nicht.

- [ ] **Step 5: `server/src/db.ts` implementieren**

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS movies (
      tmdb_id INTEGER PRIMARY KEY,
      titel TEXT NOT NULL,
      jahr INTEGER,
      medientyp TEXT NOT NULL CHECK (medientyp IN ('film','serie')),
      genres TEXT NOT NULL DEFAULT '[]',
      poster_url TEXT,
      overview TEXT,
      tmdb_json TEXT NOT NULL,
      zuletzt_aktualisiert TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection (
      tmdb_id INTEGER PRIMARY KEY REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ratings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      sterne INTEGER NOT NULL CHECK (sterne BETWEEN 1 AND 5),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS watch_status (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('schauen','gesehen','kein_interesse')),
      PRIMARY KEY (user_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS notes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS list_items (
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, tmdb_id)
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      query TEXT PRIMARY KEY,
      tmdb_json TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function createDb(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}
```

- [ ] **Step 6: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS (2 Tests).

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore server
git commit -m "chore: Projekt-Scaffold und Datenbankschema"
```

---

### Task 2: Authentifizierung

**Files:**
- Create: `server/src/passwords.ts`
- Create: `server/src/sessions.ts`
- Create: `server/src/middleware.ts`
- Create: `server/src/routes/authRoutes.ts`
- Create: `server/src/app.ts` (Minimalfassung, nur Auth-Router)
- Test: `server/tests/auth.test.ts`

**Interfaces:**
- Consumes: `createDb` (Task 1)
- Produces: `hashPassword(pw: string): string`, `verifyPassword(pw: string, stored: string): boolean`; `SESSION_COOKIE = "fdb_session"`, `createSession(db, userId): string`, `deleteSession(db, token): void`, `findSessionUser(db, token): {id, name, is_admin} | null`; `parseCookies(header?: string): Record<string,string>`, `requireAuth(db)` (Middleware, setzt `req.user`), `requireAdmin`, `asyncHandler`; `createApp(db, tmdb, options?)` mit `POST /api/auth/status|register|login|logout`, `GET /api/auth/me`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`server/tests/auth.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async () => {
    throw new Error("in Auth-Test nicht benutzt");
  },
};

describe("Auth", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("erster registrierter Nutzer wird Admin und bekommt Session", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    expect(res.status).toBe(201);
    expect(res.body.is_admin).toBe(1);
    expect(res.headers["set-cookie"]?.[0]).toContain("fdb_session=");
  });

  it("zweiter Nutzer braucht Admin-Session", async () => {
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const ohneAuth = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" });
    expect(ohneAuth.status).toBe(401);
    const cookie = admin.headers["set-cookie"][0].split(";")[0];
    const mitAuth = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" }).set("Cookie", cookie);
    expect(mitAuth.status).toBe(201);
    expect(mitAuth.body.is_admin).toBe(0);
  });

  it("Login mit falschem Passwort → 401", async () => {
    await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const res = await request(app).post("/api/auth/login").send({ name: "Anna", password: "falsch" });
    expect(res.status).toBe(401);
  });

  it("Login → /me → Logout invalidiert die Session", async () => {
    await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const login = await request(app).post("/api/auth/login").send({ name: "Anna", password: "geheim123" });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe("Anna");
    await request(app).post("/api/auth/logout").set("Cookie", cookie);
    const meAfter = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(meAfter.status).toBe(401);
  });

  it("status meldet needsBootstrap nur ohne Nutzer", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.body.needsBootstrap).toBe(true);
    await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    const res2 = await request(app).get("/api/auth/status");
    expect(res2.body.needsBootstrap).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – Module `../src/app.js` existiert nicht.

- [ ] **Step 3: `server/src/passwords.ts` implementieren**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
```

- [ ] **Step 4: `server/src/sessions.ts` implementieren**

```ts
import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "fdb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 Tage

export function createSession(db: Database.Database, userId: number): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return token;
}

export function deleteSession(db: Database.Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function findSessionUser(
  db: Database.Database,
  token: string
): { id: number; name: string; is_admin: number } | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > strftime('%s','now')`
    )
    .get(token) as { id: number; name: string; is_admin: number } | undefined;
  return row ?? null;
}
```

- [ ] **Step 5: `server/src/middleware.ts` implementieren**

```ts
import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import { findSessionUser, SESSION_COOKIE } from "./sessions.js";

export interface AuthedRequest extends Request {
  user: { id: number; name: string; is_admin: number };
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function requireAuth(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const user = token ? findSessionUser(db, token) : null;
    if (!user) {
      res.status(401).json({ error: "Nicht angemeldet" });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user.is_admin) {
    res.status(403).json({ error: "Nur für Admins" });
    return;
  }
  next();
}

export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}
```

- [ ] **Step 6: `server/src/routes/authRoutes.ts` implementieren**

```ts
import { Router } from "express";
import type Database from "better-sqlite3";
import { hashPassword, verifyPassword } from "../passwords.js";
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE } from "../sessions.js";
import { asyncHandler, AuthedRequest, parseCookies, requireAuth } from "../middleware.js";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users");

  router.get("/status", (_req, res) => {
    res.json({ needsBootstrap: (userCount.get() as { n: number }).n === 0 });
  });

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const isBootstrap = (userCount.get() as { n: number }).n === 0;
      if (!isBootstrap) {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies[SESSION_COOKIE];
        const admin = token ? findSessionUser(db, token) : null;
        if (!admin) {
          res.status(401).json({ error: "Nicht angemeldet" });
          return;
        }
        if (!admin.is_admin) {
          res.status(403).json({ error: "Nur für Admins" });
          return;
        }
      }
      const { name, password } = (req.body ?? {}) as { name?: unknown; password?: unknown };
      if (typeof name !== "string" || name.trim().length < 2) {
        res.status(400).json({ error: "Name muss mindestens 2 Zeichen haben" });
        return;
      }
      if (typeof password !== "string" || password.length < 6) {
        res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
        return;
      }
      const trimmed = name.trim();
      const existing = db.prepare("SELECT id FROM users WHERE name = ?").get(trimmed);
      if (existing) {
        res.status(409).json({ error: "Name ist bereits vergeben" });
        return;
      }
      const info = db
        .prepare("INSERT INTO users (name, password_hash, is_admin) VALUES (?, ?, ?)")
        .run(trimmed, hashPassword(password), isBootstrap ? 1 : 0);
      const userId = Number(info.lastInsertRowid);
      if (isBootstrap) {
        const token = createSession(db, userId);
        res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
      }
      res.status(201).json({ id: userId, name: trimmed, is_admin: isBootstrap ? 1 : 0 });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { name, password } = (req.body ?? {}) as { name?: unknown; password?: unknown };
      const user =
        typeof name === "string"
          ? (db.prepare("SELECT * FROM users WHERE name = ?").get(name.trim()) as
              | { id: number; name: string; password_hash: string; is_admin: number }
              | undefined)
          : undefined;
      if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: "Name oder Passwort falsch" });
        return;
      }
      const token = createSession(db, user.id);
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
      res.json({ id: user.id, name: user.name, is_admin: user.is_admin });
    })
  );

  router.post("/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  router.get("/me", requireAuth(db), (req, res) => {
    const u = (req as AuthedRequest).user;
    res.json({ id: u.id, name: u.name, is_admin: u.is_admin });
  });

  return router;
}
```

- [ ] **Step 7: `server/src/app.ts` implementieren (Minimalfassung für Auth)**

```ts
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "./tmdb.js";
import { createAuthRouter } from "./routes/authRoutes.js";

export interface AppOptions {
  clientDistDir?: string;
}

export function createApp(db: Database.Database, tmdb: TmdbClient, options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use("/api/auth", createAuthRouter(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unbekannter API-Endpunkt" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: "Ungültiges JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Interner Serverfehler" });
  });

  return app;
}
```

(Statik/SPA-Fallback kommt in Task 7; `tmdb` wird ab Task 3 genutzt.)

- [ ] **Step 8: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS – alle 5 Auth-Tests grün.

- [ ] **Step 9: Commit**

```bash
git add server/src server/tests
git commit -m "feat: Authentifizierung mit Bootstrap-Admin, Login und Sessions"
```

---

### Task 3: TMDB-Proxy & Such-Cache

**Files:**
- Create: `server/src/tmdb.ts`
- Create: `server/src/routes/searchRoutes.ts`
- Modify: `server/src/app.ts` (Search-Router mounten, `tmdb` nutzen)
- Test: `server/tests/search.test.ts`

**Interfaces:**
- Consumes: `createDb`, `createApp` (Task 1/2), `requireAuth` (Task 2)
- Produces: `createTmdbClient({ apiKey, fetchImpl?, maxRetries? }): TmdbClient` mit `search(query): Promise<TmdbMovie[]>` und `details(tmdbId, medientyp): Promise<TmdbMovie>`; `TmdbMovie = { tmdb_id, titel, jahr, medientyp, genres: string[], poster_url, overview }`; Route `GET /api/search?q=` (auth-pflichtig, liefert `{ results: TmdbMovie[] }`, gecacht in `search_cache`, TTL 7 Tage).

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`server/tests/search.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { createTmdbClient } from "../src/tmdb.js";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tmdbSearchResponse(): Record<string, unknown> {
  return {
    results: [
      { id: 27205, title: "Inception", release_date: "2010-07-15", media_type: "movie", genre_ids: [28, 878], overview: "Traum im Traum", poster_path: "/x.jpg" },
      { id: 1399, name: "Game of Thrones", first_air_date: "2011-04-17", media_type: "tv", genre_ids: [18], overview: "Eiserne Throne", poster_path: "/y.jpg" },
      { id: 999, name: "Jemand", media_type: "person" },
    ],
  };
}

describe("TMDB-Suche", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let adminCookie: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    db = createDb(":memory:");
    app = createApp(db, createTmdbClient({ apiKey: "testkey", fetchImpl: fetchMock }));
    const admin = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    adminCookie = admin.headers["set-cookie"][0].split(";")[0];
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("mappt Suchergebnisse und filtert 'person' heraus", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [{ id: 28, name: "Action" }, { id: 878, name: "Science Fiction" }] });
      if (u.pathname.endsWith("/genre/tv/list")) return jsonResponse({ genres: [{ id: 18, name: "Drama" }] });
      return jsonResponse(tmdbSearchResponse());
    });
    const res = await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toMatchObject({ tmdb_id: 27205, titel: "Inception", jahr: 2010, medientyp: "film", genres: ["Action", "Science Fiction"] });
    expect(res.body.results[1]).toMatchObject({ tmdb_id: 1399, titel: "Game of Thrones", medientyp: "serie", genres: ["Drama"] });
  });

  it("cacht die zweite identische Suche (kein zweiter TMDB-Call)", async () => {
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      if (u.pathname.endsWith("/genre/tv/list")) return jsonResponse({ genres: [] });
      return jsonResponse(tmdbSearchResponse());
    });
    await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    const callsNachErster = fetchMock.mock.calls.length;
    const res = await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(callsNachErster);
  });

  it("wiederholt bei HTTP 429 mit Backoff und liefert dann Ergebnisse", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (url: URL | RequestInfo) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/genre/movie/list")) return jsonResponse({ genres: [] });
      if (u.pathname.endsWith("/genre/tv/list")) return jsonResponse({ genres: [] });
      calls++;
      return calls === 1 ? jsonResponse({}, 429) : jsonResponse(tmdbSearchResponse());
    });
    const res = await request(app).get("/api/search?q=inception").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("liefert 401 ohne Session und 400 ohne q", async () => {
    const unauth = await request(app).get("/api/search?q=inception");
    expect(unauth.status).toBe(401);
    const noQ = await request(app).get("/api/search").set("Cookie", adminCookie);
    expect(noQ.status).toBe(400);
  });
});
```

- [ ] **Step 2: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – `Cannot find module '../src/tmdb.js'`.

- [ ] **Step 3: `server/src/tmdb.ts` implementieren**

```ts
export interface TmdbMovie {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
  genres: string[];
  poster_url: string | null;
  overview: string | null;
}

export interface TmdbClient {
  search(query: string): Promise<TmdbMovie[]>;
  details(tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie>;
}

export class TmdbError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

export function createTmdbClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}): TmdbClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 3;

  let movieGenres: Map<number, string> | null = null;
  let tvGenres: Map<number, string> | null = null;

  async function request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set("api_key", options.apiKey);
    url.searchParams.set("language", "de-DE");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
      let res: Response;
      try {
        res = await fetchImpl(url);
      } catch (err) {
        lastError = err;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new TmdbError(`TMDB antwortet mit ${res.status}`, res.status);
        continue;
      }
      if (!res.ok) {
        throw new TmdbError(`TMDB antwortet mit ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    }
    throw lastError instanceof Error ? lastError : new TmdbError("TMDB nicht erreichbar");
  }

  async function genreMap(medientyp: "film" | "serie"): Promise<Map<number, string>> {
    const cached = medientyp === "film" ? movieGenres : tvGenres;
    if (cached) return cached;
    const list = await request<{ genres: { id: number; name: string }[] }>(
      medientyp === "film" ? "/genre/movie/list" : "/genre/tv/list",
      {}
    );
    const map = new Map(list.genres.map((g) => [g.id, g.name]));
    if (medientyp === "film") movieGenres = map;
    else tvGenres = map;
    return map;
  }

  function mapResult(raw: Record<string, any>, medientyp: "film" | "serie", genres: Map<number, string>): TmdbMovie {
    const date = raw.release_date ?? raw.first_air_date;
    return {
      tmdb_id: raw.id,
      titel: raw.title ?? raw.name ?? "Unbekannter Titel",
      jahr: date ? (Number(date.slice(0, 4)) || null) : null,
      medientyp,
      genres: ((raw.genre_ids ?? []) as number[])
        .map((id) => genres.get(id))
        .filter((g): g is string => Boolean(g)),
      poster_url: raw.poster_path ? POSTER_BASE + raw.poster_path : null,
      overview: raw.overview || null,
    };
  }

  return {
    async search(query: string): Promise<TmdbMovie[]> {
      const data = await request<{ results: any[] }>("/search/multi", { query, include_adult: "false" });
      const [movieMap, tvMap] = await Promise.all([genreMap("film"), genreMap("serie")]);
      return data.results
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .map((r) => mapResult(r, r.media_type === "tv" ? "serie" : "film", r.media_type === "tv" ? tvMap : movieMap));
    },
    async details(tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie> {
      const path = medientyp === "film" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
      const raw = await request<any>(path, {});
      const genres = await genreMap(medientyp);
      const genreIds = ((raw.genres ?? []) as { id: number }[]).map((g) => g.id);
      return mapResult({ ...raw, genre_ids: genreIds }, medientyp, genres);
    },
  };
}
```

- [ ] **Step 4: `server/src/routes/searchRoutes.ts` implementieren**

```ts
import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import { asyncHandler, requireAuth } from "../middleware.js";

const SEARCH_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createSearchRouter(db: Database.Database, tmdb: TmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) {
        res.status(400).json({ error: "Parameter q fehlt" });
        return;
      }
      const cached = db
        .prepare("SELECT tmdb_json FROM search_cache WHERE query = ? AND cached_at > datetime('now', ?)")
        .get(q, `-${SEARCH_TTL_SECONDS} seconds`) as { tmdb_json: string } | undefined;
      if (cached) {
        res.json({ results: JSON.parse(cached.tmdb_json) });
        return;
      }
      const results = await tmdb.search(q);
      db.prepare(
        `INSERT INTO search_cache (query, tmdb_json, cached_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(query) DO UPDATE SET tmdb_json = excluded.tmdb_json, cached_at = datetime('now')`
      ).run(q, JSON.stringify(results));
      res.json({ results });
    })
  );

  return router;
}
```

- [ ] **Step 5: `server/src/app.ts` erweitern**

Ersetze in `server/src/app.ts` die Zeile `app.use("/api/auth", createAuthRouter(db));` durch:

```ts
  app.use("/api/auth", createAuthRouter(db));
  app.use("/api/search", createSearchRouter(db, tmdb));
```

Import ergänzen:
```ts
import { createSearchRouter } from "./routes/searchRoutes.js";
```

- [ ] **Step 6: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS – alle 5 Such-Tests grün (Retry-Test dauert durch den 500-ms-Backoff ~1 s länger).

- [ ] **Step 7: Commit**

```bash
git add server/src server/tests
git commit -m "feat: TMDB-Proxy mit Genre-Mapping, Retry/Backoff und Such-Cache"
```

---

### Task 4: Sammlung (hinzufügen, auflisten mit Filtern, entfernen)

**Files:**
- Create: `server/src/routes/collectionRoutes.ts`
- Create: `server/src/queries.ts`
- Modify: `server/src/app.ts` (Collection-Router mounten)
- Test: `server/tests/collection.test.ts`

**Interfaces:**
- Consumes: `createTmdbClient.details` (Task 3), `requireAuth` (Task 2)
- Produces: `GET /api/collection?q&genre&medientyp&status&sort` → `MovieView[]`; `POST /api/collection {tmdb_id, medientyp}` → 201/200; `DELETE /api/collection/:tmdbId` → 204. `MovieView = { tmdb_id, titel, jahr, medientyp, genres: string[], poster_url, overview, added_at, added_by_name, avg_rating, rating_count, my_rating, my_status, my_note, my_list_ids: number[] }`. `listMovieViews(db, userId, fromSql, extraWhere, params, orderBy): MovieView[]` (aus `queries.ts`, vom Listen-Task wiederverwendet).

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`server/tests/collection.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";

const filme: Record<number, TmdbMovie> = {
  27205: { tmdb_id: 27205, titel: "Inception", jahr: 2010, medientyp: "film", genres: ["Action"], poster_url: null, overview: "Traum" },
  157336: { tmdb_id: 157336, titel: "Interstellar", jahr: 2014, medientyp: "film", genres: ["Science Fiction"], poster_url: null, overview: "Wurmloch" },
  1399: { tmdb_id: 1399, titel: "Game of Thrones", jahr: 2011, medientyp: "serie", genres: ["Drama"], poster_url: null, overview: "Drachen" },
};

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie") => {
    const f = filme[tmdbId];
    if (!f) throw new Error("unbekannt");
    return { ...f, medientyp };
  },
};

describe("Sammlung", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let annaCookie: string;
  let benCookie: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    const anna = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    annaCookie = anna.headers["set-cookie"][0].split(";")[0];
    const ben = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" }).set("Cookie", annaCookie);
    const benLogin = await request(app).post("/api/auth/login").send({ name: "Ben", password: "geheim123" });
    benCookie = benLogin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 27205, medientyp: "film" });
    await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 157336, medientyp: "film" });
    await request(app).post("/api/collection").set("Cookie", benCookie).send({ tmdb_id: 1399, medientyp: "serie" });
  });

  it("fügt einen Film hinzu (erzeugt movies- und collection-Zeile)", async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM movies").get() as { n: number };
    expect(before.n).toBe(3);
    const res = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 157336, medientyp: "film" });
    expect(res.status).toBe(200); // bereits vorhanden
    const after = db.prepare("SELECT COUNT(*) AS n FROM movies").get() as { n: number };
    expect(after.n).toBe(3);
  });

  it("validiert tmdb_id und medientyp", async () => {
    const res1 = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: "x", medientyp: "film" });
    expect(res1.status).toBe(400);
    const res2 = await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 1, medientyp: "doku" });
    expect(res2.status).toBe(400);
  });

  it.skip("listet alle Filme mit Durchschnitt und eigenen Daten", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", benCookie).send({ sterne: 4 });
    const res = await request(app).get("/api/collection").set("Cookie", annaCookie);
    expect(res.status).toBe(200);
    const inception = res.body.find((m: any) => m.tmdb_id === 27205);
    expect(inception.avg_rating).toBe(4.5);
    expect(inception.rating_count).toBe(2);
    expect(inception.my_rating).toBe(5);
    expect(inception.added_by_name).toBe("Anna");
    expect(inception.my_list_ids).toEqual([]);
  });

  it.skip("filtert nach Genre, Medientyp und Status", async () => {
    await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "gesehen" });
    const genre = await request(app).get("/api/collection?genre=Action").set("Cookie", annaCookie);
    expect(genre.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
    const typ = await request(app).get("/api/collection?medientyp=serie").set("Cookie", annaCookie);
    expect(typ.body.map((m: any) => m.tmdb_id)).toEqual([1399]);
    const status = await request(app).get("/api/collection?status=gesehen").set("Cookie", annaCookie);
    expect(status.body.map((m: any) => m.tmdb_id)).toEqual([27205]);
  });

  it.skip("sortiert nach Bewertung absteigend", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    await request(app).put("/api/movies/1399/rating").set("Cookie", annaCookie).send({ sterne: 1 });
    const res = await request(app).get("/api/collection?sort=bewertung").set("Cookie", annaCookie);
    expect(res.body[0].tmdb_id).toBe(27205);
    expect(res.body[2].tmdb_id).toBe(1399);
  });

  it("entfernen: Admin oder Ersteller, sonst 403", async () => {
    const alsBen = await request(app).delete("/api/collection/27205").set("Cookie", benCookie);
    expect(alsBen.status).toBe(403);
    const alsErsteller = await request(app).delete("/api/collection/27205").set("Cookie", annaCookie);
    expect(alsErsteller.status).toBe(204);
    const weg = await request(app).get("/api/collection").set("Cookie", annaCookie);
    expect(weg.body.map((m: any) => m.tmdb_id)).not.toContain(27205);
  });
});
```

- [ ] **Step 2: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – `Cannot find module '../src/routes/collectionRoutes.js'`; zusätzlich schlagen 3 Tests fehl, weil `PUT /api/movies` fehlt (die 3 `it.skip`-Tests werden übersprungen, der Rest läuft). Die drei `it.skip`-Tests werden in Task 5 (Step 7) wieder aktiviert.

- [ ] **Step 3: `server/src/queries.ts` implementieren**

```ts
import type Database from "better-sqlite3";

export interface MovieView {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
  genres: string[];
  poster_url: string | null;
  overview: string | null;
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
    my_list_ids: r.my_list_ids ? JSON.parse(r.my_list_ids) : [],
    my_rating: r.my_rating ?? null,
    avg_rating: r.avg_rating ?? null,
  }));
}
```

- [ ] **Step 4: `server/src/routes/collectionRoutes.ts` implementieren**

```ts
import { Router } from "express";
import type Database from "better-sqlite3";
import type { TmdbClient } from "../tmdb.js";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { listMovieViews } from "../queries.js";

export function createCollectionRouter(db: Database.Database, tmdb: TmdbClient): Router {
  const router = Router();
  router.use(requireAuth(db));

  const upsertMovie = db.prepare(
    `INSERT INTO movies (tmdb_id, titel, jahr, medientyp, genres, poster_url, overview, tmdb_json)
     VALUES (@tmdb_id, @titel, @jahr, @medientyp, @genres, @poster_url, @overview, @tmdb_json)
     ON CONFLICT(tmdb_id) DO UPDATE SET
       titel = excluded.titel, jahr = excluded.jahr, medientyp = excluded.medientyp,
       genres = excluded.genres, poster_url = excluded.poster_url, overview = excluded.overview,
       tmdb_json = excluded.tmdb_json, zuletzt_aktualisiert = datetime('now')`
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { tmdb_id, medientyp } = (req.body ?? {}) as { tmdb_id?: unknown; medientyp?: unknown };
      if (!Number.isInteger(tmdb_id) || (medientyp !== "film" && medientyp !== "serie")) {
        res.status(400).json({ error: "tmdb_id (Integer) und medientyp ('film'|'serie') erforderlich" });
        return;
      }
      const existing = db.prepare("SELECT 1 FROM collection WHERE tmdb_id = ?").get(tmdb_id);
      if (existing) {
        res.status(200).json({ message: "Bereits in der Sammlung" });
        return;
      }
      let movie;
      try {
        movie = await tmdb.details(tmdb_id, medientyp);
      } catch {
        res.status(502).json({ error: "TMDB nicht erreichbar – bitte erneut versuchen" });
        return;
      }
      upsertMovie.run({
        tmdb_id: movie.tmdb_id,
        titel: movie.titel,
        jahr: movie.jahr,
        medientyp: movie.medientyp,
        genres: JSON.stringify(movie.genres),
        poster_url: movie.poster_url,
        overview: movie.overview,
        tmdb_json: JSON.stringify(movie),
      });
      const user = (req as AuthedRequest).user;
      db.prepare("INSERT INTO collection (tmdb_id, added_by) VALUES (?, ?)").run(tmdb_id, user.id);
      res.status(201).json({ message: "Zur Sammlung hinzugefügt" });
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedRequest).user.id;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const genre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";
      const medientyp = typeof req.query.medientyp === "string" ? req.query.medientyp : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const sort = typeof req.query.sort === "string" ? req.query.sort : "zuletzt_hinzugefuegt";

      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (q) {
        where.push("m.titel LIKE @q");
        params.q = `%${q}%`;
      }
      if (genre) {
        where.push("m.genres LIKE @genre");
        params.genre = `%${genre}%`;
      }
      if (medientyp === "film" || medientyp === "serie") {
        where.push("m.medientyp = @medientyp");
        params.medientyp = medientyp;
      }
      if (status) {
        where.push("ws.status = @status");
        params.status = status;
      }

      const orderBy: Record<string, string> = {
        titel: "m.titel COLLATE NOCASE ASC",
        jahr: "m.jahr DESC",
        bewertung: "avg_rating DESC",
        zuletzt_hinzugefuegt: "c.added_at DESC",
      };

      const rows = listMovieViews(
        db,
        userId,
        "FROM collection c JOIN movies m ON m.tmdb_id = c.tmdb_id LEFT JOIN users u ON u.id = c.added_by",
        where,
        params,
        orderBy[sort] ?? orderBy.zuletzt_hinzugefuegt
      );
      res.json(rows);
    })
  );

  router.delete(
    "/:tmdbId",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const user = (req as AuthedRequest).user;
      const row = db.prepare("SELECT added_by FROM collection WHERE tmdb_id = ?").get(tmdbId) as
        | { added_by: number }
        | undefined;
      if (!row) {
        res.status(404).json({ error: "Nicht in der Sammlung" });
        return;
      }
      if (row.added_by !== user.id && !user.is_admin) {
        res.status(403).json({ error: "Nur Admin oder Ersteller darf entfernen" });
        return;
      }
      db.prepare("DELETE FROM collection WHERE tmdb_id = ?").run(tmdbId);
      res.status(204).end();
    })
  );

  return router;
}
```

- [ ] **Step 5: `server/src/app.ts` erweitern**

Ersetze in `server/src/app.ts`:
```ts
  app.use("/api/search", createSearchRouter(db, tmdb));
```
durch:
```ts
  app.use("/api/search", createSearchRouter(db, tmdb));
  app.use("/api/collection", createCollectionRouter(db, tmdb));
```

Import ergänzen:
```ts
import { createCollectionRouter } from "./routes/collectionRoutes.js";
```

- [ ] **Step 6: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS – 3 aktive Sammlungs-Tests grün (3 `it.skip` bleiben übersprungen).

- [ ] **Step 7: Commit**

```bash
git add server/src server/tests
git commit -m "feat: Sammlung mit TMDB-Details-Abruf, Filter-Listing und Entfernen"
```

---

### Task 5: Bewertung, Watch-Status, Notizen

**Files:**
- Create: `server/src/routes/movieRoutes.ts`
- Modify: `server/src/app.ts` (Movie-Router mounten)
- Modify: `server/tests/collection.test.ts` (3 `it.skip` wieder aktivieren)
- Test: `server/tests/movie.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 2)
- Produces: `PUT /api/movies/:tmdbId/rating {sterne}` → 204 (UPSERT); `PUT /api/movies/:tmdbId/watch-status {status}` → 204 (UPSERT); `PUT /api/movies/:tmdbId/note {text}` → 204 (UPSERT); `DELETE /api/movies/:tmdbId/note` → 204. Alle nur für die eigene Session.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`server/tests/movie.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie> => ({
    tmdb_id: tmdbId,
    titel: "Inception",
    jahr: 2010,
    medientyp,
    genres: ["Action"],
    poster_url: null,
    overview: "Traum",
  }),
};

describe("Bewertung, Status, Notizen", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let annaCookie: string;
  let benCookie: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    const anna = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    annaCookie = anna.headers["set-cookie"][0].split(";")[0];
    const ben = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" }).set("Cookie", annaCookie);
    const benLogin = await request(app).post("/api/auth/login").send({ name: "Ben", password: "geheim123" });
    benCookie = benLogin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 27205, medientyp: "film" });
  });

  it("Bewertung ist ein UPSERT (zweites Setzen überschreibt)", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 3 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    const rows = db.prepare("SELECT * FROM ratings").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).sterne).toBe(5);
  });

  it("validiert Bewertung (1–5)", async () => {
    const res0 = await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 0 });
    expect(res0.status).toBe(400);
    const res6 = await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 6 });
    expect(res6.status).toBe(400);
  });

  it("Bewertungen bleiben pro Nutzer getrennt", async () => {
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 5 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", benCookie).send({ sterne: 2 });
    const anna = db.prepare("SELECT sterne FROM ratings WHERE user_id = (SELECT id FROM users WHERE name = 'Anna')").get();
    const ben = db.prepare("SELECT sterne FROM ratings WHERE user_id = (SELECT id FROM users WHERE name = 'Ben')").get();
    expect((anna as any).sterne).toBe(5);
    expect((ben as any).sterne).toBe(2);
  });

  it("Watch-Status: gültige Werte, UPSERT", async () => {
    const resBad = await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "vielleicht" });
    expect(resBad.status).toBe(400);
    await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "gesehen" });
    await request(app).put("/api/movies/27205/watch-status").set("Cookie", annaCookie).send({ status: "schauen" });
    const rows = db.prepare("SELECT * FROM watch_status").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).status).toBe("schauen");
  });

  it("Notiz setzen und löschen; leere Notiz → 400", async () => {
    const resLeer = await request(app).put("/api/movies/27205/note").set("Cookie", annaCookie).send({ text: "" });
    expect(resLeer.status).toBe(400);
    await request(app).put("/api/movies/27205/note").set("Cookie", annaCookie).send({ text: "Mit Popcorn" });
    const rows = db.prepare("SELECT * FROM notes").all();
    expect(rows).toHaveLength(1);
    await request(app).delete("/api/movies/27205/note").set("Cookie", annaCookie);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 2: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – 404 für `PUT /api/movies/...` (Router fehlt).

- [ ] **Step 3: `server/src/routes/movieRoutes.ts` implementieren**

```ts
import { Router } from "express";
import type Database from "better-sqlite3";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";

const STATUS_VALUES = ["schauen", "gesehen", "kein_interesse"] as const;

export function createMovieRouter(db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.put(
    "/:tmdbId/rating",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const sterne = (req.body ?? {}).sterne;
      if (!Number.isInteger(tmdbId) || !Number.isInteger(sterne) || sterne < 1 || sterne > 5) {
        res.status(400).json({ error: "sterne (Integer 1–5) erforderlich" });
        return;
      }
      const user = (req as AuthedRequest).user;
      db.prepare(
        `INSERT INTO ratings (user_id, tmdb_id, sterne, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, tmdb_id) DO UPDATE SET sterne = excluded.sterne, updated_at = datetime('now')`
      ).run(user.id, tmdbId, sterne);
      res.status(204).end();
    })
  );

  router.put(
    "/:tmdbId/watch-status",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const status = (req.body ?? {}).status;
      if (!Number.isInteger(tmdbId) || !STATUS_VALUES.includes(status)) {
        res.status(400).json({ error: "status ('schauen'|'gesehen'|'kein_interesse') erforderlich" });
        return;
      }
      const user = (req as AuthedRequest).user;
      db.prepare(
        `INSERT INTO watch_status (user_id, tmdb_id, status) VALUES (?, ?, ?)
         ON CONFLICT(user_id, tmdb_id) DO UPDATE SET status = excluded.status`
      ).run(user.id, tmdbId, status);
      res.status(204).end();
    })
  );

  router.put(
    "/:tmdbId/note",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const text = (req.body ?? {}).text;
      if (!Number.isInteger(tmdbId) || typeof text !== "string" || text.trim().length === 0) {
        res.status(400).json({ error: "text (nicht leer) erforderlich" });
        return;
      }
      const user = (req as AuthedRequest).user;
      db.prepare(
        `INSERT INTO notes (user_id, tmdb_id, text, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, tmdb_id) DO UPDATE SET text = excluded.text, updated_at = datetime('now')`
      ).run(user.id, tmdbId, text.trim());
      res.status(204).end();
    })
  );

  router.delete(
    "/:tmdbId/note",
    asyncHandler(async (req, res) => {
      const tmdbId = Number(req.params.tmdbId);
      const user = (req as AuthedRequest).user;
      db.prepare("DELETE FROM notes WHERE user_id = ? AND tmdb_id = ?").run(user.id, tmdbId);
      res.status(204).end();
    })
  );

  return router;
}
```

- [ ] **Step 4: `server/src/app.ts` erweitern**

Ersetze in `server/src/app.ts`:
```ts
  app.use("/api/collection", createCollectionRouter(db, tmdb));
```
durch:
```ts
  app.use("/api/collection", createCollectionRouter(db, tmdb));
  app.use("/api/movies", createMovieRouter(db));
```

Import ergänzen:
```ts
import { createMovieRouter } from "./routes/movieRoutes.js";
```

- [ ] **Step 5: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS – alle 5 Movie-Tests grün.

- [ ] **Step 6: Geskippte Sammlungs-Tests reaktivieren**

In `server/tests/collection.test.ts` alle drei `it.skip(` durch `it(` ersetzen.

- [ ] **Step 7: Gesamten Server-Testlauf ausführen**

Run: `npm run test -w server`
Expected: PASS – auth (5), search (5), collection (6), movie (5).

- [ ] **Step 8: Commit**

```bash
git add server/src server/tests
git commit -m "feat: Bewertungen, Watch-Status und Notizen als UPSERTs"
```

---

### Task 6: Persönliche Listen

**Files:**
- Create: `server/src/routes/listRoutes.ts`
- Modify: `server/src/app.ts` (Listen-Router mounten)
- Test: `server/tests/lists.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 2), `listMovieViews` (Task 4)
- Produces: `GET /api/lists` → `ListSummary[]`; `POST /api/lists {name}` → 201 `{id, name}`; `PUT /api/lists/:id {name}` → 204; `DELETE /api/lists/:id` → 204; `GET /api/lists/:id` → `{id, name, items: MovieView[]}`; `POST /api/lists/:id/items {tmdb_id}` → 201 (oder 200 bei Duplikat); `DELETE /api/lists/:id/items/:tmdbId` → 204. Alles nur für den Besitzer. `ListSummary = { id, name, item_count }`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`server/tests/lists.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient, TmdbMovie } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async (tmdbId: number, medientyp: "film" | "serie"): Promise<TmdbMovie> => ({
    tmdb_id: tmdbId,
    titel: `Film ${tmdbId}`,
    jahr: 2010,
    medientyp,
    genres: ["Action"],
    poster_url: null,
    overview: null,
  }),
};

describe("Persönliche Listen", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;
  let annaCookie: string;
  let benCookie: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
    const anna = await request(app).post("/api/auth/register").send({ name: "Anna", password: "geheim123" });
    annaCookie = anna.headers["set-cookie"][0].split(";")[0];
    const ben = await request(app).post("/api/auth/register").send({ name: "Ben", password: "geheim123" }).set("Cookie", annaCookie);
    const benLogin = await request(app).post("/api/auth/login").send({ name: "Ben", password: "geheim123" });
    benCookie = benLogin.headers["set-cookie"][0].split(";")[0];
    await request(app).post("/api/collection").set("Cookie", annaCookie).send({ tmdb_id: 27205, medientyp: "film" });
  });

  it("Liste anlegen, umbenennen, auflisten (nur eigene)", async () => {
    const create = await request(app).post("/api/lists").set("Cookie", annaCookie).send({ name: "Science Fiction Abend" });
    expect(create.status).toBe(201);
    const listId = create.body.id;
    await request(app).put(`/api/lists/${listId}`).set("Cookie", annaCookie).send({ name: "SciFi Abend" });
    const lists = await request(app).get("/api/lists").set("Cookie", annaCookie);
    expect(lists.body).toEqual([{ id: listId, name: "SciFi Abend", item_count: 0 }]);
    const fremde = await request(app).get("/api/lists").set("Cookie", benCookie);
    expect(fremde.body).toEqual([]);
  });

  it("nur der Besitzer darf Liste ändern/löschen", async () => {
    const create = await request(app).post("/api/lists").set("Cookie", annaCookie).send({ name: "Meine Liste" });
    const listId = create.body.id;
    const res = await request(app).delete(`/api/lists/${listId}`).set("Cookie", benCookie);
    expect(res.status).toBe(403);
    const res2 = await request(app).put(`/api/lists/${listId}`).set("Cookie", benCookie).send({ name: "gehackt" });
    expect(res2.status).toBe(403);
  });

  it("Film zur Liste hinzufügen (nur vorhandene Filme), Duplikat idempotent", async () => {
    const create = await request(app).post("/api/lists").set("Cookie", annaCookie).send({ name: "Meine Liste" });
    const listId = create.body.id;
    const res = await request(app).post(`/api/lists/${listId}/items`).set("Cookie", annaCookie).send({ tmdb_id: 9999 });
    expect(res.status).toBe(400); // Film existiert nicht in movies
    await request(app).post(`/api/lists/${listId}/items`).set("Cookie", annaCookie).send({ tmdb_id: 27205 });
    await request(app).post(`/api/lists/${listId}/items`).set("Cookie", annaCookie).send({ tmdb_id: 27205 });
    const rows = db.prepare("SELECT COUNT(*) AS n FROM list_items").get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it("Liste mit Items auslesen (MovieView-Shape inkl. eigener Bewertung)", async () => {
    const create = await request(app).post("/api/lists").set("Cookie", annaCookie).send({ name: "Top" });
    const listId = create.body.id;
    await request(app).post(`/api/lists/${listId}/items`).set("Cookie", annaCookie).send({ tmdb_id: 27205 });
    await request(app).put("/api/movies/27205/rating").set("Cookie", annaCookie).send({ sterne: 4 });
    const res = await request(app).get(`/api/lists/${listId}`).set("Cookie", annaCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tmdb_id).toBe(27205);
    expect(res.body.items[0].my_rating).toBe(4);
  });

  it("Item entfernen und Liste löschen (löscht Items per Cascade)", async () => {
    const create = await request(app).post("/api/lists").set("Cookie", annaCookie).send({ name: "Top" });
    const listId = create.body.id;
    await request(app).post(`/api/lists/${listId}/items`).set("Cookie", annaCookie).send({ tmdb_id: 27205 });
    await request(app).delete(`/api/lists/${listId}/items/27205`).set("Cookie", annaCookie);
    expect(db.prepare("SELECT COUNT(*) AS n FROM list_items").get()).toEqual({ n: 0 });
    await request(app).delete(`/api/lists/${listId}`).set("Cookie", annaCookie);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lists").get()).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 2: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – 404 für `/api/lists`.

- [ ] **Step 3: `server/src/routes/listRoutes.ts` implementieren**

```ts
import { Router } from "express";
import type Database from "better-sqlite3";
import { asyncHandler, AuthedRequest, requireAuth } from "../middleware.js";
import { listMovieViews } from "../queries.js";

export function createListRouter(db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth(db));

  function requireOwner(req: AuthedRequest, listId: number): boolean {
    const row = db.prepare("SELECT owner_id FROM lists WHERE id = ?").get(listId) as { owner_id: number } | undefined;
    if (!row) return false;
    return row.owner_id === req.user.id;
  }

  router.get("/", (req, res) => {
    const user = (req as AuthedRequest).user;
    const lists = db
      .prepare(
        `SELECT l.id, l.name, l.created_at, COUNT(li.tmdb_id) AS item_count
         FROM lists l LEFT JOIN list_items li ON li.list_id = l.id
         WHERE l.owner_id = ?
         GROUP BY l.id ORDER BY l.created_at DESC`
      )
      .all(user.id);
    res.json(lists);
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const name = (req.body ?? {}).name;
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name (nicht leer) erforderlich" });
        return;
      }
      const user = (req as AuthedRequest).user;
      const info = db.prepare("INSERT INTO lists (owner_id, name) VALUES (?, ?)").run(user.id, name.trim());
      res.status(201).json({ id: Number(info.lastInsertRowid), name: name.trim() });
    })
  );

  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      const name = (req.body ?? {}).name;
      if (!Number.isInteger(listId) || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name (nicht leer) erforderlich" });
        return;
      }
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf die Liste ändern" });
        return;
      }
      db.prepare("UPDATE lists SET name = ? WHERE id = ?").run(name.trim(), listId);
      res.status(204).end();
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf die Liste löschen" });
        return;
      }
      db.prepare("DELETE FROM lists WHERE id = ?").run(listId);
      res.status(204).end();
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf die Liste sehen" });
        return;
      }
      const list = db.prepare("SELECT id, name FROM lists WHERE id = ?").get(listId) as { id: number; name: string };
      const items = listMovieViews(
        db,
        (req as AuthedRequest).user.id,
        "FROM list_items c JOIN movies m ON m.tmdb_id = c.tmdb_id JOIN users u ON u.id = (SELECT added_by FROM collection WHERE tmdb_id = c.tmdb_id)",
        ["c.list_id = @listId"],
        { listId },
        "c.tmdb_id ASC"
      );
      res.json({ ...list, items });
    })
  );

  router.post(
    "/:id/items",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      const tmdbId = (req.body ?? {}).tmdb_id;
      if (!Number.isInteger(listId) || !Number.isInteger(tmdbId)) {
        res.status(400).json({ error: "tmdb_id (Integer) erforderlich" });
        return;
      }
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf Items hinzufügen" });
        return;
      }
      const movieExists = db.prepare("SELECT 1 FROM movies WHERE tmdb_id = ?").get(tmdbId);
      if (!movieExists) {
        res.status(400).json({ error: "Film ist nicht in der Sammlung" });
        return;
      }
      const info = db.prepare("INSERT OR IGNORE INTO list_items (list_id, tmdb_id) VALUES (?, ?)").run(listId, tmdbId);
      res.status(info.changes > 0 ? 201 : 200).json({ message: "ok" });
    })
  );

  router.delete(
    "/:id/items/:tmdbId",
    asyncHandler(async (req, res) => {
      const listId = Number(req.params.id);
      const tmdbId = Number(req.params.tmdbId);
      if (!requireOwner(req as AuthedRequest, listId)) {
        res.status(403).json({ error: "Nur der Besitzer darf Items entfernen" });
        return;
      }
      db.prepare("DELETE FROM list_items WHERE list_id = ? AND tmdb_id = ?").run(listId, tmdbId);
      res.status(204).end();
    })
  );

  return router;
}
```

- [ ] **Step 4: `server/src/app.ts` erweitern**

Ersetze in `server/src/app.ts`:
```ts
  app.use("/api/movies", createMovieRouter(db));
```
durch:
```ts
  app.use("/api/movies", createMovieRouter(db));
  app.use("/api/lists", createListRouter(db));
```

Import ergänzen:
```ts
import { createListRouter } from "./routes/listRoutes.js";
```

- [ ] **Step 5: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS – alle 5 Listen-Tests grün.

- [ ] **Step 6: Commit**

```bash
git add server/src server/tests
git commit -m "feat: persönliche Listen mit Items und Besitzer-Berechtigung"
```

---

### Task 7: App-Assembly, Statik & SPA-Fallback

**Files:**
- Modify: `server/src/app.ts` (Statik, SPA-Fallback, finaler Stand)
- Create: `server/src/index.ts`
- Test: `server/tests/app.test.ts`

**Interfaces:**
- Consumes: alle Router (Task 2–6)
- Produces: `createApp(db, tmdb, { clientDistDir })` liefert Statik aus `clientDistDir` (falls vorhanden) und SPA-Fallback für Nicht-API-Pfade; `index.ts` = Einstieg mit Env-Check (`TMDB_API_KEY` Pflicht, sonst `process.exit(1)`), Port 3000.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`server/tests/app.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import type { TmdbClient } from "../src/tmdb.js";

const fakeTmdb: TmdbClient = {
  search: async () => [],
  details: async () => {
    throw new Error("nicht benutzt");
  },
};

describe("App-Assembly", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDb(":memory:");
    app = createApp(db, fakeTmdb);
  });

  it("unbekannter API-Pfad → 404 als JSON", async () => {
    const res = await request(app).get("/api/gibtsnicht");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unbekannter API-Endpunkt" });
  });

  it("kaputtes JSON → 400", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{kaputt");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Ungültiges JSON");
  });

  it("liefert die SPA aus clientDistDir aus", () => {
    const dist = mkdtempSync(path.join(tmpdir(), "fdb-dist-"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Filmdatenbank</title>");
    const spaApp = createApp(db, fakeTmdb, { clientDistDir: dist });
    return request(spaApp)
      .get("/")
      .expect(200)
      .expect("Content-Type", /html/)
      .expect((res) => {
        if (!res.text.includes("Filmdatenbank")) throw new Error("index.html nicht ausgeliefert");
      });
  });
});
```

- [ ] **Step 2: Test ausführen und Fehlschlag bestätigen**

Run: `npm run test -w server`
Expected: FAIL – `/api/gibtsnicht` liefert 404 (passt), aber `{kaputt` ergibt 500 statt 400 und `GET /` liefert 404 statt HTML (Statik fehlt).

- [ ] **Step 3: `server/src/app.ts` finalisieren**

Ersetze die komplette Datei durch:
```ts
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { TmdbClient } from "./tmdb.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createSearchRouter } from "./routes/searchRoutes.js";
import { createCollectionRouter } from "./routes/collectionRoutes.js";
import { createMovieRouter } from "./routes/movieRoutes.js";
import { createListRouter } from "./routes/listRoutes.js";

export interface AppOptions {
  clientDistDir?: string;
}

export function createApp(db: Database.Database, tmdb: TmdbClient, options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use("/api/auth", createAuthRouter(db));
  app.use("/api/search", createSearchRouter(db, tmdb));
  app.use("/api/collection", createCollectionRouter(db, tmdb));
  app.use("/api/movies", createMovieRouter(db));
  app.use("/api/lists", createListRouter(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unbekannter API-Endpunkt" });
  });

  const distDir = options.clientDistDir;
  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: "Ungültiges JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Interner Serverfehler" });
  });

  return app;
}
```

(Wichtig: Die Reihenfolge zählt – API-404-Handler VOR dem SPA-Fallback, damit `/api/*` nie die index.html bekommt.)

- [ ] **Step 4: `server/src/index.ts` implementieren**

```ts
import path from "node:path";
import { createApp } from "./app.js";
import { createDb } from "./db.js";
import { createTmdbClient } from "./tmdb.js";

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) {
  console.error("FEHLER: TMDB_API_KEY ist nicht gesetzt. Abbruch.");
  process.exit(1);
}

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "filmdatenbank.db");
const db = createDb(dbPath);
const tmdb = createTmdbClient({ apiKey });
const clientDistDir = path.join(process.cwd(), "..", "client", "dist");

const app = createApp(db, tmdb, { clientDistDir });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Filmdatenbank läuft auf http://localhost:${port}`);
});
```

- [ ] **Step 5: Test ausführen und Bestehen bestätigen**

Run: `npm run test -w server`
Expected: PASS – alle 3 App-Tests grün; Gesamtlauf weiterhin grün (auth 5, search 5, collection 6, movie 5, lists 5).

- [ ] **Step 6: Commit**

```bash
git add server/src server/tests
git commit -m "feat: App-Assembly mit Statik, SPA-Fallback und Einstiegspunkt"
```

---

### Task 8: Frontend – Auth, Routing & Gerüst

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/auth.tsx`, `client/src/api.ts`, `client/src/styles.css`
- Create: `client/src/pages/LoginPage.tsx`
- Create: `client/src/components/Header.tsx`

**Interfaces:**
- Consumes: Backend-API aus Task 2–6 (Endpoints wie in `api.ts` dokumentiert)
- Produces: `api.ts` (alle typisierten Fetch-Aufrufe), `AuthProvider`/`useAuth`, `RequireAuth`-Route-Guard, `LoginPage` (Bootstrap-Erkennung via `GET /api/auth/status`), `Header` (Nav, Admin-Formular „Nutzer anlegen", Abmelden).

**Verifikation:** `npm run build -w client` (tsc-Gate) und manueller Browser-Check gegen den Dev-Server.

- [ ] **Step 1: Client-Grundgerüst anlegen**

`client/package.json`:
```json
{
  "name": "client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.3"
  }
}
```

`client/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "useDefineForClassFields": true
  },
  "include": ["src"]
}
```

`client/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

`client/index.html`:
```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Filmdatenbank</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: `client/src/api.ts` implementieren**

```ts
export interface User {
  id: number;
  name: string;
  is_admin: number;
}

export interface SearchResult {
  tmdb_id: number;
  titel: string;
  jahr: number | null;
  medientyp: "film" | "serie";
  genres: string[];
  poster_url: string | null;
  overview: string | null;
}

export interface Movie extends SearchResult {
  added_at: string;
  added_by_name: string;
  avg_rating: number | null;
  rating_count: number;
  my_rating: number | null;
  my_status: "schauen" | "gesehen" | "kein_interesse" | null;
  my_note: string | null;
  my_list_ids: number[];
}

export interface ListSummary {
  id: number;
  name: string;
  item_count: number;
}

export interface ListDetail {
  id: number;
  name: string;
  items: Movie[];
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body as { error?: string }).error) ?? `Fehler ${res.status}`);
  return body as T;
}

export const api = {
  status: () => request<{ needsBootstrap: boolean }>("/api/auth/status"),
  login: (name: string, password: string) => request<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ name, password }) }),
  register: (name: string, password: string) => request<User>("/api/auth/register", { method: "POST", body: JSON.stringify({ name, password }) }),
  me: () => request<User>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  search: (q: string) => request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  collection: (filters: Record<string, string>) => request<Movie[]>("/api/collection?" + new URLSearchParams(filters).toString()),
  addToCollection: (tmdb_id: number, medientyp: string) =>
    request<{ message: string }>("/api/collection", { method: "POST", body: JSON.stringify({ tmdb_id, medientyp }) }),
  removeFromCollection: (tmdbId: number) => request<void>(`/api/collection/${tmdbId}`, { method: "DELETE" }),
  setRating: (tmdbId: number, sterne: number) =>
    request<void>(`/api/movies/${tmdbId}/rating`, { method: "PUT", body: JSON.stringify({ sterne }) }),
  setWatchStatus: (tmdbId: number, status: string) =>
    request<void>(`/api/movies/${tmdbId}/watch-status`, { method: "PUT", body: JSON.stringify({ status }) }),
  setNote: (tmdbId: number, text: string) =>
    request<void>(`/api/movies/${tmdbId}/note`, { method: "PUT", body: JSON.stringify({ text }) }),
  deleteNote: (tmdbId: number) => request<void>(`/api/movies/${tmdbId}/note`, { method: "DELETE" }),
  lists: () => request<ListSummary[]>("/api/lists"),
  createList: (name: string) => request<{ id: number; name: string }>("/api/lists", { method: "POST", body: JSON.stringify({ name }) }),
  renameList: (id: number, name: string) => request<void>(`/api/lists/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteList: (id: number) => request<void>(`/api/lists/${id}`, { method: "DELETE" }),
  listItems: (id: number) => request<ListDetail>(`/api/lists/${id}`),
  addToList: (listId: number, tmdbId: number) =>
    request<void>(`/api/lists/${listId}/items`, { method: "POST", body: JSON.stringify({ tmdb_id: tmdbId }) }),
  removeFromList: (listId: number, tmdbId: number) =>
    request<void>(`/api/lists/${listId}/items/${tmdbId}`, { method: "DELETE" }),
};
```

- [ ] **Step 3: `client/src/auth.tsx` implementieren**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function login(name: string, password: string) {
    setUser(await api.login(name, password));
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth braucht AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: `client/src/main.tsx` und `client/src/App.tsx` implementieren**

`client/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`client/src/App.tsx`:
```tsx
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "./auth";
import LoginPage from "./pages/LoginPage";
import CollectionPage from "./pages/CollectionPage";
import ListsPage from "./pages/ListsPage";
import Header from "./components/Header";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page">Lädt…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <>
                  <Header />
                  <CollectionPage />
                </>
              </RequireAuth>
            }
          />
          <Route
            path="/listen"
            element={
              <RequireAuth>
                <>
                  <Header />
                  <ListsPage />
                </>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 5: `client/src/pages/LoginPage.tsx` implementieren**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function LoginPage() {
  const { login, refresh } = useAuth();
  const navigate = useNavigate();
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.status().then((s) => setNeedsBootstrap(s.needsBootstrap)).catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (needsBootstrap) {
        await api.register(name, password); // erster Nutzer → Admin + Session-Cookie
      } else {
        await login(name, password);
      }
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  return (
    <div className="login">
      <h1>Filmdatenbank</h1>
      <form onSubmit={onSubmit}>
        <h2>{needsBootstrap ? "Ersten Nutzer anlegen (wird Admin)" : "Anmelden"}</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort" type="password" />
        {error && <p className="error">{error}</p>}
        <button type="submit">{needsBootstrap ? "Einrichtung starten" : "Anmelden"}</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: `client/src/components/Header.tsx` implementieren**

```tsx
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function Header() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [showNewUser, setShowNewUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    try {
      await api.register(newName, newPassword);
      setMessage(`Nutzer „${newName}“ angelegt.`);
      setNewName("");
      setNewPassword("");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Fehler");
    }
  }

  return (
    <header className="header">
      <nav>
        <Link to="/">Sammlung</Link>
        <Link to="/listen">Listen</Link>
      </nav>
      <div className="user-area">
        {user?.is_admin === 1 && <button onClick={() => setShowNewUser(!showNewUser)}>Nutzer anlegen</button>}
        <span className="user-name">{user?.name}</span>
        <button
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          Abmelden
        </button>
      </div>
      {showNewUser && (
        <form className="new-user" onSubmit={createUser}>
          <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="Passwort (min. 6 Zeichen)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <button type="submit">Anlegen</button>
          {message && <p className={message.startsWith("Nutzer") ? "ok" : "error"}>{message}</p>}
        </form>
      )}
    </header>
  );
}
```

- [ ] **Step 7: `client/src/styles.css` implementieren**

```css
:root {
  color-scheme: dark;
  --bg: #14181c;
  --card: #1d242b;
  --accent: #4caf50;
  --text: #e8e6e3;
  --muted: #9aa4ad;
  --danger: #e05d5d;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
}

h1, h2, h3 { margin: 0 0 0.5rem; }

button {
  background: var(--card);
  color: var(--text);
  border: 1px solid #33404b;
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #0b0f12; font-weight: 600; }
button.active { background: var(--accent); color: #0b0f12; }
button.star { border: none; background: none; font-size: 1.4rem; color: var(--muted); padding: 0 0.15rem; }
button.star.active { color: #ffb400; }

input, select, textarea {
  background: var(--card);
  color: var(--text);
  border: 1px solid #33404b;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
}

.error { color: var(--danger); }
.ok { color: var(--accent); }
.empty { color: var(--muted); padding: 2rem; text-align: center; }

.page { max-width: 1100px; margin: 0 auto; padding: 1rem; }

.login { max-width: 340px; margin: 12vh auto 0; text-align: center; }
.login form { display: flex; flex-direction: column; gap: 0.6rem; }
.login h1 { font-size: 1.8rem; }

.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 1rem; background: var(--card);
  border-bottom: 1px solid #33404b; gap: 1rem; flex-wrap: wrap;
}
.header nav { display: flex; gap: 1rem; }
.header a { color: var(--text); text-decoration: none; }
.header a:hover { color: var(--accent); }
.user-area { display: flex; align-items: center; gap: 0.6rem; }
.user-name { color: var(--muted); }
.new-user { display: flex; gap: 0.4rem; flex-basis: 100%; }

.filterbar { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.filterbar input { flex: 1; min-width: 180px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }

.card {
  display: flex; flex-direction: column; text-align: left;
  padding: 0; overflow: hidden; background: var(--card);
}
.card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; }
.card .no-poster {
  aspect-ratio: 2/3; display: flex; align-items: center; justify-content: center;
  padding: 1rem; color: var(--muted);
}
.card-info { padding: 0.5rem; }
.card-info h3 { font-size: 0.95rem; margin: 0 0 0.3rem; }
.meta { display: flex; gap: 0.5rem; color: var(--muted); font-size: 0.85rem; flex-wrap: wrap; }
.status-badge {
  background: #2a3540; border-radius: 999px; padding: 0.05rem 0.5rem; font-size: 0.75rem;
}

.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
  display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 10;
}
.modal {
  background: var(--card); border: 1px solid #33404b; border-radius: 10px;
  padding: 1.2rem; max-width: 560px; width: 100%; max-height: 85vh; overflow-y: auto;
}
.search-results { list-style: none; padding: 0; margin: 0.8rem 0; }
.search-results li { display: flex; gap: 0.6rem; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid #26313a; }
.search-results img { width: 45px; aspect-ratio: 2/3; object-fit: cover; border-radius: 4px; }

.movie-detail .overview { color: var(--muted); }
.movie-detail .genres { color: var(--muted); font-size: 0.85rem; }
.rating, .status, .note, .lists { display: flex; gap: 0.4rem; align-items: center; margin: 0.7rem 0; flex-wrap: wrap; }
.note textarea { flex: 1; min-width: 200px; }
.lists label { display: flex; gap: 0.3rem; align-items: center; }

.list-row {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--card); border: 1px solid #33404b; border-radius: 8px;
  padding: 0.6rem 0.9rem; margin-bottom: 0.5rem; gap: 0.6rem;
}
.list-row .actions { display: flex; gap: 0.4rem; }
```

- [ ] **Step 8: Installieren und Build prüfen**

Run: `npm install` (im Root, erzeugt `package-lock.json`), dann `npm run build -w client`
Expected: tsc ohne Fehler, `vite build` erzeugt `client/dist/index.html`. (Hinweis: `CollectionPage`/`ListsPage`/`MovieDetailModal` werden erst in Task 9–11 erstellt – für den Build lege in Task 9 Schritt 4 einen Stub an; alternativ Task 8 erst nach Task 9–11 ausführen. Reihenfolge im Plan bleibt, der Stub kommt in Task 9.)

- [ ] **Step 9: Manueller Browser-Check (Auth-Fluss)**

1. Server: `TMDB_API_KEY=<key> npm run dev -w server` (Terminal 1)
2. Client: `npm run dev -w client` (Terminal 2, Port 5173, Proxy auf 3000)
3. Browser: `http://localhost:5173` → Login-Seite zeigt „Ersten Nutzer anlegen (wird Admin)".
4. Nutzer anlegen → Weiterleitung auf `/` mit Header (Sammlung/Listen/Nutzer anlegen/Abmelden).
5. „Abmelden" → zurück auf Login (zeigt jetzt „Anmelden"), erneut anmelden.
6. Als Admin „Nutzer anlegen" → zweiten Nutzer anlegen; abmelden; als zweiter Nutzer anmelden → kein „Nutzer anlegen"-Button.

- [ ] **Step 10: Commit**

```bash
git add client
git commit -m "feat: Frontend-Gerüst mit Auth-Fluss, Routing und Styling"
```

---

### Task 9: Frontend – Sammlung, Suche & Filter

**Files:**
- Create: `client/src/pages/CollectionPage.tsx`
- Create: `client/src/components/MovieCard.tsx`
- Create: `client/src/components/SearchModal.tsx`
- Create: `client/src/components/MovieDetailModal.tsx` (vorläufiger Stub, in Task 10 ersetzt)

**Interfaces:**
- Consumes: `api.collection`, `api.search`, `api.addToCollection`, `Movie`/`SearchResult` (Task 8)
- Produces: Sammlungsseite mit Filterleiste (Text, Genre, Medientyp, Status, Sortierung), Poster-Grid, Such-Modal (TMDB-Suche + „Hinzufügen"), Detail-Modal-Öffner.

**Verifikation:** `npm run build -w client` + manueller Browser-Check.

- [ ] **Step 1: `client/src/components/MovieCard.tsx` implementieren**

```tsx
import type { Movie } from "../api";

export default function MovieCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  return (
    <button className="card" onClick={onClick} aria-label={movie.titel}>
      {movie.poster_url ? (
        <img src={movie.poster_url} alt={movie.titel} loading="lazy" />
      ) : (
        <div className="no-poster">{movie.titel}</div>
      )}
      <div className="card-info">
        <h3>{movie.titel} {movie.jahr ? `(${movie.jahr})` : ""}</h3>
        <div className="meta">
          <span>{movie.medientyp === "film" ? "Film" : "Serie"}</span>
          <span aria-label="Durchschnittsbewertung">★ {movie.avg_rating ?? "–"} ({movie.rating_count})</span>
          {movie.my_status && <span className="status-badge">{movie.my_status}</span>}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: `client/src/components/SearchModal.tsx` implementieren**

```tsx
import { useState, type FormEvent } from "react";
import { api, type SearchResult } from "../api";

export default function SearchModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults((await api.search(q.trim())).results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suche fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function add(r: SearchResult) {
    setError("");
    try {
      await api.addToCollection(r.tmdb_id, r.medientyp);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hinzufügen fehlgeschlagen");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Film suchen</h2>
        <form onSubmit={onSubmit}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titel bei TMDB suchen…" autoFocus />
          <button type="submit" disabled={busy}>{busy ? "Suche…" : "Suchen"}</button>
        </form>
        {error && <p className="error">{error}</p>}
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.medientyp}-${r.tmdb_id}`}>
              {r.poster_url && <img src={r.poster_url} alt="" />}
              <div>
                <strong>{r.titel}</strong> {r.jahr ? `(${r.jahr})` : ""} – {r.medientyp === "film" ? "Film" : "Serie"}
              </div>
              <button onClick={() => add(r)}>Hinzufügen</button>
            </li>
          ))}
        </ul>
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `client/src/pages/CollectionPage.tsx` implementieren**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type Movie } from "../api";
import MovieCard from "../components/MovieCard";
import SearchModal from "../components/SearchModal";
import MovieDetailModal from "../components/MovieDetailModal";

export default function CollectionPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [medientyp, setMedientyp] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("zuletzt_hinzugefuegt");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<Movie | null>(null);

  const load = useCallback(async () => {
    const filters: Record<string, string> = { sort };
    if (q) filters.q = q;
    if (genre) filters.genre = genre;
    if (medientyp) filters.medientyp = medientyp;
    if (status) filters.status = status;
    setMovies(await api.collection(filters));
  }, [q, genre, medientyp, status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const genres = [...new Set(movies.flatMap((m) => m.genres))].sort();

  return (
    <main className="page">
      <div className="filterbar">
        <input placeholder="Titel suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">Alle Genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select value={medientyp} onChange={(e) => setMedientyp(e.target.value)}>
          <option value="">Filme & Serien</option>
          <option value="film">Filme</option>
          <option value="serie">Serien</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Jeder Status</option>
          <option value="schauen">Schauen</option>
          <option value="gesehen">Gesehen</option>
          <option value="kein_interesse">Kein Interesse</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="zuletzt_hinzugefuegt">Zuletzt hinzugefügt</option>
          <option value="titel">Titel A–Z</option>
          <option value="jahr">Neueste zuerst</option>
          <option value="bewertung">Beste Bewertung</option>
        </select>
        <button className="primary" onClick={() => setSearchOpen(true)}>+ Film suchen</button>
      </div>

      {movies.length === 0 ? (
        <p className="empty">Noch keine Filme. Klick auf „+ Film suchen“.</p>
      ) : (
        <div className="grid">
          {movies.map((m) => (
            <MovieCard key={m.tmdb_id} movie={m} onClick={() => setDetail(m)} />
          ))}
        </div>
      )}

      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onAdded={() => void load()} />}
      {detail && <MovieDetailModal movie={detail} onClose={() => setDetail(null)} onChanged={() => void load()} />}
    </main>
  );
}
```

- [ ] **Step 4: Stub `client/src/components/MovieDetailModal.tsx` anlegen**

```tsx
import type { Movie } from "../api";

export default function MovieDetailModal({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{movie.titel}</h2>
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
```

(Der Stub wird in Task 10 vollständig ersetzt. Damit kompiliert auch Task 8/9 ohne die restlichen Seiten – `ListsPage` wird von `App.tsx` importiert, daher in Task 11 erstellt; bis dahin `npm run build` mit vorübergehendem `client/src/pages/ListsPage.tsx`-Stub in Task 11 bzw. Import prüfen.)

- [ ] **Step 5: Build prüfen**

Run: `npm run build -w client`
Expected: tsc und vite grün (bis auf eventuell fehlende `ListsPage` – sofern nötig, vorübergehend minimale `ListsPage`-Datei anlegen, die Task 11 ersetzt).

- [ ] **Step 6: Manueller Browser-Check (Sammlung)**

1. Beide Dev-Server laufen lassen (siehe Task 8).
2. Anmelden → Sammlung leer („Noch keine Filme…").
3. „+ Film suchen" → „Inception" suchen → Treffer → „Hinzufügen" → Sammlung lädt neu, Karte erscheint.
4. Zweiten Film hinzufügen, dann Filter: Genre, Medientyp „Serie", Textsuche, Sortierung – Liste reagiert sofort.
5. Karte klicken → Detail-Modal (Stub) öffnet und schließt.

- [ ] **Step 7: Commit**

```bash
git add client/src
git commit -m "feat: Sammlungsseite mit Suche, Filtern und Poster-Grid"
```

---

### Task 10: Frontend – Filmdetails (Bewertung, Status, Notiz, Listen)

**Files:**
- Modify: `client/src/components/MovieDetailModal.tsx` (Stub aus Task 9 ersetzen)

**Interfaces:**
- Consumes: `api.setRating`, `api.setWatchStatus`, `api.setNote`, `api.deleteNote`, `api.lists`, `api.addToList`, `api.removeFromList`, `Movie` (Task 8)
- Produces: Vollständiges Detail-Modal mit 1–5-Sterne-Bewertung, Status-Buttons, Notiz (speichern/leeren), Listen-Checkboxen.

**Verifikation:** `npm run build -w client` + manueller Browser-Check.

- [ ] **Step 1: `client/src/components/MovieDetailModal.tsx` implementieren (ersetzt Stub)**

```tsx
import { useEffect, useState } from "react";
import { api, type ListSummary, type Movie } from "../api";

const STATUS_OPTIONS: Array<["schauen" | "gesehen" | "kein_interesse", string]> = [
  ["schauen", "Schauen"],
  ["gesehen", "Gesehen"],
  ["kein_interesse", "Kein Interesse"],
];

export default function MovieDetailModal({ movie, onClose, onChanged }: { movie: Movie; onClose: () => void; onChanged: () => void }) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [inLists, setInLists] = useState<Set<number>>(new Set(movie.my_list_ids));
  const [note, setNote] = useState(movie.my_note ?? "");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api.lists().then(setLists).catch(() => {});
  }, []);

  async function change(action: () => Promise<void>, okText: string) {
    setSaved("");
    try {
      await action();
      setSaved(okText);
      onChanged();
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Fehler");
    }
  }

  async function toggleList(listId: number) {
    const next = new Set(inLists);
    if (next.has(listId)) {
      next.delete(listId);
      await change(() => api.removeFromList(listId, movie.tmdb_id), "Aus Liste entfernt.");
    } else {
      next.add(listId);
      await change(() => api.addToList(listId, movie.tmdb_id), "Zur Liste hinzugefügt.");
    }
    setInLists(next);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal movie-detail" onClick={(e) => e.stopPropagation()}>
        <h2>{movie.titel} {movie.jahr ? `(${movie.jahr})` : ""}</h2>
        {movie.overview && <p className="overview">{movie.overview}</p>}
        <p className="genres">{movie.genres.join(", ")}</p>
        <p>Durchschnitt: ★ {movie.avg_rating ?? "–"} ({movie.rating_count} Bewertungen)</p>

        <div className="rating">
          <span>Meine Bewertung:</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={movie.my_rating === n ? "star active" : "star"}
              onClick={() => change(() => api.setRating(movie.tmdb_id, n), "Bewertung gespeichert.")}
              aria-label={`${n} Sterne`}
            >
              ★
            </button>
          ))}
        </div>

        <div className="status">
          <span>Status:</span>
          {STATUS_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              className={movie.my_status === value ? "active" : ""}
              onClick={() => change(() => api.setWatchStatus(movie.tmdb_id, value), "Status gespeichert.")}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz…" />
          <button onClick={() => change(() => api.setNote(movie.tmdb_id, note), "Notiz gespeichert.")}>Notiz speichern</button>
          {movie.my_note && <button onClick={() => change(() => api.deleteNote(movie.tmdb_id), "Notiz gelöscht.")}>Notiz löschen</button>}
        </div>

        <div className="lists">
          <span>In meinen Listen:</span>
          {lists.map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={inLists.has(l.id)} onChange={() => void toggleList(l.id)} /> {l.name}
            </label>
          ))}
          {lists.length === 0 && <span className="muted">Noch keine Listen – unter „Listen“ anlegen.</span>}
        </div>

        {saved && <p className={saved.startsWith("Fehler") ? "error" : "ok"}>{saved}</p>}
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build prüfen**

Run: `npm run build -w client`
Expected: tsc und vite grün.

- [ ] **Step 3: Manueller Browser-Check (Details)**

1. Anmelden, Film öffnen → 5 Sterne anklicken → „Bewertung gespeichert." erscheint; Karte zeigt neuen Durchschnitt.
2. Status „Gesehen" setzen → Badge auf der Karte.
3. Notiz schreiben + speichern; erneut öffnen → Notiz steht im Textfeld; „Notiz löschen" funktioniert.
4. Listen-Checkboxen: erst nach Task 11 prüfen (Liste muss existieren).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MovieDetailModal.tsx
git commit -m "feat: Filmdetails mit Bewertung, Status, Notiz und Listen-Auswahl"
```

---

### Task 11: Frontend – Listen-Seite

**Files:**
- Create: `client/src/pages/ListsPage.tsx` (ersetzt ggf. vorübergehenden Stub)
- Modify: `client/src/styles.css` (`.list-name`-Regel anhängen)

**Interfaces:**
- Consumes: `api.lists`, `api.createList`, `api.renameList`, `api.deleteList`, `api.listItems`, `api.removeFromList`, `ListSummary`, `Movie` (Task 8)
- Produces: „Listen": anlegen/umbenennen/löschen, Liste aufklappen mit Items und Entfernen-Button.

**Verifikation:** `npm run build -w client` + manueller Browser-Check.

- [ ] **Step 1: `client/src/pages/ListsPage.tsx` implementieren**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { api, type ListSummary, type Movie } from "../api";

export default function ListsPage() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [openList, setOpenList] = useState<number | null>(null);
  const [items, setItems] = useState<Movie[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLists(await api.lists());
  }

  useEffect(() => {
    void load();
  }, []);

  async function open(id: number) {
    if (openList === id) {
      setOpenList(null);
      return;
    }
    setOpenList(id);
    setItems((await api.listItems(id)).items);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createList(newName);
      setNewName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  async function rename(list: ListSummary) {
    const name = window.prompt("Neuer Name:", list.name);
    if (!name || name.trim() === "") return;
    await api.renameList(list.id, name.trim());
    await load();
  }

  async function remove(list: ListSummary) {
    if (!window.confirm(`Liste „${list.name}“ löschen?`)) return;
    await api.deleteList(list.id);
    if (openList === list.id) setOpenList(null);
    await load();
  }

  async function removeItem(tmdbId: number) {
    if (!openList) return;
    await api.removeFromList(openList, tmdbId);
    setItems((await api.listItems(openList)).items);
  }

  return (
    <main className="page">
      <h2>Meine Listen</h2>
      <form onSubmit={create} className="filterbar">
        <input placeholder="Neue Liste…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="primary">Liste anlegen</button>
      </form>
      {error && <p className="error">{error}</p>}

      {lists.length === 0 && <p className="empty">Noch keine Listen angelegt.</p>}

      {lists.map((l) => (
        <div key={l.id}>
          <div className="list-row">
            <button className="list-name" onClick={() => void open(l.id)}>
              {l.name} ({l.item_count})
            </button>
            <div className="actions">
              <button onClick={() => void rename(l)}>Umbenennen</button>
              <button onClick={() => void remove(l)}>Löschen</button>
            </div>
          </div>
          {openList === l.id && (
            <div className="grid">
              {items.map((m) => (
                <div key={m.tmdb_id} className="card">
                  {m.poster_url ? (
                    <img src={m.poster_url} alt={m.titel} loading="lazy" />
                  ) : (
                    <div className="no-poster">{m.titel}</div>
                  )}
                  <div className="card-info">
                    <h3>{m.titel} {m.jahr ? `(${m.jahr})` : ""}</h3>
                    <button onClick={() => void removeItem(m.tmdb_id)}>Entfernen</button>
                  </div>
                </div>
              ))}
              {items.length === 0 && <p className="empty">Liste ist leer – Film im Detail-Modal hinzufügen.</p>}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
```

CSS-Ergänzung in `client/src/styles.css` (ans Ende anhängen):
```css
.list-name { border: none; background: none; font-size: 1.05rem; padding: 0; }
.list-name:hover { color: var(--accent); }
```

- [ ] **Step 2: Build prüfen**

Run: `npm run build -w client`
Expected: tsc und vite grün.

- [ ] **Step 3: Manueller Browser-Check (Listen)**

1. „Listen" → Liste „Science Fiction Abend" anlegen.
2. Sammlung → Film öffnen → „In meinen Listen" → Checkbox setzen.
3. „Listen" → Liste aufklappen → Film sichtbar; „Entfernen"; „Umbenennen"; „Löschen" (mit Bestätigung).

- [ ] **Step 4: Commit**

```bash
git add client/src
git commit -m "feat: Listen-Seite mit CRUD und Item-Verwaltung"
```

---

### Task 12: Docker & Deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `README.md`

**Interfaces:**
- Consumes: Build-Artefakte `server/dist`, `client/dist` (Tasks 7/8)
- Produces: Image `filmdatenbank` (Multi-Stage), Compose-Service mit Volume `fdb-data`, Port 3000.

- [ ] **Step 1: `Dockerfile` anlegen**

```dockerfile
# ---- Build-Stufe ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime-Stufe ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
ENV DB_PATH=/data/filmdatenbank.db
ENV PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
```

(Hinweis: `better-sqlite3` liefert Prebuilds für linux x64/arm64 – `npm ci` in der Runtime-Stufe braucht dann keinen Compiler. Falls auf einer exotischen Plattform die Prebuilds fehlen: Basis-Image auf `node:20-bookworm-slim` wechseln und `RUN apt-get update && apt-get install -y python3 make g++` vor `npm ci` einfügen.)

- [ ] **Step 2: `docker-compose.yml` anlegen**

```yaml
services:
  filmdatenbank:
    build: .
    container_name: filmdatenbank
    ports:
      - "3000:3000"
    environment:
      - TMDB_API_KEY=${TMDB_API_KEY}
    volumes:
      - fdb-data:/data
    restart: unless-stopped

volumes:
  fdb-data:
```

- [ ] **Step 3: `.env.example` anlegen**

```
# Kostenloser API-Key von https://www.themoviedb.org/settings/api
TMDB_API_KEY=dein_key_hier
```

- [ ] **Step 4: `README.md` anlegen**

```markdown
# Filmdatenbank

Gemeinsame Filmdatenbank für Familie und Freunde: kuratierte Sammlung (TMDB-Suche),
Bewertungen, Watch-Status, Notizen, Suche & Filter und persönliche Listen.
Läuft als Docker-Container im Heimnetz.

## Voraussetzungen

- Docker + Docker Compose
- Kostenloser TMDB-API-Key: <https://www.themoviedb.org/settings/api> (anmelden, Key anfordern)

## Setup

```bash
cp .env.example .env
# TMDB_API_KEY in .env eintragen
docker compose up -d --build
```

Die App ist danach unter `http://<heimnetz-ip>:3000` erreichbar.

## Erster Start

Beim ersten Aufruf wird der **erste Nutzer zum Admin** („Einrichtung starten").
Weitere Nutzer legt der Admin über „Nutzer anlegen" an.

## Entwicklung

```bash
npm install
TMDB_API_KEY=<key> npm run dev -w server   # Terminal 1
npm run dev -w client                       # Terminal 2
# Client: http://localhost:5173 (Proxy auf :3000)
```

## Tests

```bash
npm test            # Backend (Vitest + supertest)
# E2E-Smoke-Test: e2e/ Verzeichnis, Ausführung siehe Implementierungsplan Task 13
```

## Daten & Backup

Die Datenbank liegt im Docker-Volume `fdb-data` (`/data/filmdatenbank.db`).
Backup: `docker compose cp filmdatenbank:/data/filmdatenbank.db ./backup.db`
```

- [ ] **Step 5: Bild bauen und Container starten**

Run: `docker compose up -d --build`
Expected: Build läuft durch; `docker compose ps` zeigt `filmdatenbank` als `Up`.

- [ ] **Step 6: Smoke-Test gegen den Container**

Run: `curl -s http://localhost:3000/api/auth/status`
Expected: `{"needsBootstrap":true}` (frische DB). Danach `curl -s -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" -d '{"name":"Admin","password":"geheim123"}'` → 201 mit `is_admin: 1`.

Browser: `http://localhost:3000` → Login-Seite erscheint (Statik wird ausgeliefert).

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example README.md
git commit -m "feat: Docker-Deployment mit Compose, Env-Template und README"
```

---

### Task 13: End-to-End-Smoke-Test (Playwright)

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: laufender Container (Task 12) oder Dev-Server (Task 8–11) mit frischer DB und echtem TMDB-Key
- Produces: Ein Smoke-Test: Bootstrap → Suche „Inception" → Hinzufügen → Bewerten (5 Sterne) → Status „Gesehen" → Abmelden.

- [ ] **Step 1: `e2e/package.json` anlegen**

```json
{
  "name": "e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  }
}
```

- [ ] **Step 2: `e2e/playwright.config.ts` anlegen**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
```

- [ ] **Step 3: `e2e/smoke.spec.ts` anlegen**

```ts
import { expect, test } from "@playwright/test";

// Voraussetzung: laufender Container mit gültigem TMDB_API_KEY.
// Bootstrap-Zweig greift nur bei frischer DB (Volume leer);
// bei vorhandener DB meldet sich der Test als Admin an.
test("Smoke: Einrichtung → Suche → Hinzufügen → Bewerten → Abmelden", async ({ page }) => {
  const name = `tester_${Date.now()}`;
  const password = "geheim123";

  await page.goto("/");

  const einrichtung = page.getByRole("button", { name: "Einrichtung starten" });
  if (await einrichtung.isVisible().catch(() => false)) {
    await page.getByPlaceholder("Name").fill(name);
    await page.getByPlaceholder("Passwort").fill(password);
    await einrichtung.click();
  } else {
    await page.getByPlaceholder("Name").fill("Admin");
    await page.getByPlaceholder("Passwort").fill("geheim123");
    await page.getByRole("button", { name: "Anmelden" }).click();
  }
  await page.waitForURL("/");

  await page.getByRole("button", { name: "+ Film suchen" }).click();
  await page.getByPlaceholder("Titel bei TMDB suchen…").fill("Inception");
  await page.getByRole("button", { name: "Suchen" }).click();

  const addButton = page.getByRole("button", { name: "Hinzufügen" }).first();
  await addButton.waitFor();
  await addButton.click();

  await page.getByRole("button", { name: "Inception" }).first().click();
  await page.getByRole("button", { name: "5 Sterne" }).click();
  await page.getByRole("button", { name: "Gesehen" }).click();
  await page.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("heading", { name: "Filmdatenbank" })).toBeVisible();
});
```

- [ ] **Step 4: Browser installieren und Test ausführen**

Run:
```bash
cd e2e
npm install
npx playwright install chromium
BASE_URL=http://localhost:3000 npx playwright test
```
(Der Container aus Task 12 muss laufen; bei nicht-frischer DB `docker compose down -v && docker compose up -d`.)

Expected: PASS – 1 Test grün.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test: Playwright-Smoke-Test für den Hauptfluss"
```

---

## Self-Review

**1. Spec coverage:**
- Gemeinsame Sammlung → Task 4, 9 ✓
- TMDB-Suche mit Cache → Task 3 ✓
- Bewertungen (1–5, Durchschnitt) → Task 5, 10 ✓
- Watch-Status → Task 5, 10 ✓
- Notizen → Task 5, 10 ✓
- Suche & Filter (Text/Genre/Medientyp/Status/Sortierung) → Task 4, 9 ✓
- Persönliche Listen → Task 6, 11 ✓
- Login mit Passwort, erster Nutzer = Admin → Task 2, 8 ✓
- Session 30 Tage, HttpOnly, SameSite=Lax → Task 2 (sessions.ts) ✓
- TMDB_API_KEY Pflicht → Task 7 (index.ts), Task 12 (.env.example) ✓
- Docker-Container im Heimnetz, Volume, Port 3000 → Task 12 ✓
- Fehlerbehandlung: TMDB offline (502), Rate-Limit-Backoff (Task 3), UPSERTs (Task 5), JSON-Fehler (Task 7) ✓
- Testing: Backend (Tasks 1–7), E2E-Smoke (Task 13), manuelle Abnahme (Tasks 8–12) ✓
- UI deutsch → alle Frontend-Tasks ✓

**2. Placeholder scan:** Keine „TBD"/„TODO"; alle Steps enthalten vollständigen Code. Einzige bewusste Ausnahme: Task 9 Step 4 nutzt einen explizit als vorläufig markierten Detail-Modal-Stub, der in Task 10 ersetzt wird (im Step dokumentiert).

**3. Type consistency:**
- `TmdbMovie` (Task 3) wird von `collectionRoutes` (Task 4) und Tests konsistent genutzt ✓
- `MovieView`/`listMovieViews` (Task 4) von `collectionRoutes` (Task 4) und `listRoutes` (Task 6) identisch importiert ✓
- `api.ts`-Signaturen (Task 8) stimmen mit den Backend-Routen überein (Endpoint, Body, Statuscodes) ✓
- `Movie` erbt `SearchResult`; `MovieDetailModal` (Task 10) nutzt `movie.my_list_ids` – im Backend-SELECT (Task 4) enthalten ✓
- Statuswerte `'schauen'|'gesehen'|'kein_interesse'` durchgängig in DB-Check, Router-Validierung, `api.ts`, `MovieView` und UI-Optionen identisch ✓

