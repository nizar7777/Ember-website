param([int]$Port = 5500)

$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$Port/"

$mime = @{
    ".html" = "text/html"; ".htm" = "text/html"; ".css" = "text/css"
    ".js" = "application/javascript"; ".json" = "application/json"
    ".png" = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"
    ".gif" = "image/gif"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon"
    ".woff" = "font/woff"; ".woff2" = "font/woff2"; ".ttf" = "font/ttf"
    ".webp" = "image/webp"; ".mp4" = "video/mp4"
    # The footer art on every page is .avif, one shirt mockup is .jfif and
    # the fonts include .otf — without these they'd go out as raw bytes.
    ".avif" = "image/avif"; ".jfif" = "image/jpeg"; ".otf" = "font/otf"
    ".eot" = "application/vnd.ms-fontobject"
    ".csv" = "text/csv"; ".txt" = "text/plain"
    ".webm" = "audio/webm"; ".mp3" = "audio/mpeg"; ".wav" = "audio/wav"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
        $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
        if ($path -eq "/") { $path = "/index.html" }
        $filePath = Join-Path $root $path.TrimStart("/")

        # --- dev-only write endpoint --------------------------------------
        # Windows has no WebP encoder available from PowerShell, but Chrome
        # encodes WebP from a canvas. tools/convert-mockups.html uses that to
        # re-encode the shirt mockups, then POSTs the bytes here to be saved.
        #
        # Local only, and serve.ps1 never ships (see build-deploy.ps1), so
        # this is not reachable from anywhere but this machine. Writes are
        # confined to the project folder.
        if ($req.HttpMethod -eq "POST" -and $path -eq "/__save") {
            $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
            $body = $reader.ReadToEnd(); $reader.Close()
            $payload = $body | ConvertFrom-Json
            $dest = Join-Path $root $payload.path
            $full = [System.IO.Path]::GetFullPath($dest)
            if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
                $res.StatusCode = 403
                $out = [System.Text.Encoding]::UTF8.GetBytes("outside project root")
            } else {
                $dir = [System.IO.Path]::GetDirectoryName($full)
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                [System.IO.File]::WriteAllBytes($full, [Convert]::FromBase64String($payload.b64))
                Write-Host ("  saved {0} ({1:N0} bytes)" -f $payload.path, (Get-Item $full).Length)
                $out = [System.Text.Encoding]::UTF8.GetBytes("ok " + (Get-Item $full).Length)
            }
            $res.ContentType = "text/plain"
            $res.OutputStream.Write($out, 0, $out.Length)
            $res.OutputStream.Close()
            continue
        }

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $contentType = $mime[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = $contentType
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        $res.StatusCode = 500
    } finally {
        $res.OutputStream.Close()
    }
}
