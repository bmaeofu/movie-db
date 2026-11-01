# Filmdatenbank

Gemeinsame Filmdatenbank für Familie und Freunde: kuratierte Sammlung (TMDB-Suche),
Bewertungen, Watch-Status, Notizen, Suche & Filter und persönliche Listen.
Läuft als Docker-Container im Heimnetz.

## Voraussetzungen

- Docker + Docker Compose
- Kostenloser TMDB-API-Key: <https://www.themoviedb.org/settings/api> (anmelden, Key anfordern)

## Setup (unRAID mit Komodo, empfohlen)

1. Repo auf den unRAID-Server übertragen oder direkt dort klonen.
2. In Komodo einen neuen **Compose-Stack** anlegen, der auf die `compose.yaml` dieses Repos zeigt (Komodos Standard-Dateiname).
3. Unter den Stack-Einstellungen die Env-Variable `TMDB_API_KEY` mit deinem Key setzen (Komodo-Einstellung „Environment“) – kein `.env`-File nötig. Der Key bleibt damit auf dem Server.
4. Stack starten (Komodo baut das Image und startet den Container).

Die App ist danach unter `http://<unraid-ip>:8080` erreichbar (Host-Port 8080 → Container-Port 3000; Port 3000 ist am Host oft von Grafana belegt, daher der Ausweich-Port).

## Setup (alternativ, ohne Komodo)

```bash
cp .env.example .env
# TMDB_API_KEY in .env eintragen
docker compose up -d --build
```

## Erster Start

Beim ersten Aufruf wird der **erste Nutzer zum Admin** („Einrichtung starten").
Weitere Nutzer legt der Admin über „Nutzer anlegen" an.

## Entwicklung

```bash
npm install
# Windows PowerShell:
$env:TMDB_API_KEY="<key>"; npm run dev -w server   # Terminal 1
# Git Bash / Linux:
# TMDB_API_KEY=<key> npm run dev -w server
npm run dev -w client                               # Terminal 2
# Client: http://localhost:5173 (Proxy auf :3000)
```

## E2E-Smoke-Test

Der Playwright-Smoke (`e2e/`) braucht einen laufenden Server MIT echtem TMDB-Key (der Test durchsucht TMDB nach „Inception“):

```bash
cd e2e
npm install
npx playwright install chromium
BASE_URL=http://<server-ip>:8080 npx playwright test
```

Voraussetzung: frische Datenbank (Volume leeren oder neuen Stack mit frischem Volume starten).

## Wiedergabe (Play-Button)

Im Film-Detail gibt es einen **Abspielen**-Button. Er startet den Film im lokalen
Player, sofern die Datei in der Mediathek liegt.

**Serverseitig**

- Die Pfade stehen in `movies.datei_pfade` (JSON-Array von `/media/…`-Pfaden) und
  werden vom Kodi-Sync gefüllt — auch für Filme, die schon in der Sammlung liegen.
  Fehlt der Pfad (Altbestand), fragt `GET /api/movies/:tmdbId/play` die Kodi-DB live ab.
- Die Ziele (Template + `path_map`) stehen in `server/src/playback.ts`:

  ```ts
  desktop: "dvbplay://{{path}}"                        // /media → 192.168.178.75/media/tv
  android: "intent://{{path}}#Intent;scheme=smb;package=org.videolan.vlc;end"
  ```

  Die Wurzel ist `media/tv`, weil der Container `/mnt/user/media/tv` als `/media`
  einbindet — die App-Pfade enthalten also kein `tv`.
- Das Ziel wird im Browser über den User-Agent gewählt (Android → `android`, sonst
  `desktop`). Bei mehreren Dateien (Mehrteiler) erscheint zusätzlich eine Dateiauswahl.

**Clientseitig (je Arbeitsplatz)**

Damit der Browser `dvbplay://` weiterreicht, muss das Protokoll registriert sein:

1. `tools/dvbplay-launcher.cs` zu `%LOCALAPPDATA%\dvbplay\DvbPlay.exe` kompilieren
   (fensterlos, startet MPC-HC, schreibt `%LOCALAPPDATA%\dvbplay\dvbplay.log`).
2. Protokoll registrieren (Benutzer-Registry, kein Admin):

   ```powershell
   reg add "HKCU\Software\Classes\dvbplay" /ve /d "URL:DVBPlay" /f
   reg add "HKCU\Software\Classes\dvbplay" /v "URL Protocol" /d "" /f
   reg add "HKCU\Software\Classes\dvbplay\shell\open\command" /ve /d '"%LOCALAPPDATA%\dvbplay\DvbPlay.exe" "%1"' /f
   ```

3. Chrome/Edge: ohne Richtlinie fragt der Browser jedes Mal nach. Einmalig als
   Administrator `AutoLaunchProtocolsFromOrigins` setzen — Details und fertige
   Skripte in [`tools/browser-policy.md`](tools/browser-policy.md) und
   [`tools/register-browser-policy.ps1`](tools/register-browser-policy.ps1).
   Jede Origin (Schema + Host + Port) muss exakt aufgeführt sein.

**Diagnose**

| Symptom | Ursache / Prüfung |
|---|---|
| Nichts passiert, kein Log-Eintrag | Browser hat die URL verworfen → Origin in der Richtlinie, `chrome://policy` prüfen |
| Log: „Datei nicht erreichbar“ | Pfad falsch abgebildet (fehlt `tv`?) oder Share nicht erreichbar |
| Jedes Mal ein Dialog | `AutoLaunchProtocolsFromOrigins` fehlt oder Origin weicht ab (z. B. `ums` statt IP) |
| Dialog nennt „Windows PowerShell“ | Handler zeigt noch auf `powershell.exe` statt `DvbPlay.exe` |

## Daten & Backup

Die Datenbank liegt als Datei unter `/mnt/user/appdata/movie-db/filmdatenbank.db` (Bind-Mount auf `/data` im Container) – direkt im unRAID-appdata-Share sichtbar.
Backup: Datei einfach kopieren (`appdata/movie-db/filmdatenbank.db`) oder im laufenden Container:
`docker compose cp movie-db:/data/filmdatenbank.db ./backup.db`

Für eine frische Datenbank: Container stoppen, `appdata/movie-db/filmdatenbank.db*` löschen, wieder starten.
