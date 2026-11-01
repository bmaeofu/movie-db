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
