# Chrome/Edge: dvbplay ohne Rückfrage starten

Der „Abspielen“-Button öffnet `dvbplay://…`. Chrome fragt beim ersten Mal
„Externes Protokoll öffnen?“ und merkt sich die Antwort **nicht** mehr — die
frühere „Immer erlauben“-Checkbox wurde entfernt. Ohne Rückfrage geht es nur
über die Richtlinie `AutoLaunchProtocolsFromOrigins`.

## Voraussetzung

Administratorrechte. Der Zweig `HKCU\Software\Policies\Google\Chrome` ist für
normale Benutzer nur lesbar (ACL: `Administratoren` = FullControl).

## Einmalig ausführen

PowerShell als Administrator:

```powershell
.\tools\register-browser-policy.ps1
```

Das Script schreibt die Richtlinie für Chrome und Edge (HKLM) und gibt den
gesetzten Wert aus. Origin anpassen, falls die App unter einer anderen Adresse
läuft (`$Origin` im Script).

> **Nicht `reg add` verwenden.** `reg add … /d $json` entfernt die
> Anführungszeichen, sodass `[{protocol:dvbplay,…}]` gespeichert wird — kein
> gültiges JSON, Chrome verwirft die Richtlinie. `Set-ItemProperty` (und das
> Script) erhalten den String unverändert.

Manuell, falls das Script nicht verwendet wird:

```powershell
# Die Origin muss exakt passen: Schema + Host + Port.
# Die NAS ist als 192.168.178.75 und als ums (Tailscale) erreichbar — beide eintragen.
$json = '[{"protocol":"dvbplay","allowed_origins":["http://192.168.178.75:11000","http://ums:11000"]}]'
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' -Name AutoLaunchProtocolsFromOrigins -Value $json -Type String
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' -Name AutoLaunchProtocolsFromOrigins -Value $json -Type String
```

## Danach

1. Chrome vollständig beenden (alle Fenster, auch Hintergrundprozesse).
2. Chrome neu starten.
3. `chrome://policy` prüfen: `AutoLaunchProtocolsFromOrigins` muss als **OK** stehen.
4. „Abspielen“ drücken — der Player startet ohne Dialog.

## Rückgängig machen

```powershell
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v AutoLaunchProtocolsFromOrigins /f
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v AutoLaunchProtocolsFromOrigins /f
```

## Anzeigename im Dialog

Chrome nennt im Dialog die ausführbare Datei des Handlers. Ohne eigenen Launcher
steht dort „Windows PowerShell“. `tools/dvbplay-launcher.cs` wird zu
`%LOCALAPPDATA%\dvbplay\DvbPlay.exe` kompiliert (Add-Type oder csc) und im
`dvbplay`-Protokoll als Befehl eingetragen — dann heißt es „DvbPlay“ und es blitzt
kein Konsolenfenster auf.
