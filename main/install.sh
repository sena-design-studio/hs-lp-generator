#!/bin/bash

# ─── hs-lp-generator installer ────────────────────────────────────────────────
# Run once per machine. Sets up the MCP server and registers it with Claude Desktop.

set -e

REPO_URL="https://github.com/sena-design-studio/hs-lp-generator.git"
INSTALL_DIR="$HOME/.latigid/hs-lp-generator"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
AUTH_PORTAL="https://auth.latigid.dev"

# Colours
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()    { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}!${NC} $1"; }
error()  { echo -e "${RED}✗${NC} $1"; exit 1; }
header() { echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  $1"; echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

clear
header "Latigid LP Generator — Setup"
echo "This installer will set up the LP Generator on your Mac."
echo "It takes about 2 minutes. You'll need an internet connection."
echo ""
read -p "Press Enter to continue, or Ctrl+C to cancel..."

# ─── Step 1: Check for Homebrew ───────────────────────────────────────────────
header "Step 1 of 5: Checking dependencies"

if ! command -v brew &>/dev/null; then
  warn "Homebrew not found. Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add Homebrew to PATH for Apple Silicon
  if [[ -f "/opt/homebrew/bin/brew" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
  log "Homebrew installed"
else
  log "Homebrew found"
fi

# ─── Step 2: Check for Node.js ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  warn "Node.js not found. Installing..."
  brew install node
  log "Node.js installed ($(node --version))"
else
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    warn "Node.js version is too old ($(node --version)). Upgrading..."
    brew upgrade node
  fi
  log "Node.js found ($(node --version))"
fi

# ─── Step 3: Install project ──────────────────────────────────────────────────
header "Step 2 of 5: Installing LP Generator"

if [ -d "$INSTALL_DIR" ]; then
  warn "Previous installation found. Updating..."
  cd "$INSTALL_DIR"
  git pull --quiet
  log "Updated to latest version"
else
  mkdir -p "$HOME/.latigid"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  log "Project installed to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm install --quiet
log "Dependencies installed"

# ─── Step 4: Create .env if it doesn't exist ──────────────────────────────────
header "Step 3 of 5: Configuring environment"

if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" << EOF
# Latigid LP Generator — Environment Configuration
# These values are pre-configured. Do not edit unless instructed.

# HubSpot OAuth App
HS_CLIENT_ID=1071c471-d9d3-48e6-9c00-566801d5132c
HS_REDIRECT_URI=http://localhost:3000/oauth/callback
HS_SCOPES=content forms oauth cms.domains.read cms.domains.write cms.functions.read cms.functions.write cms.knowledge_base.articles.publish cms.knowledge_base.articles.read cms.knowledge_base.articles.write cms.knowledge_base.settings.read cms.knowledge_base.settings.write cms.membership.access_groups.read cms.membership.access_groups.write cms.performance.read files files.ui_hidden.read ctas.read

# Remote auth server
REMOTE_AUTH_URL=https://auth.latigid.dev
AUTH_SECRET=REPLACE_WITH_SHARED_SECRET

# Pexels API
PEXELS_API_KEY=apdLrgHDvp6MjgeJSE2mmmQ3ddZYnjKIKnwCh2e8rul6hvE5yh5BtGZw

# Anthropic API (for wireframe analysis)
ANTHROPIC_API_KEY=REPLACE_WITH_YOUR_KEY
EOF
  log ".env created with default configuration"
else
  log ".env already exists — skipping"
fi

# ─── Step 5: Register with Claude Desktop ─────────────────────────────────────
header "Step 4 of 5: Registering with Claude Desktop"

NODE_PATH=$(which node)
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
mkdir -p "$CLAUDE_DIR"

if [ ! -f "$CLAUDE_CONFIG" ]; then
  # Create fresh config
  cat > "$CLAUDE_CONFIG" << EOF
{
  "mcpServers": {
    "hs-lp-generator": {
      "command": "$NODE_PATH",
      "args": ["$INSTALL_DIR/index.js"]
    }
  }
}
EOF
  log "Claude Desktop config created"
else
  # Config exists — check if hs-lp-generator is already registered
  if grep -q "hs-lp-generator" "$CLAUDE_CONFIG"; then
    # Update the path in case it changed
    python3 - <<PYEOF
import json, sys

config_path = "$CLAUDE_CONFIG"
with open(config_path, 'r') as f:
    config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['hs-lp-generator'] = {
    'command': '$NODE_PATH',
    'args': ['$INSTALL_DIR/index.js']
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print('Updated')
PYEOF
    log "Claude Desktop config updated"
  else
    # Add to existing config
    python3 - <<PYEOF
import json, sys

config_path = "$CLAUDE_CONFIG"
with open(config_path, 'r') as f:
    config = json.load(f)

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['hs-lp-generator'] = {
    'command': '$NODE_PATH',
    'args': ['$INSTALL_DIR/index.js']
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print('Added')
PYEOF
    log "LP Generator added to Claude Desktop config"
  fi
fi

# ─── Step 6: Open auth portal ─────────────────────────────────────────────────
header "Step 5 of 5: Connect your HubSpot account"

echo "The LP Generator is installed and ready."
echo ""
echo "The last step is to connect your HubSpot account."
echo "A browser window will open — log in and click Authorise."
echo ""
read -p "Press Enter to open the HubSpot connection page..."
open "$AUTH_PORTAL"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
header "Installation complete!"
echo "  1. Restart Claude Desktop (Cmd+Q, then reopen)"
echo "  2. Look for the connector icon in the chat input"
echo "  3. Start generating landing pages"
echo ""
echo "  If you need help: filipe@latigid.pt"
echo ""
