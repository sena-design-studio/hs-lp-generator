# -----------------------------------------------------------------------------
#  Latigid LP Generator -- Updater (Windows)
# -----------------------------------------------------------------------------
#  Pulls the latest code, refreshes deps, validates, and shows what changed.
#  Double-click "Update LP Generator.bat" to run, or invoke directly:
#    powershell -ExecutionPolicy Bypass -File .\update.ps1
#
#  Mirrors update.sh -- same self-heal logic for .env and junctions.
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$INSTALL_DIR = Join-Path $env:USERPROFILE ".latigid\hs-lp-generator"

function Log     { param($m) Write-Host ("  [OK]  " + $m) -ForegroundColor Green }
function Warn    { param($m) Write-Host ("  [!]   " + $m) -ForegroundColor Yellow }
function Fail    { param($m) Write-Host ("  [X]   " + $m) -ForegroundColor Red; Read-Host "  Press Enter to close"; exit 1 }
function Header  { param($m) Write-Host ""; Write-Host ("=" * 50) -ForegroundColor Green; Write-Host ("  " + $m) -ForegroundColor White; Write-Host ("=" * 50) -ForegroundColor Green; Write-Host "" }

trap {
  Write-Host ""
  Write-Host ("  [X]   Update failed: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}

Clear-Host
Header "Latigid LP Generator -- Update"

if (-not (Test-Path (Join-Path $INSTALL_DIR ".git"))) {
  Fail "LP Generator not installed at $INSTALL_DIR. Run install.ps1 first."
}

Push-Location $INSTALL_DIR
try {

  # --- Check current vs. remote --------------------------------------------
  $CURRENT = (& git rev-parse --short HEAD).Trim()
  Log "Current version: $CURRENT"

  Write-Host "  Checking for updates..."
  & git fetch --quiet origin main

  $LATEST = (& git rev-parse --short origin/main).Trim()

  if ($CURRENT -eq $LATEST) {
    Log "Already up to date ($CURRENT)"
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 0
  }

  # --- Show changelog before applying --------------------------------------
  Write-Host ""
  Write-Host ("  New commits ($CURRENT -> $LATEST):") -ForegroundColor White
  & git log --oneline --no-decorate "$CURRENT..origin/main" | ForEach-Object { Write-Host "    $_" }
  Write-Host ""

  # --- Pull and refresh deps -----------------------------------------------
  & git pull --quiet origin main
  Log "Pulled to $LATEST"

  # Reinstall deps only if package files changed
  $changedFiles = & git diff --name-only "$CURRENT" "$LATEST"
  if ($changedFiles -match '^package(-lock)?\.json$') {
    Write-Host "  package.json changed -- reinstalling dependencies..."
    & npm install --quiet
    Log "Dependencies refreshed"
  } else {
    Log "Dependencies unchanged"
  }

  # --- Self-heal config (.env + junctions) ---------------------------------
  # Same two failure modes as update.sh:
  #   1. New shared OneDrive folder added in code that existing installs
  #      don't have a junction for.
  #   2. .env or junctions copied from another user's machine -- paths point
  #      to C:\Users\<someone-else>\... and never resolve. Validate that
  #      ONEDRIVE_PATH (and every junction target) lives under $USERPROFILE
  #      and rebuild anything that doesn't.

  $ENV_FILE = Join-Path $INSTALL_DIR ".env"
  $ONEDRIVE_PATH = $null

  if (Test-Path $ENV_FILE) {
    $envLine = Select-String -Path $ENV_FILE -Pattern '^ONEDRIVE_PATH=' | Select-Object -First 1
    if ($envLine) {
      $ONEDRIVE_PATH = $envLine.Line -replace '^ONEDRIVE_PATH=', ''
    }
  }

  $userProfileNormalized = (Resolve-Path $env:USERPROFILE).Path.TrimEnd('\')

  # Validate the .env-supplied path: must be inside USERPROFILE AND exist
  $onedriveValid = $false
  if ($ONEDRIVE_PATH) {
    if (Test-Path $ONEDRIVE_PATH -PathType Container) {
      $resolvedOnedrive = (Resolve-Path $ONEDRIVE_PATH).Path.TrimEnd('\')
      if ($resolvedOnedrive.StartsWith($userProfileNormalized + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $onedriveValid = $true
      } else {
        Warn "ONEDRIVE_PATH from .env points outside your user profile ($ONEDRIVE_PATH) -- looks like the .env was copied from another user. Re-detecting."
      }
    } else {
      Warn "ONEDRIVE_PATH from .env points to a non-existent folder ($ONEDRIVE_PATH) -- re-detecting"
    }
  }

  # Re-detect via the same candidates install.ps1 uses
  if (-not $onedriveValid) {
    $ONEDRIVE_PATH = $null
    $candidates = @(
      (Join-Path $env:USERPROFILE "OneDrive - LATIGID LDA\MCP Claude - Documents"),
      (Join-Path $env:USERPROFILE "OneDrive - Latigid\MCP Claude - Documents"),
      (Join-Path $env:USERPROFILE "OneDrive\MCP Claude - Documents")
    )
    foreach ($c in $candidates) {
      if (Test-Path $c -PathType Container) { $ONEDRIVE_PATH = $c; break }
    }
    if (-not $ONEDRIVE_PATH) {
      $globbed = Get-ChildItem -Path $env:USERPROFILE -Directory -Filter "OneDrive - *" -ErrorAction SilentlyContinue
      foreach ($d in $globbed) {
        $c = Join-Path $d.FullName "MCP Claude - Documents"
        if (Test-Path $c -PathType Container) { $ONEDRIVE_PATH = $c; break }
      }
    }
  }

  # Rewrite .env so subsequent runs (and the MCP itself, which reads it on
  # every call) pick up the corrected path
  if ($ONEDRIVE_PATH -and (Test-Path $ENV_FILE)) {
    $envContent = Get-Content $ENV_FILE -Raw
    $existingMatch = [regex]::Match($envContent, '(?m)^ONEDRIVE_PATH=(.*)$')
    $currentInEnv = if ($existingMatch.Success) { $existingMatch.Groups[1].Value } else { $null }
    if ($currentInEnv -ne $ONEDRIVE_PATH) {
      if ($existingMatch.Success) {
        $envContent = [regex]::Replace($envContent, '(?m)^ONEDRIVE_PATH=.*$', "ONEDRIVE_PATH=$ONEDRIVE_PATH")
      } else {
        if (-not $envContent.EndsWith("`n")) { $envContent += "`n" }
        $envContent += "ONEDRIVE_PATH=$ONEDRIVE_PATH`n"
      }
      # UTF-8 NO BOM -- see install.ps1 for rationale (Node's utf8 readFileSync
      # doesn't strip BOM, which would corrupt the first .env line).
      [System.IO.File]::WriteAllText($ENV_FILE, $envContent, (New-Object System.Text.UTF8Encoding $false))
      Log "Corrected .env: ONEDRIVE_PATH=$ONEDRIVE_PATH"
    }
  }

  # Validate + rebuild junctions
  if ($ONEDRIVE_PATH -and (Test-Path $ONEDRIVE_PATH -PathType Container)) {
    $rebuiltAny = $false
    $createdAny = $false
    $skippedAny = $false

    $sharedFolders = @(
      "lp-theme-generic",
      "lp-theme-programme",
      "email-template-generic",
      "generated-themes",
      "generated-email-templates",
      "client-images"
    )

    foreach ($f in $sharedFolders) {
      $link   = Join-Path $INSTALL_DIR $f
      $target = Join-Path $ONEDRIVE_PATH $f

      # Layer 1: if existing junction points outside USERPROFILE, kill it
      if (Test-Path $link) {
        $item = Get-Item $link -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink")) {
          $currentTarget = $item.Target
          if ($currentTarget -is [array]) { $currentTarget = $currentTarget[0] }
          $currentTargetStr = "$currentTarget".TrimEnd('\')
          if (-not $currentTargetStr.StartsWith($userProfileNormalized + '\', [StringComparison]::OrdinalIgnoreCase)) {
            Warn "Junction $f points outside your user profile ($currentTargetStr) -- rebuilding"
            Remove-Item $link -Force -Recurse
            $rebuiltAny = $true
          }
        }
      }

      # Layer 2: if creating fresh, verify the resolved chain stays under USERPROFILE
      if ((-not (Test-Path $link)) -and (Test-Path $target -PathType Container)) {
        $resolvedTarget = (Resolve-Path $target).Path.TrimEnd('\')
        if ($resolvedTarget.StartsWith($userProfileNormalized + '\', [StringComparison]::OrdinalIgnoreCase)) {
          New-Item -ItemType Junction -Path $link -Target $target | Out-Null
          Log "Linked: $f -> $target"
          $createdAny = $true
        } else {
          Warn "Skipped $f -- OneDrive target resolves to '$resolvedTarget' (outside your user profile)."
          Warn "  Likely a stale link synced into the shared folder. Tell Filipe."
          $skippedAny = $true
        }
      }
    }

    if (-not ($rebuiltAny -or $createdAny -or $skippedAny)) {
      Log "All shared folders already linked correctly"
    }
  } else {
    Warn "OneDrive path not found -- skipping junction self-heal. If the MCP fails to start, run install.ps1 again."
  }

  # --- Validate ------------------------------------------------------------
  & node --check index.js 2>$null
  if ($LASTEXITCODE -eq 0) {
    Log "index.js syntax OK"
  } else {
    Warn "index.js failed syntax check -- please report this to Filipe"
  }

} finally {
  Pop-Location
}

# --- Done ------------------------------------------------------------------
Header "Update complete"

Write-Host "  Restart Claude Desktop (quit from the system tray, then reopen)" -ForegroundColor White
Write-Host "  to load the changes."
Write-Host ""
Read-Host "  Press Enter to close"
