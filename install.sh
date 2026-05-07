#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Latigid LP Generator — Installer
# ─────────────────────────────────────────────────────────────────────────────
#  Single source of truth. Used by three entry points:
#    - bash install.sh                            (CLI / advanced users)
#    - curl -sL <raw>/install.sh | bash           (one-liner)
#    - LP-Generator-Installer.pkg                 (bundles + runs this script)
#
#  Idempotent: any prior install at ~/.latigid/hs-lp-generator is wiped clean.
# ─────────────────────────────────────────────────────────────────────────────

set -e

# ─── Constants ────────────────────────────────────────────────────────────────
REPO_URL="https://github.com/sena-design-studio/hs-lp-generator.git"
INSTALL_DIR="$HOME/.latigid/hs-lp-generator"
ENV_FILE="$INSTALL_DIR/.env"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

# HubSpot OAuth app — pinned. Bump these when migrating to a new app.
HS_APP_ID="37936322"
HS_CLIENT_ID="891cdadd-e450-44b7-9c36-c6e0166e7825"

# Node.js LTS — pinned. Bump when a newer LTS is preferred.
NODE_VERSION="22.12.0"

# ─── Pretty output ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}!${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1" >&2; }
header()  { echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  ${BOLD}$1${NC}"; echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }
section() { echo -e "\n${BOLD}$1${NC}  $2"; }

trap 'error "Install failed at line $LINENO. Press Enter to close."; read -r _; exit 1' ERR

clear
header "Latigid LP Generator — Installer"

# ─── Step 1: Xcode Command Line Tools (gives us git) ──────────────────────────
section "[1/8]" "Checking Xcode Command Line Tools..."

if ! xcode-select -p &>/dev/null; then
  warn "Xcode Command Line Tools missing — Apple's installer will open."
  echo "  Click 'Install' in the dialog. This takes 5–10 minutes."
  echo "  Once it finishes, re-run this installer."
  echo ""
  xcode-select --install 2>/dev/null || true
  read -r -p "  Press Enter to close..." _
  exit 1
fi
if ! command -v git &>/dev/null; then
  error "Git not found despite Xcode CLI tools being installed."
  error "Run:  sudo xcode-select --reset && xcode-select --install"
  exit 1
fi
log "Git $(git --version | awk '{print $3}')"

# ─── Step 2: Node.js (auto-install if missing) ────────────────────────────────
section "[2/8]" "Checking Node.js..."

install_node_via_pkg() {
  local PKG_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.pkg"
  local PKG_PATH="/tmp/node-v${NODE_VERSION}.pkg"
  echo "  Downloading Node.js v${NODE_VERSION} from nodejs.org..."
  if ! curl -fL --silent --show-error -o "$PKG_PATH" "$PKG_URL"; then
    error "Download failed. Check your internet connection."
    return 1
  fi
  echo "  Installing — your Mac password will be requested..."
  if ! sudo installer -pkg "$PKG_PATH" -target /; then
    error "Node.js install failed."
    rm -f "$PKG_PATH"
    return 1
  fi
  rm -f "$PKG_PATH"
  export PATH="/usr/local/bin:$PATH"
}

if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing now."
  if command -v brew &>/dev/null; then
    echo "  Homebrew detected — installing via brew (no password needed)..."
    if ! brew install node --quiet; then
      warn "Homebrew install failed — falling back to official .pkg installer."
      install_node_via_pkg || exit 1
    fi
  else
    install_node_via_pkg || exit 1
  fi
  if ! command -v node &>/dev/null; then
    error "Node.js still not detected. Restart Terminal and re-run the installer."
    exit 1
  fi
fi
log "Node.js $(node -v)"

# ─── Step 3: Wipe any prior install ───────────────────────────────────────────
section "[3/8]" "Preparing install directory..."

if [ -d "$INSTALL_DIR" ]; then
  warn "Existing install found at $INSTALL_DIR — removing for clean reinstall."
  rm -rf "$INSTALL_DIR"
  log "Old install removed"
fi
mkdir -p "$(dirname "$INSTALL_DIR")"

# ─── Step 4: Clone fresh + npm install ────────────────────────────────────────
section "[4/8]" "Downloading latest version..."

git clone --quiet "$REPO_URL" "$INSTALL_DIR"
log "Repository cloned"

(cd "$INSTALL_DIR" && npm install --quiet)
log "Node dependencies installed"

# ─── Step 5: Credentials ──────────────────────────────────────────────────────
section "[5/8]" "Configure credentials..."

echo ""
echo -e "  ${BOLD}Anthropic API key${NC}  (personal — get one from console.anthropic.com)"
echo "  Used by analyse_wireframe and web_search tools."
printf "  > "
read -r ANTHROPIC_KEY
if [[ "$ANTHROPIC_KEY" != sk-ant-* ]]; then
  warn "Key doesn't start with sk-ant- — saving anyway, edit .env later if wrong."
fi

echo ""
echo -e "  ${BOLD}HubSpot Client Secret${NC}  (paste the value Filipe sent you on Slack)"
printf "  > "
read -r HS_CLIENT_SECRET

echo ""
echo -e "  ${BOLD}Auth Secret${NC}  (paste the value Filipe sent you on Slack)"
printf "  > "
read -r AUTH_SECRET

if [ -z "$HS_CLIENT_SECRET" ] || [ -z "$AUTH_SECRET" ]; then
  error "Both shared secrets are required."
  error "Ask Filipe to re-send them, then run the installer again."
  exit 1
fi

# ─── Step 6: OneDrive folder ──────────────────────────────────────────────────
section "[6/8]" "Detecting OneDrive folder..."

ONEDRIVE_PATH=""

# Auto-detect: try the common paths first
for candidate in \
  "$HOME/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents" \
  "$HOME/OneDrive - LATIGID LDA/MCP Claude - Documents" \
  "$HOME/OneDrive/MCP Claude - Documents"; do
  if [ -d "$candidate" ]; then
    ONEDRIVE_PATH="$candidate"
    log "Found: $ONEDRIVE_PATH"
    break
  fi
done

# Glob fallback: any OneDrive-<tenant>/MCP Claude - Documents under CloudStorage
if [ -z "$ONEDRIVE_PATH" ]; then
  for candidate in "$HOME"/Library/CloudStorage/OneDrive-*/"MCP Claude - Documents"; do
    if [ -d "$candidate" ]; then
      ONEDRIVE_PATH="$candidate"
      log "Found: $ONEDRIVE_PATH"
      break
    fi
  done
fi

# Manual entry fallback
if [ -z "$ONEDRIVE_PATH" ]; then
  warn "OneDrive folder not auto-detected."
  echo "  Drag your 'MCP Claude - Documents' folder from Finder into this Terminal,"
  echo "  then press Enter:"
  printf "  > "
  read -r raw_path

  # Drag-from-Finder produces backslash-escaped paths (e.g. MCP\ Claude\ -\ Documents).
  # Strip surrounding whitespace/quotes, then unescape any \<char> sequences.
  trimmed=$(echo "$raw_path" | sed "s/^[[:space:]'\"]*//;s/[[:space:]'\"]*$//")
  ONEDRIVE_PATH=$(printf '%s' "$trimmed" | sed 's/\\\(.\)/\1/g')

  if [ ! -d "$ONEDRIVE_PATH" ]; then
    error "Folder not found: $ONEDRIVE_PATH"
    error "  (raw input: $raw_path)"
    error "If OneDrive is fully synced, copy the path from Finder → Get Info"
    error "and paste it instead of dragging."
    exit 1
  fi
  log "OneDrive path set"
fi

# Symlink the shared folders into the install dir
for f in lp-theme-generic lp-theme-programme email-template-generic generated-themes generated-email-templates client-images; do
  LINK="$INSTALL_DIR/$f"
  TARGET="$ONEDRIVE_PATH/$f"
  if [ -L "$LINK" ] || [ -e "$LINK" ]; then rm -rf "$LINK"; fi
  if [ -d "$TARGET" ]; then
    ln -s "$TARGET" "$LINK"
    log "Linked $f → OneDrive"
  else
    warn "$f not in OneDrive yet — re-run the installer after sync completes"
  fi
done

# ─── Step 7: Write .env + configure Claude Desktop ────────────────────────────
section "[7/8]" "Writing configuration..."

cat > "$ENV_FILE" <<EOF
# Latigid LP Generator — Environment Configuration
# Auto-generated by install.sh

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
EOF
chmod 600 "$ENV_FILE"
log ".env written"

mkdir -p "$(dirname "$CLAUDE_CONFIG")"
[ -f "$CLAUDE_CONFIG" ] && cp "$CLAUDE_CONFIG" "$CLAUDE_CONFIG.bak" && log "Backed up existing Claude config"

node -e "
const fs = require('fs');
const p = process.argv[1];
let c = {};
try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
c.mcpServers = c.mcpServers || {};
c.mcpServers['hs-lp-generator'] = { command: 'node', args: ['$INSTALL_DIR/index.js'] };
fs.writeFileSync(p, JSON.stringify(c, null, 2));
" "$CLAUDE_CONFIG"
log "Claude Desktop configured"

if (cd "$INSTALL_DIR" && node --check index.js 2>/dev/null); then
  log "index.js syntax OK"
else
  warn "index.js failed syntax check — tell Filipe"
fi

# ─── Step 8: Restart Claude Desktop ───────────────────────────────────────────
section "[8/8]" "Restarting Claude Desktop..."

if pgrep -x "Claude" >/dev/null; then
  osascript -e 'tell application "Claude" to quit' 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x "Claude" >/dev/null || break
    sleep 1
  done
  pkill -x "Claude" 2>/dev/null || true
  sleep 1
  log "Claude Desktop quit"
else
  log "Claude Desktop wasn't running"
fi

if open -a "Claude" 2>/dev/null; then
  log "Claude Desktop launched"
else
  warn "Could not auto-launch Claude — open it manually from Applications."
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Installation complete 🎉"

echo -e "  ${BOLD}Final step:${NC} Connect your HubSpot portal."
echo ""
echo -e "  1. Visit: ${GREEN}https://auth.latigid.dev${NC}"
echo "     Click 'Connect HubSpot Portal' for each portal you need."
echo ""
echo -e "  2. In Claude Desktop, ask:"
echo -e "     ${GREEN}\"List the themes in portal 2662575\"${NC}"
echo ""
echo -e "  ${BOLD}Available tools:${NC}"
echo "    list_themes         get_forms           generate_lp"
echo "    upload_theme        create_page         update_page"
echo "    get_page            update_page_content upload_image"
echo "    scan_images         search_stock_image  analyse_wireframe"
echo "    web_search          write_file"
echo "    list_emails         get_email           create_email"
echo "    update_email_content"
echo ""
read -r -p "  Press Enter to close..." _
