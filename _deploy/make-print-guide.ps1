# Generates mockup/PRINT-AREA-GUIDE.png — a real shirt with the print box
# drawn on it, so you can see exactly what area your 1800x2400 design
# canvas covers before you start drawing.
#
# The numbers here MUST match PRINT_AREA in js/shirt-colors.js. If you move
# the print area there, re-run this so the guide stays honest.
#
# Run it:  .\make-print-guide.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# --- keep in sync with js/shirt-colors.js -------------------------------
$centerXPct = 50
$centerYPct = 47
$widthPct   = 31
$ratioW     = 3
$ratioH     = 4
$canvasW    = 1800
$canvasH    = 2400
# ------------------------------------------------------------------------

$source = Join-Path $PSScriptRoot "mockup\white front.png"
$outPath = Join-Path $PSScriptRoot "mockup\PRINT-AREA-GUIDE.png"

$shirt = [System.Drawing.Image]::FromFile($source)
$W = $shirt.Width
$H = $shirt.Height

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Dark backdrop so a white shirt is visible, then the shirt itself.
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 25, 20, 16))), 0, 0, $W, $H)
$g.DrawImage($shirt, 0, 0, $W, $H)

# The print box, in pixels of this frame.
$boxW = [int]($W * $widthPct / 100)
$boxH = [int]($boxW * $ratioH / $ratioW)
$boxX = [int]($W * $centerXPct / 100 - $boxW / 2)
$boxY = [int]($H * $centerYPct / 100 - $boxH / 2)

# Tint the print area so it reads at a glance.
$fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(48, 255, 74, 31))
$g.FillRectangle($fill, $boxX, $boxY, $boxW, $boxH)

$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 74, 31), 6)
$pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
$g.DrawRectangle($pen, $boxX, $boxY, $boxW, $boxH)

# Centre guides.
$thin = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 255, 74, 31), 2)
$thin.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot
$g.DrawLine($thin, $boxX + $boxW / 2, $boxY, $boxX + $boxW / 2, $boxY + $boxH)
$g.DrawLine($thin, $boxX, $boxY + $boxH / 2, $boxX + $boxW, $boxY + $boxH / 2)

# Labels.
$font = New-Object System.Drawing.Font("Segoe UI", 46, [System.Drawing.FontStyle]::Bold)
$small = New-Object System.Drawing.Font("Segoe UI", 34)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$orange = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 74, 31))

$g.DrawString("PRINT AREA", $font, $orange, $boxX, [float]($boxY - 70))
$g.DrawString("$canvasW x $canvasH px", $small, $white, $boxX, [float]($boxY + $boxH + 16))
$g.DrawString("transparent PNG, 3:4", $small, $white, $boxX, [float]($boxY + $boxH + 66))

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose(); $shirt.Dispose()

Write-Host ""
Write-Host "Guide written:" -ForegroundColor Green
Write-Host "  $outPath"
Write-Host ("  print box is {0}x{1}px within the {2}x{3} mockup" -f $boxW, $boxH, $W, $H)
Write-Host ""
Write-Host "Design canvas to use in your design app: $canvasW x $canvasH px (transparent PNG)"
Write-Host ""
