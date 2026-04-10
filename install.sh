#!/bin/bash

# ─── hs-lp-generator installer ────────────────────────────────────────────────
REPO_URL="https://github.com/sena-design-studio/hs-lp-generator.git"
INSTALL_DIR="$HOME/.latigid/hs-lp-generator"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}!${NC} $1"; }
header() { echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  $1"; echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

clear
header "Latigid LP Generator — Installer"

# ─── Node.js check ────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "Node.js is required. Install from https://nodejs.org and re-run."
  exit 1
fi
log "Node.js $(node -v) found"

# ─── Clone or update repo ─────────────────────────────────────────────────────
mkdir -p "$HOME/.latigid"
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Already installed. Pulling latest..."
  cd "$INSTALL_DIR" && git pull --quiet origin main
else
  log "Cloning repository..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ─── Install dependencies ─────────────────────────────────────────────────────
log "Installing dependencies..."
npm install --quiet
log "Dependencies installed"

# ─── Write .env ───────────────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" << 'EOF'
# Latigid LP Generator — Environment Configuration
HS_APP_ID=34847043
HS_CLIENT_ID=1071c471-d9d3-48e6-9c00-566801d5132c
HS_CLIENT_SECRET=6e639e4a-b9a1-477d-8154-6cbb183913cf
HS_REDIRECT_URI=https://auth.latigid.dev/oauth/callback
REMOTE_AUTH_URL=https://auth.latigid.dev
AUTH_SECRET=bdbaaabf50ace8b2413c7649545a142a7b7418edc7e3a4d3f906a89d4837634e
PEXELS_API_KEY=apdLrgHDvp6MjgeJSE2mmmQ3ddZYnjKIKnwCh2e8rul6hvE5yh5BtGZw
EOF
  log ".env created"
else
  # Patch existing .env to fix redirect URI if still pointing to localhost
  if grep -q "localhost" "$INSTALL_DIR/.env"; then
    warn "Fixing redirect URI in .env (was pointing to localhost)..."
    sed -i '' 's|HS_REDIRECT_URI=http://localhost:3000/oauth/callback|HS_REDIRECT_URI=https://auth.latigid.dev/oauth/callback|g' "$INSTALL_DIR/.env"
    # Also inject AUTH_SECRET if missing
    if ! grep -q "AUTH_SECRET" "$INSTALL_DIR/.env"; then
      echo "AUTH_SECRET=bdbaaabf50ace8b2413c7649545a142a7b7418edc7e3a4d3f906a89d4837634e" >> "$INSTALL_DIR/.env"
    fi
    log ".env patched"
  else
    log ".env already configured"
  fi
fi

# ─── OneDrive symlinks ────────────────────────────────────────────────────────
ONEDRIVE_BASE="$HOME/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents"

if [ -d "$ONEDRIVE_BASE" ]; then
  for folder in "lp-theme-generic" "lp-theme-programme" "generated-themes" "client-images"; do
    LINK="$INSTALL_DIR/$folder"
    TARGET="$ONEDRIVE_BASE/$folder"
    if [ -d "$TARGET" ] && [ ! -e "$LINK" ]; then
      ln -s "$TARGET" "$LINK"
      log "Symlinked $folder → OneDrive"
    elif [ -e "$LINK" ]; then
      log "$folder already linked"
    else
      warn "$folder not found in OneDrive — skipping (sync OneDrive first)"
    fi
  done
else
  warn "OneDrive folder not found. Sync 'MCP Claude - Documents' via OneDrive app first, then re-run."
fi

# ─── Claude Desktop config ────────────────────────────────────────────────────
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CLAUDE_CONFIG")"

if [ -f "$CLAUDE_CONFIG" ]; then
  # Back up existing config
  cp "$CLAUDE_CONFIG" "$CLAUDE_CONFIG.bak"
  warn "Backed up existing Claude config"
fi

node -e "
const fs = require('fs');
const configPath = '$CLAUDE_CONFIG';
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
config.mcpServers = config.mcpServers || {};
config.mcpServers['hs-lp-generator'] = {
  command: 'node',
  args: ['$INSTALL_DIR/index.js']
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Claude Desktop config updated');
"

log "Claude Desktop configured"

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Installation complete!"
echo "  Next steps:"
echo "  1. Make sure 'MCP Claude - Documents' is synced via OneDrive"
echo "  2. Open auth.latigid.dev and connect your HubSpot portal"
echo "  3. Restart Claude Desktop (Cmd+Q, then reopen)"
echo "  4. Ask Claude to list themes to confirm everything works"
echo ""
read -p "Press Enter to close..."
