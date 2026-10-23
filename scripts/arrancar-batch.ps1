# Levanta el batch de offsets DESPRENDIDO de OpenCode (procesos de Windows
# normales, con logs dentro del proyecto), para que un reinicio del harness
# o un cierre de la terminal no mate el trabajo.
#
# Uso (tambien lo hace la tarea "uBeatBatch"):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\arrancar-batch.ps1
#
# Es idempotente: no duplica el servidor ni un worker que ya este corriendo.
# Tras un reboot de la maquina, vuelve a lanzar con:  schtasks /run /tn uBeatBatch
$ErrorActionPreference = "SilentlyContinue"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$logs = Join-Path $raiz "logs"
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }

# El modelo de whisper se cachea en TEMP; lo fijamos para que Task Scheduler
# no apunte a otro sitio y re-descargue el modelo.
$env:TEMP = "C:\Users\alejandro.endrizzi.e\AppData\Local\Temp"

$python = "C:\Users\alejandro.endrizzi.e\AppData\Local\Programs\Python\Python314\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

# 1) Servidor local (lo necesitan los workers para /api/lyrics y /api/artists).
$p8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if (-not $p8080) {
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $raiz `
    -RedirectStandardOutput (Join-Path $logs "servidor.log") `
    -RedirectStandardError (Join-Path $logs "servidor.err.log") `
    -WindowStyle Hidden
  Write-Output "servidor: lanzado"
} else {
  Write-Output "servidor: ya escuchando en 8080"
}

# 2) Los 4 trabajadores de ASR (uno por trozo del catalogo).
$existentes = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like "*alinear-previews*" })
foreach ($w in @("a", "b", "c", "d")) {
  $enMarcha = $existentes | Where-Object { $_.CommandLine -like "*trabajos-$w.json*" }
  # "Siguiente paso:" es la última línea del log cuando el worker TERMINÓ:
  # no lo relanzamos (reintentaría sus descartes cada 20 min y saturaría
  # LRCLIB; los pendientes reales los procesa exportar-pendientes.js).
  $logFinal = Join-Path $logs "worker-$w.log"
  $terminado = (Test-Path $logFinal) -and ((Get-Content $logFinal -Tail 1 -ErrorAction SilentlyContinue) -like "Siguiente paso*")
  if ($enMarcha) {
    Write-Output "worker ${w}: ya corria (PID $($enMarcha.ProcessId))"
    continue
  }
  if ($terminado) {
    Write-Output "worker ${w}: ya completado, no se relanza"
    continue
  }
  # El redirect de Start-Process trunca el log: conservamos el de la corrida
  # anterior para no perder el traceback si el worker muere y la tarea lo
  # relanza (ha pasado varias veces y asi se puede investigar).
  foreach ($suf in @(".err.log", ".log")) {
    $viejo = Join-Path $logs "worker-$w$suf"
    if ((Test-Path $viejo) -and (Get-Item $viejo).Length -gt 0) {
      Move-Item $viejo (Join-Path $logs "worker-$w.prev$suf") -Force
    }
  }
  Start-Process -FilePath $python `
    -ArgumentList @(
      "-u", "scripts\alinear-previews.py",
      "--archivo", "scripts\trabajos-$w.json",
      "--modelo", "tiny",
      "--salida", "scripts\workers-$w.json"
    ) `
    -WorkingDirectory $raiz `
    -RedirectStandardOutput (Join-Path $logs "worker-$w.log") `
    -RedirectStandardError (Join-Path $logs "worker-$w.err.log") `
    -WindowStyle Hidden
  Write-Output "worker ${w}: lanzado"
}

# 3) Pasada final por la cola de pendientes. La primera vez se lanzo suelta y
#    un reinicio del harness la mato a mitad; aqui sobrevive como los workers.
#    Reanuda sola (lee la salida y el fichero principal) y guarda incremental.
$pendArchivo = Join-Path $raiz "scripts\preview-pendientes.json"
$pendLog = Join-Path $logs "pendientes.log"
$pendFinal = (Test-Path $pendLog) -and ((Get-Content $pendLog -Tail 1 -ErrorAction SilentlyContinue) -like "Siguiente paso*")
$pendEnMarcha = $existentes | Where-Object { $_.CommandLine -like "*preview-pendientes*" }
if ($pendEnMarcha) {
  Write-Output "pendientes: ya corria (PID $($pendEnMarcha.ProcessId))"
} elseif ($pendFinal -or -not (Test-Path $pendArchivo)) {
  Write-Output "pendientes: ya completado, no se relanza"
} else {
  foreach ($suf in @(".err.log", ".log")) {
    $viejo = Join-Path $logs "pendientes$suf"
    if ((Test-Path $viejo) -and (Get-Item $viejo).Length -gt 0) {
      Move-Item $viejo (Join-Path $logs "pendientes.prev$suf") -Force
    }
  }
  Start-Process -FilePath $python `
    -ArgumentList @(
      "-u", "scripts\alinear-previews.py",
      "--archivo", "scripts\preview-pendientes.json",
      "--salida", "scripts\pendientes-align.json"
    ) `
    -WorkingDirectory $raiz `
    -RedirectStandardOutput $pendLog `
    -RedirectStandardError (Join-Path $logs "pendientes.err.log") `
    -WindowStyle Hidden
  Write-Output "pendientes: lanzado"
}
Write-Output "listo. Logs en $logs"
