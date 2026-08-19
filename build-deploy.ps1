# Builds a clean copy of the site for uploading to Netlify.
#
# Why this exists: everything you drag into Netlify becomes publicly
# fetchable by URL. This site's folder also holds working files that
# shouldn't be public (setup notes with your EmailJS IDs, the local dev
# server script, editor config). This copies only what the live site needs
# into a "_deploy" folder, which is what you drag to Netlify.
#
# Run it:   .\build-deploy.ps1
# Then go to https://app.netlify.com/drop and drag the _deploy folder in.

$ErrorActionPreference = "Stop"

$source = $PSScriptRoot
$target = Join-Path $source "_deploy"

# Working files that must NOT go on the live site.
$excludeNames = @(
    "_deploy",
    ".claude",
    ".claude-ads",            # ad account IDs, campaign plans, budget notes
    ".vscode",
    "SETUP-NEEDED.txt",       # contains your EmailJS service/template IDs
    "serve.ps1",              # local dev server
    "build-deploy.ps1",       # this script
    "product-sheet-template.csv",
    "style-gud.html",         # Webflow style guide, not a real page

    # Webflow's password-gate page. It posts to /.wf_auth, an endpoint
    # that only exists on Webflow's own hosting, so off it the form can
    # never succeed.
    "401.html",

    # Internal order-logging tool. It was going up on the public site with
    # nothing but a noindex tag in front of it, so anyone guessing the URL
    # could open it. Keep bookmarking it locally through serve.ps1; if it
    # ever needs to be online it wants real auth, not obscurity.
    "order-entry.html",

    # Webflow export stubs — these ship with an empty <body> and are not
    # part of the cart/checkout flow.
    "detail_category.html",
    "detail_product.html",
    "detail_sku.html",
    "order-confirmation.html",
    "paypal-checkout.html"
)

# Files inside the copied folders that nothing on the site references any
# more. Kept in the project (they are yours, and the originals cost
# nothing sitting here) but no reason to publish them.
#   Group-10268*   the old page-grain texture, replaced by an inline SVG
#                  tile in css/system.css. 3.1 MB across its variants.
#   Liftaswashfixed  a font whose @font-face was declared twice and never
#                  applied to a single element.
#   PRINT-AREA-GUIDE.png  internal print reference, not used by any page.
$excludePatterns = @(
    "Group-10268*.png",
    "Liftaswashfixed-Regular.otf",
    "PRINT-AREA-GUIDE.png"
)

# Whole folders that exist for you, not for visitors.
#   tools/  the WebP re-encoder, which needs serve.ps1 to do anything.
$excludeNames += "tools"

# The mockup PNGs are the masters the .webp files are generated from. The
# site only ever loads the .webp, so shipping ~32 MB of PNG alongside them
# would double the upload for nothing. Re-run tools/convert-mockups.html
# if you add or replace one.
$excludeMockupSources = $true

# Clear the folder rather than delete it. Windows refuses to remove a
# directory that anything holds a handle on — an open Explorer window is
# enough — and that failure used to abort the whole build.
if (Test-Path $target) {
    Get-ChildItem -Path $target -Force | Remove-Item -Recurse -Force -ErrorAction Stop
} else {
    New-Item -ItemType Directory -Path $target | Out-Null
}

Get-ChildItem -Path $source -Force | Where-Object { $excludeNames -notcontains $_.Name } | ForEach-Object {
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName -Destination $target -Recurse -Force
    } else {
        Copy-Item $_.FullName -Destination $target -Force
    }
}

$prunedBytes = 0
foreach ($pattern in $excludePatterns) {
    Get-ChildItem -Path $target -Recurse -File -Filter $pattern | ForEach-Object {
        $script:prunedBytes += $_.Length
        Remove-Item $_.FullName -Force
    }
}

if ($excludeMockupSources) {
    $mockDir = Join-Path $target "mockup"
    if (Test-Path $mockDir) {
        Get-ChildItem -Path $mockDir -File | Where-Object { $_.Extension -notin @(".webp") } | ForEach-Object {
            $script:prunedBytes += $_.Length
            Remove-Item $_.FullName -Force
        }
    }
}

# --- Drop images nothing links to ---------------------------------------
# The Webflow export ships a chain of srcset variants per photo. Those
# have been replaced by a single WebP each, which leaves a lot of PNGs
# that no page, stylesheet or script mentions any more. Rather than keep
# a list in sync by hand, work out what is actually referenced.
#
# Referenced-by-name, so a file built at runtime from a variable would be
# missed — the only images built that way are the shirt mockups, and the
# mockup folder is handled separately above.
$referenced = New-Object System.Collections.Generic.HashSet[string]
Get-ChildItem -Path $target -Include *.html,*.css,*.js -Recurse -File | ForEach-Object {
    $txt = [IO.File]::ReadAllText($_.FullName)
    [regex]::Matches($txt, 'images/([^\s"''\),\\]+\.(?:png|jpg|jpeg|jfif|avif|svg|webp|ico))') | ForEach-Object {
        [void]$referenced.Add([System.Uri]::UnescapeDataString($_.Groups[1].Value))
    }
}

$imgDir = Join-Path $target "images"
if ((Test-Path $imgDir) -and $referenced.Count -gt 0) {
    Get-ChildItem -Path $imgDir -File | Where-Object { -not $referenced.Contains($_.Name) } | ForEach-Object {
        $script:prunedBytes += $_.Length
        Remove-Item $_.FullName -Force
    }
}

# --- Shrink oversized photos -------------------------------------------
# The source photos are print-resolution (the shirt mockups are 2402x3481)
# but never display larger than ~400px wide. Serving the originals means a
# customer on mobile data downloads several MB to see one shirt. This
# resizes the copies in _deploy only — your originals are never touched.
# PNG is kept (not JPEG) because the mockups have transparent backgrounds.
Add-Type -AssemblyName System.Drawing

# Max width per folder, ~2x the largest on-screen size so it stays sharp
# on high-DPI phones.
$maxWidths = @{ "mockup" = 800; "images" = 1200 }
$savedBytes = 0
$resizedCount = 0
$keptCount = 0

foreach ($folder in $maxWidths.Keys) {
    $dir = Join-Path $target $folder
    if (-not (Test-Path $dir)) { continue }
    $maxW = $maxWidths[$folder]

    Get-ChildItem -Path $dir -Recurse -File -Include *.png, *.jpg, *.jpeg | ForEach-Object {
        $before = $_.Length
        try {
            $img = [System.Drawing.Image]::FromFile($_.FullName)
            if ($img.Width -le $maxW) { $img.Dispose(); return }

            $scale = $maxW / $img.Width
            $w = [int]($img.Width * $scale)
            $h = [int]($img.Height * $scale)

            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.DrawImage($img, 0, 0, $w, $h)

            $fmt = if ($_.Extension -ieq ".png") {
                [System.Drawing.Imaging.ImageFormat]::Png
            } else {
                [System.Drawing.Imaging.ImageFormat]::Jpeg
            }

            $path = $_.FullName
            $g.Dispose(); $img.Dispose()

            # Write to a temp file first. .NET's PNG encoder is weaker than
            # whatever produced these originals, so on some images a smaller
            # picture still lands as a BIGGER file. Only keep the resize when
            # it actually wins; otherwise leave the original copy alone.
            $tmp = [System.IO.Path]::GetTempFileName()
            $bmp.Save($tmp, $fmt)
            $bmp.Dispose()

            if ((Get-Item $tmp).Length -lt $before) {
                Move-Item $tmp $path -Force
                $script:savedBytes += ($before - (Get-Item $path).Length)
                $script:resizedCount++
            } else {
                Remove-Item $tmp -Force
                $script:keptCount++
            }
        } catch {
            Write-Host "  (skipped $($_.Name) - $($_.Exception.Message))" -ForegroundColor DarkGray
        }
    }
}

$fileCount = (Get-ChildItem -Path $target -Recurse -File | Measure-Object).Count
$sizeMb = [math]::Round(((Get-ChildItem -Path $target -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB), 1)

Write-Host ""
Write-Host "Deploy folder ready:" -ForegroundColor Green
Write-Host "  $target"
Write-Host "  $fileCount files, $sizeMb MB"
if ($resizedCount -gt 0) {
    Write-Host ("  shrank $resizedCount photos, saved {0:N1} MB (your originals untouched)" -f ($savedBytes / 1MB))
}
if ($keptCount -gt 0) {
    Write-Host "  left $keptCount photos as-is (resizing them would not have helped)"
}
if ($prunedBytes -gt 0) {
    Write-Host ("  dropped {0:N1} MB of unreferenced files" -f ($prunedBytes / 1MB))
}
Write-Host ""
Write-Host "Next: open https://app.netlify.com/drop and drag the _deploy folder onto it."
Write-Host ""
Write-Host "Excluded from the upload (kept private):" -ForegroundColor Yellow
$excludeNames | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
