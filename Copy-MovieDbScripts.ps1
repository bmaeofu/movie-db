# Kopiert die Unraid-User-Scripts nach \\192.168.178.75\appdata\movie-db
# (= /mnt/user/appdata/movie-db auf unRAID).
# Aufruf z. B. manuell oder über den Watch-MovieDbScripts.ps1-Watcher.

$ErrorActionPreference = "Stop"

$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$target  = "\\192.168.178.75\appdata\movie-db"
$files   = @(
    "Kodi_movie-db_sync.py",
    "Kodi_movie-db_enrich.py"
)

if (-not (Test-Path $target)) {
    Write-Error "SMB-Ziel nicht erreichbar: $target"
    exit 1
}

foreach ($f in $files) {
    $src = Join-Path $repoDir $f
    if (-not (Test-Path $src)) {
        Write-Warning "Nicht gefunden, uebersprungen: $src"
        continue
    }
    Copy-Item -Path $src -Destination $target -Force
    Write-Host ("Kopiert: {0} -> {1}" -f $f, $target)
}

Write-Host "Fertig."
