# Überwacht Kodi_movie-db_*.py im Repo und ruft Copy-MovieDbScripts.ps1
# bei jeder Änderung automatisch auf.
# Beenden mit Strg+C.

$ErrorActionPreference = "Stop"

$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$copyScript = Join-Path $repoDir "Copy-MovieDbScripts.ps1"

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $repoDir
$watcher.Filter = "Kodi_movie-db_*.py"
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
$watcher.EnableRaisingEvents = $true

$action = {
    # $copyScript und $watcher aus dem äußeren Scope übernehmen
    Start-Sleep -Milliseconds 200   # entprellt mehrere Write-Events
    Write-Host ("Aenderung erkannt: {0} -> Kopiere..." -f $Event.SourceEventArgs.Name)
    & $copyScript
}

Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $action > $null
Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $action > $null
Register-ObjectEvent -InputObject $watcher -EventName Created  -Action $action > $null

Write-Host "Ueberwache $repoDir auf Aenderungen an Kodi_movie-db_*.py ..."
Write-Host "Beenden mit Strg+C."

while ($true) { Start-Sleep -Seconds 1 }
