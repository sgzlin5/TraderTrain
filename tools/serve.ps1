# TraderTrain built-in static server (fallback when Python is missing). Windows PowerShell 5.1+.
# ASCII only on purpose: PowerShell 5.1 mis-parses UTF-8 without BOM.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8731 -Root <project root>
param(
  [int]$Port = 8731,
  [string]$Root = "."
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path $Root).Path
$prefix = "http://127.0.0.1:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".mjs"  = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".map"  = "application/json; charset=utf-8"
  ".bin"  = "application/octet-stream"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "TraderTrain server: $prefix -> $rootPath"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ([string]::IsNullOrEmpty($path) -or $path -eq "/") { $path = "/app/index.html" }

    $rel = $path.TrimStart("/") -replace '/', '\'
    $full = [IO.Path]::Combine($rootPath, $rel)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
      $body = [Text.Encoding]::UTF8.GetBytes("404 not found")
      $res.ContentType = "text/plain; charset=utf-8"
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.Close()
      continue
    }

    $ext = [IO.Path]::GetExtension($full).ToLower()
    if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = "application/octet-stream" }
    $res.Headers.Add("Cache-Control", "no-store")
    $bytes = [IO.File]::ReadAllBytes($full)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    # one bad request must not kill the server
  }
}
