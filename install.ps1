# ─────────────────────────────────────────────────────────────────────────────
#  Latigid LP Generator — Installer (Windows)
# ─────────────────────────────────────────────────────────────────────────────
#  Run once per machine. From PowerShell:
#    git clone https://github.com/sena-design-studio/hs-lp-generator.git
#    cd hs-lp-generator
#    powershell -ExecutionPolicy Bypass -File .\install.ps1
#
#  Mirrors install.sh:
#    - cloud-folder guard
#    - winget auto-install of Node.js + git if missing
#    - OneDrive auto-detection with cross-user path validation
#    - junctions (not symlinks) so no admin/developer-mode required
#    - Claude Desktop config at %APPDATA%\Claude\claude_desktop_config.json
#
#  Idempotent: any prior install at %USERPROFILE%\.latigid\hs-lp-generator
#  is wiped and reinstalled.
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# ─── Constants ───────────────────────────────────────────────────────────────
$REPO_URL      = "https://github.com/sena-design-studio/hs-lp-generator.git"
$INSTALL_DIR   = Join-Path $env:USERPROFILE ".latigid\hs-lp-generator"
$ENV_FILE      = Join-Path $INSTALL_DIR ".env"
$CLAUDE_CONFIG = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"

# HubSpot OAuth app — must match install.sh
$HS_APP_ID    = "37936322"
$HS_CLIENT_ID = "891cdadd-e450-44b7-9c36-c6e0166e7825"

# ─── Pretty output ───────────────────────────────────────────────────────────
function Log     { param($m) Write-Host ("  [OK]  " + $m) -ForegroundColor Green }
function Warn    { param($m) Write-Host ("  [!]   " + $m) -ForegroundColor Yellow }
function Fail    { param($m) Write-Host ("  [X]   " + $m) -ForegroundColor Red; exit 1 }
function Header  { param($m) Write-Host ""; Write-Host ("━" * 50) -ForegroundColor Green; Write-Host ("  " + $m) -ForegroundColor White; Write-Host ("━" * 50) -ForegroundColor Green; Write-Host "" }
function Section { param($n, $m) Write-Host ""; Write-Host ("  " + $n) -NoNewline -ForegroundColor White; Write-Host ("  " + $m) }

trap {
  Write-Host ""
  Write-Host ("  [X]   Install failed: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}

Clear-Host
Header "Latigid LP Generator — Installer (Windows)"

# ─── Guard: refuse to install into a synced cloud folder ─────────────────────
# Same logic as install.sh. The MCP must run from a local-only path. Cloud
# sync providers cause file-lock conflicts, replicate per-machine state across
# teammates, and silently corrupt SQLite DBs.
$cloudMarkers = @(
  "\OneDrive - ",
  "\OneDrive\",
  "\Dropbox\",
  "\Google Drive\",
  "\GoogleDrive\",
  "\Box\",
  "\iCloudDrive\"
)
foreach ($marker in $cloudMarkers) {
  if ($env:USERPROFILE -like "*$marker*") {
    Write-Host "  [X]   Your user profile ($env:USERPROFILE) is inside a synced cloud folder." -ForegroundColor Red
    Write-Host "  [X]   The MCP can't run reliably from cloud storage — file locks, sync conflicts," -ForegroundColor Red
    Write-Host "  [X]   and per-machine paths all break. Move your user profile off cloud sync." -ForegroundColor Red
    exit 1
  }
}

# ─── Step 1: Git (auto-install via winget if missing) ────────────────────────
Section "[1/8]" "Checking Git..."

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Warn "Git not found — installing via winget..."
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget is not available. Install 'App Installer' from the Microsoft Store, then re-run this installer."
  }
  & winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
  # Refresh PATH for the rest of this session
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail "Git install reported success but git still isn't on PATH. Close this window, reopen PowerShell, and try again."
  }
}
Log ("Git " + ((& git --version) -replace 'git version ', ''))

# ─── Step 2: Node.js (auto-install via winget if missing) ────────────────────
Section "[2/8]" "Checking Node.js..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Warn "Node.js not found — installing via winget..."
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget is not available. Install 'App Installer' from the Microsoft Store, then re-run this installer."
  }
  & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node install reported success but node still isn't on PATH. Close this window, reopen PowerShell, and try again."
  }
}
Log ("Node.js " + (& node -v))

# ─── Step 3: Wipe any prior install ──────────────────────────────────────────
Section "[3/8]" "Preparing install directory..."

if (Test-Path $INSTALL_DIR) {
  Warn "Existing install found at $INSTALL_DIR — removing for clean reinstall."
  Remove-Item -Path $INSTALL_DIR -Recurse -Force
  Log "Old install removed"
}
$parent = Split-Path -Parent $INSTALL_DIR
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

# ─── Step 4: Clone fresh + npm install ───────────────────────────────────────
Section "[4/8]" "Downloading latest version..."

& git clone --quiet $REPO_URL $INSTALL_DIR
Log "Repository cloned"

Push-Location $INSTALL_DIR
try {
  & npm install --quiet
  Log "Node dependencies installed"
} finally {
  Pop-Location
}

# ─── Step 5: Credentials ─────────────────────────────────────────────────────
Section "[5/8]" "Configure credentials..."

Write-Host ""
Write-Host "  Anthropic API key  (personal — get one from console.anthropic.com)" -ForegroundColor White
Write-Host "  Used by analyse_wireframe and web_search tools."
$ANTHROPIC_KEY = Read-Host "  > "
if ($ANTHROPIC_KEY -notlike "sk-ant-*") {
  Warn "Key doesn't start with sk-ant- — saving anyway, edit .env later if wrong."
}

Write-Host ""
Write-Host "  HubSpot Client Secret  (paste the value Filipe sent you on Slack)" -ForegroundColor White
$HS_CLIENT_SECRET = Read-Host "  > "

Write-Host ""
Write-Host "  Auth Secret  (paste the value Filipe sent you on Slack)" -ForegroundColor White
$AUTH_SECRET = Read-Host "  > "

if ([string]::IsNullOrWhiteSpace($HS_CLIENT_SECRET) -or [string]::IsNullOrWhiteSpace($AUTH_SECRET)) {
  Fail "Both shared secrets are required. Ask Filipe to re-send them, then re-run the installer."
}

# ─── Step 6: OneDrive folder ─────────────────────────────────────────────────
Section "[6/8]" "Detecting OneDrive folder..."

$ONEDRIVE_PATH = $null

# Auto-detect: try the common Windows paths first
$candidates = @(
  (Join-Path $env:USERPROFILE "OneDrive - LATIGID LDA\MCP Claude - Documents"),
  (Join-Path $env:USERPROFILE "OneDrive - Latigid\MCP Claude - Documents"),
  (Join-Path $env:USERPROFILE "OneDrive\MCP Claude - Documents")
)
foreach ($candidate in $candidates) {
  if (Test-Path $candidate -PathType Container) {
    $ONEDRIVE_PATH = $candidate
    Log "Found: $ONEDRIVE_PATH"
    break
  }
}

# Glob fallback: any %USERPROFILE%\OneDrive - <tenant>\MCP Claude - Documents
if (-not $ONEDRIVE_PATH) {
  $globbed = Get-ChildItem -Path $env:USERPROFILE -Directory -Filter "OneDrive - *" -ErrorAction SilentlyContinue
  foreach ($d in $globbed) {
    $candidate = Join-Path $d.FullName "MCP Claude - Documents"
    if (Test-Path $candidate -PathType Container) {
      $ONEDRIVE_PATH = $candidate
      Log "Found: $ONEDRIVE_PATH"
      break
    }
  }
}

# Manual entry fallback
if (-not $ONEDRIVE_PATH) {
  Warn "OneDrive folder not auto-detected."
  Write-Host "  Paste the full path to your 'MCP Claude - Documents' folder, then press Enter:"
  Write-Host "  (In Explorer: right-click the folder → 'Copy as path')"
  $raw = Read-Host "  > "
  $ONEDRIVE_PATH = $raw.Trim().Trim('"').Trim("'")
  if (-not (Test-Path $ONEDRIVE_PATH -PathType Container)) {
    Fail "Folder not found: $ONEDRIVE_PATH"
  }
  Log "OneDrive path set"
}

# Validate that ONEDRIVE_PATH is inside the user's profile — same defence as
# install.sh. Refuse to use a path that lives under another user's profile
# (which would happen if the user copied/inherited a .env from elsewhere).
$userProfileNormalized = (Resolve-Path $env:USERPROFILE).Path.TrimEnd('\')
$onedriveNormalized    = (Resolve-Path $ONEDRIVE_PATH).Path.TrimEnd('\')
if (-not $onedriveNormalized.StartsWith($userProfileNormalized + '\', [StringComparison]::OrdinalIgnoreCase)) {
  Fail "OneDrive path ($ONEDRIVE_PATH) lives outside your user profile ($env:USERPROFILE). Refusing to use it — paths under another user's profile never resolve correctly."
}

# Junction the shared folders into the install dir.
#
# Junctions vs. symbolic links on Windows:
#   - Junctions work for directories, don't require admin or developer mode,
#     and Node.js follows them transparently. This matches the macOS symlink
#     experience for users.
#
# Defensive validation: $TARGET sits inside the user's OneDrive folder. The
# resolved target must live under $env:USERPROFILE — if it points elsewhere,
# someone planted a cross-user link in the shared OneDrive folder.
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

  # Wipe any prior link or directory at the target
  if (Test-Path $link) { Remove-Item -Path $link -Recurse -Force }

  if (-not (Test-Path $target -PathType Container)) {
    Warn "$f not in OneDrive yet — re-run the installer after sync completes"
    continue
  }

  # Resolve the real target (follows any junction chain inside OneDrive too)
  $resolvedTarget = (Resolve-Path $target).Path.TrimEnd('\')
  if (-not $resolvedTarget.StartsWith($userProfileNormalized + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Warn "$f in OneDrive resolves to '$resolvedTarget' (outside your user profile) — skipping."
    Warn "  Tell Filipe to remove the stale link at $target on his machine."
    continue
  }

  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  Log "Linked $f -> OneDrive"
}

# ─── Step 7: Write .env + configure Claude Desktop ───────────────────────────
Section "[7/8]" "Writing configuration..."

$envContent = @"
# Latigid LP Generator — Environment Configuration
# Auto-generated by install.ps1

# HubSpot OAuth App (April 2026)
HS_APP_ID=$HS_APP_ID
HS_CLIENT_ID=$HS_CLIENT_ID
HS_CLIENT_SECRET=$HS_CLIENT_SECRET
HS_REDIRECT_URI=https://auth.latigid.dev/oauth/callback

# Remote auth server
REMOTE_AUTH_URL=https://auth.latigid.dev
AUTH_SECRET=$AUTH_SECRET

# Pexels API (shared)
PEXELS_API_KEY=apdLrgHDvp6MjgeJSE2mmmQ3ddZYnjKIKnwCh2e8rul6hvE5yh5BtGZw

# Anthropic API (personal — do not share)
ANTHROPIC_API_KEY=$ANTHROPIC_KEY

# OneDrive shared folder
ONEDRIVE_PATH=$ONEDRIVE_PATH
"@
# UTF-8 NO BOM — Node's fs.readFileSync(..., 'utf8') leaves any BOM intact,
# which would break auth.js's HS_APP_ID parse on the first line.
[System.IO.File]::WriteAllText($ENV_FILE, $envContent, (New-Object System.Text.UTF8Encoding $false))
Log ".env written"

# Make sure Claude config dir exists, backup any existing config
$claudeDir = Split-Path -Parent $CLAUDE_CONFIG
if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }
if (Test-Path $CLAUDE_CONFIG) {
  Copy-Item $CLAUDE_CONFIG ($CLAUDE_CONFIG + ".bak") -Force
  Log "Backed up existing Claude config"
}

# Edit the Claude Desktop config via node so JSON escaping is correct on Windows.
# Pass paths as argv (not inlined in the JS source) to dodge backslash escaping.
$jsScript = @'
const fs = require('fs');
const path = require('path');
const cfgPath = process.argv[2];
const installDir = process.argv[3];
let c = {};
try { c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
c.mcpServers = c.mcpServers || {};
c.mcpServers['hs-lp-generator'] = {
  command: 'node',
  args: [path.join(installDir, 'index.js')]
};
fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2));
'@
& node -e $jsScript $CLAUDE_CONFIG $INSTALL_DIR
Log "Claude Desktop configured"

Push-Location $INSTALL_DIR
try {
  & node --check index.js 2>$null
  if ($LASTEXITCODE -eq 0) {
    Log "index.js syntax OK"
  } else {
    Warn "index.js failed syntax check — tell Filipe"
  }
} finally {
  Pop-Location
}

# ─── Step 8: Restart Claude Desktop ──────────────────────────────────────────
Section "[8/8]" "Restarting Claude Desktop..."

$claudeProc = Get-Process -Name "Claude" -ErrorAction SilentlyContinue
if ($claudeProc) {
  $claudeProc | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Log "Claude Desktop quit"
} else {
  Log "Claude Desktop wasn't running"
}

# Try common launch paths
$claudeExeCandidates = @(
  (Join-Path $env:LOCALAPPDATA "AnthropicClaude\Claude.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\Claude\Claude.exe"),
  (Join-Path ${env:ProgramFiles} "Claude\Claude.exe")
)
$launched = $false
foreach ($exe in $claudeExeCandidates) {
  if (Test-Path $exe) {
    Start-Process $exe
    Log "Claude Desktop launched"
    $launched = $true
    break
  }
}
if (-not $launched) {
  Warn "Could not auto-launch Claude — open it manually from the Start menu."
}

# ─── Done ────────────────────────────────────────────────────────────────────
Header "Installation complete"

Write-Host "  Final step: Connect your HubSpot portal." -ForegroundColor White
Write-Host ""
Write-Host "  1. Visit: " -NoNewline; Write-Host "https://auth.latigid.dev" -ForegroundColor Green
Write-Host "     Click 'Connect HubSpot Portal' for each portal you need."
Write-Host ""
Write-Host "  2. In Claude Desktop, ask:"
Write-Host '     "List the themes in portal 2662575"' -ForegroundColor Green
Write-Host ""
Write-Host "  To update later: double-click 'Update LP Generator.bat' inside $INSTALL_DIR"
Write-Host ""
Read-Host "  Press Enter to close"
