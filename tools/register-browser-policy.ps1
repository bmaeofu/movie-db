# Registriert die Browser-Richtlinie, damit dvbplay:// ohne Rückfrage startet.
# Als Administrator ausführen:  powershell -ExecutionPolicy Bypass -File tools\register-browser-policy.ps1

param([string]$Origin = 'http://192.168.178.75:11000')

$fehler = @()

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Bitte als Administrator ausführen (Rechtsklick → Als Administrator ausführen).'
  exit 1
}

$json = '[{"protocol":"dvbplay","allowed_origins":["' + $Origin + '"]}]'

foreach ($zweig in @(
  'HKLM:\SOFTWARE\Policies\Google\Chrome',
  'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
)) {
  try {
    New-Item -Path $zweig -Force | Out-Null
    New-ItemProperty -Path $zweig -Name 'AutoLaunchProtocolsFromOrigins' -Value $json -PropertyType String -Force | Out-Null
    Write-Output "gesetzt: $zweig"
  } catch {
    $fehler += "$zweig : $($_.Exception.Message)"
  }
}

Write-Output "Wert: $json"

if ($fehler.Count -gt 0) {
  Write-Output 'Fehler:'
  $fehler | ForEach-Object { Write-Output "  $_" }
  exit 2
}

Write-Output ''
Write-Output 'Fertig. Chrome/Edge vollständig beenden und neu starten, dann chrome://policy prüfen.'
