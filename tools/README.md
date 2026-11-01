# dvbplay: Playback handler for the "Abspielen" button

The web app opens `dvbplay://<path>` for the `desktop` playback target. Windows only
hands that URL to an application if the `dvbplay` scheme is registered. This folder
contains the handler used on the workstation.

## What it does

`dvbplay.ps1` receives the URL, strips `dvbplay://`, URL-decodes it (`%20` → space),
normalizes separators, checks the file, and starts MPC-HC with the media file.
It writes `%LOCALAPPDATA%\dvbplay\dvbplay.log` so failures are diagnosable.

## Installation (per user, no admin rights)

```powershell
# 1) copy the script
$ziel = Join-Path $env:LOCALAPPDATA 'dvbplay'
New-Item -ItemType Directory -Force -Path $ziel | Out-Null
Copy-Item .\tools\dvbplay.ps1 $ziel

# 2) register the scheme
$cmd = '"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
       (Join-Path $ziel 'dvbplay.ps1') + '" "%1"'
New-Item -Path 'HKCU:\Software\Classes\dvbplay' -Force | Out-Null
New-ItemProperty -Path 'HKCU:\Software\Classes\dvbplay' -Name '(Default)' -Value 'URL:DVBPlay' -Force | Out-Null
New-ItemProperty -Path 'HKCU:\Software\Classes\dvbplay' -Name 'URL Protocol' -Value '' -Force | Out-Null
New-Item -Path 'HKCU:\Software\Classes\dvbplay\shell\open\command' -Force | Out-Null
New-ItemProperty -Path 'HKCU:\Software\Classes\dvbplay\shell\open\command' -Name '(Default)' -Value $cmd -Force | Out-Null
```

## Test

```powershell
# the app emits the URI form (host/path, forward slashes)
Start-Process 'dvbplay://192.168.178.75/media/tv/FilmeHD/FilmeHD3/Aelita.mkv'
Get-Content (Join-Path $env:LOCALAPPDATA 'dvbplay\dvbplay.log')
```

The handler accepts both forms: `dvbplay://host/path` (URI, used by the app) and
`dvbplay://\\host\path` (raw UNC).

## Notes

- Player: `C:\Program Files\MPC-HC\mpc-hc64.exe`. Change the `$player` variable in the
  script if another player is used.
- The path root is `\\192.168.178.75\media\tv` because the container mounts
  `/mnt/user/media/tv` at `/media`; the app's `/media/…` paths therefore omit `tv`.
