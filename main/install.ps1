# ─── hs-lp-generator installer (Windows) ─────────────────────────────────────
# Run once per machine. Right-click > Run with PowerShell.

$ErrorActionPreference = "Stop"

$REPO_URL    = "https://github.com/sena-design-studio/hs-lp-generator.git"
$INSTALL_DIR = "$env:USERPROFILE\.latigid\hs-lp-generator"
$CLAUDE_CONFIG = "$env:APPDATA\Claude\claude_desktop_config.json"
$AUTH_PORTAL = "https://auth.latigid.dev"

function Log   { Write-Host "  [OK] $args" -ForegroundColor Green }
function Warn  { Write-Host "  [!]  $args" -ForegroundColor Yellow }
function Header { Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green; Write-Host "  $args" -ForegroundColor White; Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Green }

Clear-Host
Header "Latigid LP Generator — Setup"
Write-Host "This installer will set up the LP Generator on your PC."
Write-Host "It takes about 2 minutes. You'll need an internet connection.`n"
Read-Host "Press Enter to continue"

# ─── Step 1: Check for Node.js ────────────────────────────────────────────────
Header "Step 1 of 5: Checking dependencies"

$nodeInstalled = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeInstalled) {
    Warn "Node.js not found. Installing via winget..."
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Log "Node.js installed"
} else {
    Log "Node.js found ($((node --version)))"
}

# Check git
$gitInstalled = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitInstalled) {
    Warn "Git not found. Installing..."
    winget install Git.Git --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Log "Git installed"
} else {
    Log "Git found"
}

# ─── Step 2: Install project ──────────────────────────────────────────────────
Header "Step 2 of 5: Installing LP Generator"

$latigidDir = "$env:USERPROFILE\.latigid"
if (-not (Test-Path $latigidDir)) { New-Item -ItemType Directory -Path $latigidDir | Out-Null }

if (Test-Path $INSTALL_DIR) {
    Warn "Previous installation found. Updating..."
    Set-Location $INSTALL_DIR
    git pull --quiet
    Log "Updated to latest version"
} else {
    git clone --quiet $REPO_URL $INSTALL_DIR
    Log "Project installed to $INSTALL_DIR"
}

Set-Location $INSTALL_DIR
npm install --quiet
Log "Dependencies installed"

# ─── Step 3: Create .env ──────────────────────────────────────────────────────
Header "Step 3 of 5: Configuring environment"

$envFile = "$INSTALL_DIR\.env"
if (-not (Test-Path $envFile)) {
    @"
# Latigid LP Generator — Environment Configuration
HS_CLIENT_ID=1071c471-d9d3-48e6-9c00-566801d5132c
HS_REDIRECT_URI=http://localhost:3000/oauth/callback
HS_SCOPES=content forms oauth cms.domains.read cms.domains.write cms.functions.read cms.functions.write cms.knowledge_base.articles.publish cms.knowledge_base.articles.read cms.knowledge_base.articles.write cms.knowledge_base.settings.read cms.knowledge_base.settings.write cms.membership.access_groups.read cms.membership.access_groups.write cms.performance.read files files.ui_hidden.read ctas.read
REMOTE_AUTH_URL=https://auth.latigid.dev
AUTH_SECRET=REPLACE_WITH_SHARED_SECRET
PEXELS_API_KEY=apdLrgHDvp6MjgeJSE2mmmQ3ddZYnjKIKnwCh2e8rul6hvE5yh5BtGZw
ANTHROPIC_API_KEY=REPLACE_WITH_YOUR_KEY
"@ | Set-Content $envFile
    Log ".env created"
} else {
    Log ".env already exists — skipping"
}

# ─── Step 4: Register with Claude Desktop ─────────────────────────────────────
Header "Step 4 of 5: Registering with Claude Desktop"

$claudeDir = Split-Path $CLAUDE_CONFIG
if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir | Out-Null }

$nodePath = (Get-Command node).Source
$installDirForward = $INSTALL_DIR.Replace("\", "/")

if (Test-Path $CLAUDE_CONFIG) {
    $config = Get-Content $CLAUDE_CONFIG -Raw | ConvertFrom-Json
} else {
    $config = [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} }
}

if (-not $config.PSObject.Properties['mcpServers']) {
    $config | Add-Member -MemberType NoteProperty -Name 'mcpServers' -Value ([PSCustomObject]@{})
}

$serverConfig = [PSCustomObject]@{
    command = $nodePath
    args    = @("$INSTALL_DIR\index.js")
}

$config.mcpServers | Add-Member -MemberType NoteProperty -Name 'hs-lp-generator' -Value $serverConfig -Force
$config | ConvertTo-Json -Depth 10 | Set-Content $CLAUDE_CONFIG
Log "Claude Desktop config updated"

# ─── Step 5: Open auth portal ─────────────────────────────────────────────────
Header "Step 5 of 5: Connect your HubSpot account"

Write-Host "The LP Generator is installed and ready."
Write-Host "The last step is to connect your HubSpot account."
Write-Host "A browser window will open — log in and click Authorise.`n"
Read-Host "Press Enter to open the HubSpot connection page"
Start-Process $AUTH_PORTAL

# ─── Done ─────────────────────────────────────────────────────────────────────
Header "Installation complete!"
Write-Host "  1. Restart Claude Desktop"
Write-Host "  2. Look for the connector icon in the chat input"
Write-Host "  3. Start generating landing pages`n"
Write-Host "  If you need help: filipe@latigid.pt`n"
Read-Host "Press Enter to close"
