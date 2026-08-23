param(
  [int]$Port = 38673
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebRoot = (Resolve-Path (Join-Path $ScriptRoot '..')).Path
$RuntimeRoot = Join-Path $env:LOCALAPPDATA 'SwoopTV'
$EngineRoot = Join-Path $RuntimeRoot 'mpv-0.41.0'
$MpvUrl = 'https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip'
$MpvSha256 = '4e197f729f5071c6772f35fffd96e0f36e3e8a044bd9479b136bb09b7c6a80ff'
$SessionToken = ([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))
$script:MpvProcess = $null
$script:MpvLastExitCode = $null
$script:MpvLastLaunch = $null
$script:MpvLogPath = Join-Path $RuntimeRoot 'mpv-latest.log'

function Write-Header([string]$Text) {
  Write-Host ''
  Write-Host ('=' * 68) -ForegroundColor DarkCyan
  Write-Host ('  ' + $Text) -ForegroundColor Cyan
  Write-Host ('=' * 68) -ForegroundColor DarkCyan
}

function Ensure-Mpv {
  New-Item -ItemType Directory -Force -Path $EngineRoot | Out-Null
  $existing = Get-ChildItem -Path $EngineRoot -Filter 'mpv.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) { return $existing.FullName }

  Write-Header 'First run: installing Swoop native playback engine'
  Write-Host 'Downloading mpv 0.41.0 (about 60 MB). This happens once.' -ForegroundColor Yellow
  $zipPath = Join-Path $env:TEMP 'swoop-mpv-0.41.0.zip'
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Invoke-WebRequest -Uri $MpvUrl -OutFile $zipPath -UseBasicParsing

  $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $MpvSha256) {
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    throw "The downloaded playback engine failed its SHA-256 integrity check. Expected $MpvSha256 but received $actual."
  }

  if (Test-Path $EngineRoot) { Remove-Item $EngineRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $EngineRoot | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $EngineRoot -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

  $mpv = Get-ChildItem -Path $EngineRoot -Filter 'mpv.exe' -File -Recurse | Select-Object -First 1
  if (-not $mpv) { throw 'mpv.exe was not found after extraction.' }

  $inputConf = Join-Path $RuntimeRoot 'input.conf'
  @'
ESC quit
q quit
SPACE cycle pause
f cycle fullscreen
UP add volume 5
DOWN add volume -5
RIGHT seek 10
LEFT seek -10
'@ | Set-Content -Path $inputConf -Encoding ASCII

  Write-Host 'Native playback engine installed.' -ForegroundColor Green
  return $mpv.FullName
}

function Find-Edge {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  return $candidates | Select-Object -First 1
}

function UrlEncode([string]$Value) {
  return [uri]::EscapeDataString([string]$Value)
}

function Read-HttpRequest($Client) {
  $stream = $Client.GetStream()
  $headerBytes = New-Object System.Collections.Generic.List[byte]
  $state = 0
  while ($headerBytes.Count -lt 65536) {
    $value = $stream.ReadByte()
    if ($value -lt 0) { break }
    $headerBytes.Add([byte]$value)
    if ($state -eq 0 -and $value -eq 13) { $state=1 }
    elseif ($state -eq 1 -and $value -eq 10) { $state=2 }
    elseif ($state -eq 2 -and $value -eq 13) { $state=3 }
    elseif ($state -eq 3 -and $value -eq 10) { break }
    elseif ($value -eq 13) { $state=1 }
    else { $state=0 }
  }
  if ($headerBytes.Count -eq 0) { return $null }
  $headerText = [Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
  $lines = $headerText -split "`r`n"
  $requestLine = $lines[0]
  if ([string]::IsNullOrWhiteSpace($requestLine)) { return $null }
  $parts = $requestLine.Split(' ')
  if ($parts.Count -lt 2) { return $null }
  $headers = @{}
  foreach ($line in $lines[1..($lines.Count-1)]) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $idx = $line.IndexOf(':')
    if ($idx -gt 0) {
      $name = $line.Substring(0,$idx).Trim().ToLowerInvariant()
      $value = $line.Substring($idx+1).Trim()
      $headers[$name] = $value
    }
  }
  $length = 0
  if ($headers.ContainsKey('content-length')) { $null = [int]::TryParse($headers['content-length'], [ref]$length) }
  $body = ''
  if ($length -gt 0) {
    $bodyBytes = New-Object byte[] $length
    $read = 0
    while ($read -lt $length) {
      $n = $stream.Read($bodyBytes,$read,$length-$read)
      if ($n -le 0) { break }
      $read += $n
    }
    if ($read -gt 0) { $body = [Text.Encoding]::UTF8.GetString($bodyBytes,0,$read) }
  }
  return [pscustomobject]@{ Method=$parts[0].ToUpperInvariant(); Target=$parts[1]; Headers=$headers; Body=$body; Stream=$stream }
}

function Send-Bytes($Stream, [byte[]]$Bytes, [string]$ContentType='application/octet-stream', [int]$Status=200, [string]$StatusText='OK', [hashtable]$ExtraHeaders=$null) {
  $headers = @(
    "HTTP/1.1 $Status $StatusText",
    "Content-Type: $ContentType",
    "Content-Length: $($Bytes.Length)",
    'Cache-Control: no-store',
    'Connection: close',
    'X-Content-Type-Options: nosniff'
  )
  if ($ExtraHeaders) {
    foreach ($key in $ExtraHeaders.Keys) { $headers += ("{0}: {1}" -f $key, $ExtraHeaders[$key]) }
  }
  $headerText = ($headers -join "`r`n") + "`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes,0,$headerBytes.Length)
  if ($Bytes.Length -gt 0) { $Stream.Write($Bytes,0,$Bytes.Length) }
  $Stream.Flush()
}

function Send-Text($Stream, [string]$Text, [string]$ContentType='text/plain; charset=utf-8', [int]$Status=200, [string]$StatusText='OK') {
  Send-Bytes $Stream ([Text.Encoding]::UTF8.GetBytes($Text)) $ContentType $Status $StatusText
}

function Send-Json($Stream, $Object, [int]$Status=200, [string]$StatusText='OK') {
  $json = $Object | ConvertTo-Json -Depth 12 -Compress
  Send-Text $Stream $json 'application/json; charset=utf-8' $Status $StatusText
}

function Require-Token($Request) {
  if (-not $Request.Headers.ContainsKey('x-swoop-token')) { return $false }
  return $Request.Headers['x-swoop-token'] -eq $SessionToken
}

function Normalize-Server([string]$Server) {
  $value = ([string]$Server).Trim().TrimEnd('/')
  $value = $value -replace '/(?:player_api\.php|get\.php)$',''
  $uri = $null
  if (-not [uri]::TryCreate($value, [UriKind]::Absolute, [ref]$uri)) { throw 'Provider server URL is invalid.' }
  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') { throw 'Provider server must use http:// or https://.' }
  return $value
}

function Invoke-Xtream($Data) {
  $server = Normalize-Server ([string]$Data.server)
  $pairs = New-Object System.Collections.Generic.List[string]
  $pairs.Add('username=' + (UrlEncode ([string]$Data.username)))
  $pairs.Add('password=' + (UrlEncode ([string]$Data.password)))
  if ($Data.action) { $pairs.Add('action=' + (UrlEncode ([string]$Data.action))) }
  if ($Data.params) {
    foreach ($p in $Data.params.PSObject.Properties) {
      if ($null -ne $p.Value -and ([string]$p.Value) -ne '') { $pairs.Add((UrlEncode $p.Name) + '=' + (UrlEncode ([string]$p.Value))) }
    }
  }
  $url = $server + '/player_api.php?' + ($pairs -join '&')
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 35 -Headers @{ 'User-Agent'='SwoopTV/0.2 Windows' }
  return [string]$response.Content
}

function Invoke-FetchText($Data) {
  $url = [string]$Data.url
  $uri = $null
  if (-not [uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri)) { throw 'URL is invalid.' }
  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') { throw 'Only HTTP/HTTPS URLs are supported.' }
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45 -Headers @{ 'User-Agent'='SwoopTV/0.2 Windows' }
  return [string]$response.Content
}

function Stop-Mpv {
  if ($script:MpvProcess) {
    try {
      if (-not $script:MpvProcess.HasExited) { $script:MpvProcess.Kill() }
      else { $script:MpvLastExitCode = $script:MpvProcess.ExitCode }
    } catch {}
  }
  $script:MpvProcess = $null
}

function Get-MpvDiagnostics {
  $playing = $false
  $exitCode = $script:MpvLastExitCode
  if ($script:MpvProcess) {
    try {
      $playing = -not $script:MpvProcess.HasExited
      if (-not $playing) {
        $exitCode = $script:MpvProcess.ExitCode
        $script:MpvLastExitCode = $exitCode
      }
    } catch {}
  }
  $tail = @()
  if (Test-Path $script:MpvLogPath) {
    try {
      $tail = Get-Content -Path $script:MpvLogPath -Tail 24 -ErrorAction Stop | ForEach-Object {
        ([string]$_) -replace 'https?://[^\s\]\)\}\>\"]+', '[stream-url-redacted]'
      }
    } catch {}
  }
  return @{ ok=$true; playing=$playing; exitCode=$exitCode; launchedAt=$script:MpvLastLaunch; logTail=$tail }
}

function Start-Mpv($Data, [string]$MpvPath) {
  $url = [string]$Data.url
  $title = [string]$Data.title
  if ([string]::IsNullOrWhiteSpace($title)) { $title = 'Swoop TV' }
  $uri = $null
  if (-not [uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri)) { throw 'Playback URL is invalid.' }
  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https' -and $uri.Scheme -ne 'file') { throw 'Unsupported playback URL scheme.' }
  Stop-Mpv
  $script:MpvLastExitCode = $null
  $script:MpvLastLaunch = (Get-Date).ToString('o')
  if (Test-Path $script:MpvLogPath) { Remove-Item $script:MpvLogPath -Force -ErrorAction SilentlyContinue }
  $inputConf = Join-Path $RuntimeRoot 'input.conf'
  if (-not (Test-Path $inputConf)) {
    @'
ESC quit
q quit
SPACE cycle pause
f cycle fullscreen
UP add volume 5
DOWN add volume -5
RIGHT seek 10
LEFT seek -10
'@ | Set-Content -Path $inputConf -Encoding ASCII
  }
  $safeTitle = ($title -replace '[\r\n\"]',' ').Trim()
  $args = @(
    '--no-terminal',
    '--force-window=immediate',
    '--keep-open=yes',
    '--hwdec=auto-safe',
    '--cache=yes',
    '--cache-secs=15',
    '--demuxer-readahead-secs=20',
    '--network-timeout=25',
    '--osc=yes',
    ('--title=Swoop TV - ' + $safeTitle),
    ('--log-file=' + $script:MpvLogPath),
    ('--input-conf=' + $inputConf),
    '--',
    $url
  )
  Write-Host 'Compatibility playback profile active (v0.2.1 proven settings).' -ForegroundColor DarkCyan
  Write-Host ("Launching native playback: " + $safeTitle) -ForegroundColor Cyan
  $script:MpvProcess = Start-Process -FilePath $MpvPath -ArgumentList $args -PassThru
  Start-Sleep -Milliseconds 350
  try {
    if ($script:MpvProcess.HasExited) {
      $script:MpvLastExitCode = $script:MpvProcess.ExitCode
      Write-Host ("mpv exited immediately with code " + $script:MpvLastExitCode) -ForegroundColor Yellow
    } else {
      Write-Host ("mpv process started (PID " + $script:MpvProcess.Id + ")") -ForegroundColor Green
    }
  } catch {}
  return $script:MpvProcess.Id
}

function Get-Mime([string]$Path) {
  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.html' { return 'text/html; charset=utf-8' }
    '.js' { return 'text/javascript; charset=utf-8' }
    '.css' { return 'text/css; charset=utf-8' }
    '.json' { return 'application/json; charset=utf-8' }
    '.webmanifest' { return 'application/manifest+json; charset=utf-8' }
    '.svg' { return 'image/svg+xml' }
    '.png' { return 'image/png' }
    '.jpg' { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.webp' { return 'image/webp' }
    '.ico' { return 'image/x-icon' }
    default { return 'application/octet-stream' }
  }
}

function Handle-Request($Request, [string]$MpvPath) {
  $stream = $Request.Stream
  try {
    $uri = New-Object System.Uri(('http://127.0.0.1:' + $Port + $Request.Target))
    $path = $uri.AbsolutePath

    if ($Request.Method -eq 'OPTIONS') {
      Send-Bytes $stream ([byte[]]@()) 'text/plain' 204 'No Content'
      return
    }

    if ($path -eq '/native/status') {
      $playing = $false
      if ($script:MpvProcess) { try { $playing = -not $script:MpvProcess.HasExited } catch {} }
      Send-Json $stream @{ ok=$true; service='Swoop TV Windows Bridge'; version='0.3.2'; platform='windows'; mpvReady=(Test-Path $MpvPath); playing=$playing }
      return
    }

    if ($path.StartsWith('/native/')) {
      if (-not (Require-Token $Request)) {
        Send-Json $stream @{ ok=$false; error='Invalid Swoop native session token.' } 401 'Unauthorized'
        return
      }
      $data = $null
      if ($Request.Body) { $data = $Request.Body | ConvertFrom-Json }
      switch ($path) {
        '/native/xtream' {
          try { Send-Text $stream (Invoke-Xtream $data) 'application/json; charset=utf-8' }
          catch { Send-Json $stream @{ ok=$false; error=$_.Exception.Message } 502 'Bad Gateway' }
          return
        }
        '/native/fetch-text' {
          try { Send-Text $stream (Invoke-FetchText $data) 'text/plain; charset=utf-8' }
          catch { Send-Json $stream @{ ok=$false; error=$_.Exception.Message } 502 'Bad Gateway' }
          return
        }
        '/native/diagnostics' {
          Send-Json $stream (Get-MpvDiagnostics)
          return
        }
        '/native/play' {
          try {
            $pidValue = Start-Mpv $data $MpvPath
            Send-Json $stream @{ ok=$true; pid=$pidValue; player='mpv'; title=[string]$data.title }
          } catch { Send-Json $stream @{ ok=$false; error=$_.Exception.Message } 400 'Bad Request' }
          return
        }
        '/native/stop' {
          Stop-Mpv
          Send-Json $stream @{ ok=$true }
          return
        }
        default {
          Send-Json $stream @{ ok=$false; error='Unknown native endpoint.' } 404 'Not Found'
          return
        }
      }
    }

    $relative = [Uri]::UnescapeDataString($path.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    if ($relative.Contains('..')) { Send-Text $stream 'Forbidden' 'text/plain' 403 'Forbidden'; return }
    $candidate = Join-Path $WebRoot ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
    $full = [IO.Path]::GetFullPath($candidate)
    if (-not $full.StartsWith($WebRoot,[StringComparison]::OrdinalIgnoreCase)) { Send-Text $stream 'Forbidden' 'text/plain' 403 'Forbidden'; return }
    if (-not (Test-Path $full -PathType Leaf)) { Send-Text $stream 'Not found' 'text/plain' 404 'Not Found'; return }

    if ([IO.Path]::GetFileName($full).ToLowerInvariant() -eq 'index.html') {
      $html = Get-Content -Path $full -Raw -Encoding UTF8
      $bootstrap = "<script>window.__SWOOP_NATIVE__={token:'$SessionToken',version:'0.3.2',platform:'windows'};</script>"
      $html = $html -replace '</head>', ($bootstrap + '</head>')
      Send-Text $stream $html 'text/html; charset=utf-8'
      return
    }

    $bytes = [IO.File]::ReadAllBytes($full)
    Send-Bytes $stream $bytes (Get-Mime $full)
  } catch {
    try { Send-Json $stream @{ ok=$false; error=$_.Exception.Message } 500 'Internal Server Error' } catch {}
  }
}

Write-Header 'Swoop TV v0.3.2 — Rotating Top 5 Home Hero'
Write-Host 'This local bridge keeps IPTV video provider-to-device and launches mpv for playback.'
Write-Host 'No administrator rights are required.'

try {
  $MpvPath = Ensure-Mpv
} catch {
  Write-Host ''
  Write-Host ('Playback engine setup failed: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Press Enter to close.'
  [void](Read-Host)
  exit 1
}

$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Host "Port $Port is already in use. If Swoop TV is already open, use that window." -ForegroundColor Yellow
  $existingUrl = "http://127.0.0.1:$Port/"
  $edge = Find-Edge
  if ($edge) { Start-Process -FilePath $edge -ArgumentList ("--app=$existingUrl") | Out-Null } else { Start-Process $existingUrl | Out-Null }
  exit 0
}

$url = "http://127.0.0.1:$Port/"
$edgePath = Find-Edge
if ($edgePath) {
  Start-Process -FilePath $edgePath -ArgumentList @("--app=$url", '--start-maximized') | Out-Null
} else {
  Start-Process $url | Out-Null
}

Write-Host ''
Write-Host "Swoop TV is running at $url" -ForegroundColor Green
Write-Host 'Keep this window open while using the Windows native build.'
Write-Host 'Close this window to stop the local bridge. Press Ctrl+C to stop.' -ForegroundColor DarkGray

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $request = Read-HttpRequest $client
      if ($request) { Handle-Request $request $MpvPath }
    } catch {
      try { Send-Json ($client.GetStream()) @{ ok=$false; error=$_.Exception.Message } 500 'Internal Server Error' } catch {}
    } finally {
      try { $client.Close() } catch {}
    }
  }
} finally {
  Stop-Mpv
  try { $listener.Stop() } catch {}
}
