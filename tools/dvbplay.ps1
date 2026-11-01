param([Parameter(Mandatory = $true)][string]$Url)

# dvbplay://<host>/<pfad>  →  \\<host>\<pfad>  für den Player
$log = Join-Path $env:LOCALAPPDATA 'dvbplay\dvbplay.log'
function Write-Log($text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text" | Add-Content -Path $log -Encoding utf8 }

try {
  $rest = $Url -replace '^dvbplay://', ''
  $rest = $rest.TrimEnd('/', '\')
  $rest = [System.Uri]::UnescapeDataString($rest)

  if ($rest -match '^\\\\') {
    $pfad = $rest
  } else {
    $pfad = '\\' + ($rest -replace '/', '\')
  }
  Write-Log "URL=$Url  PFAD=$pfad"

  $player = 'C:\Program Files\MPC-HC\mpc-hc64.exe'
  if (-not (Test-Path -LiteralPath $player)) { Write-Log 'FEHLER: MPC-HC nicht gefunden'; exit 1 }
  if (-not (Test-Path -LiteralPath $pfad)) { Write-Log 'FEHLER: Datei nicht erreichbar'; exit 2 }

  Start-Process -FilePath $player -ArgumentList @("`"$pfad`"")
  Write-Log 'MPC-HC gestartet'
} catch {
  Write-Log "AUSNAHME: $($_.Exception.Message)"
  exit 3
}
