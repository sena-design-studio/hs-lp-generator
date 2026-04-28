#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Latigid LP Generator — Installer
# ─────────────────────────────────────────────────────────────────────────────
#  Distributed separately (Slack/Drive) — not via git clone.
#  Safe to re-run: every step is idempotent.
# ─────────────────────────────────────────────────────────────────────────────

set -e

REPO_URL="https://github.com/sena-design-studio/hs-lp-generator.git"
INSTALL_DIR="$HOME/.latigid/hs-lp-generator"
ENV_FILE="$INSTALL_DIR/.env"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

# ─── Pretty output ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}!${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1" >&2; }
header()  { echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  ${BOLD}$1${NC}"; echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }
section() { echo -e "\n${BOLD}$1${NC}  $2"; }

trap 'error "Install failed at line $LINENO. See output above for details."' ERR

clear
header "Latigid LP Generator — Installer"

# ─── Step 1: Requirements ─────────────────────────────────────────────────────
section "[1/6]" "Checking requirements..."

if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org and re-run."
  exit 1
fi
log "Node.js $(node -v)"

if ! command -v git &>/dev/null; then
  error "Git not found. Run: xcode-select --install"
  exit 1
fi
log "Git $(git --version | awk '{print $3}')"

# ─── Step 2: Clone or update ──────────────────────────────────────────────────
section "[2/6]" "Installing MCP server..."

mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Existing install found — pulling latest..."
  (cd "$INSTALL_DIR" && git pull --quiet origin main)
  log "Pulled latest"
else
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  log "Repository cloned to $INSTALL_DIR"
fi

(cd "$INSTALL_DIR" && npm install --quiet)
log "Node dependencies installed"

# ─── Step 3: Anthropic API key ────────────────────────────────────────────────
section "[3/6]" "Anthropic API key"

# Reuse existing key if already configured
EXISTING_KEY=""
if [ -f "$ENV_FILE" ]; then
  EXISTING_KEY=$(grep -E '^ANTHROPIC_API_KEY=' "$ENV_FILE" | sed 's/^ANTHROPIC_API_KEY=//' || true)
fi

if [ -n "$EXISTING_KEY" ] && [[ "$EXISTING_KEY" == sk-ant-* ]]; then
  log "Existing Anthropic key found in .env — keeping it"
  ANTHROPIC_KEY="$EXISTING_KEY"
else
  echo "  You need a personal Anthropic API key (used by analyse_wireframe + web_search)."
  echo "  This keeps your usage separate from the rest of the team."
  echo ""
  echo "  1. Open: https://console.anthropic.com/settings/keys"
  echo "  2. Create a key, name it 'LP Generator'"
  echo "  3. Copy the key (starts with sk-ant-)"
  echo "  4. Paste below and press Enter"
  echo ""
  printf "  Anthropic API key: "
  read -r ANTHROPIC_KEY
  if [[ "$ANTHROPIC_KEY" != sk-ant-* ]]; then
    warn "Key doesn't start with sk-ant- — saving anyway, edit $ENV_FILE later if wrong."
  fi
fi

# ─── Step 4: OneDrive detection ───────────────────────────────────────────────
section "[4/6]" "Detecting shared OneDrive folder..."

ONEDRIVE_PATH=""
# Reuse existing setting if it's still valid
if [ -f "$ENV_FILE" ]; then
  EXISTING_OD=$(grep -E '^ONEDRIVE_PATH=' "$ENV_FILE" | sed 's/^ONEDRIVE_PATH=//' || true)
  if [ -n "$EXISTING_OD" ] && [ -d "$EXISTING_OD" ]; then
    ONEDRIVE_PATH="$EXISTING_OD"
    log "Reusing existing OneDrive path: $ONEDRIVE_PATH"
  fi
fi

# Auto-detect if not reused
if [ -z "$ONEDRIVE_PATH" ]; then
  for candidate in \
    "$HOME/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents" \
    "$HOME/OneDrive - LATIGID LDA/MCP Claude - Documents" \
    "$HOME/OneDrive/MCP Claude - Documents"; do
    if [ -d "$candidate" ]; then
      echo -e "  Found: ${BOLD}$candidate${NC}"
      read -p "  Use this folder? [Y/n] " confirm
      if [[ "${confirm:-Y}" =~ ^[Yy]$ ]]; then
        ONEDRIVE_PATH="$candidate"
        break
      fi
    fi
  done
fi

# Manual entry fallback
if [ -z "$ONEDRIVE_PATH" ]; then
  warn "OneDrive folder not found automatically."
  echo "  Drag your 'MCP Claude - Documents' folder from Finder into this Terminal,"
  echo "  then press Enter:"
  printf "  > "
  read -r raw_path
  ONEDRIVE_PATH=$(echo "$raw_path" | sed "s/^[[:space:]'\"]*//;s/[[:space:]'\"]*$//")
  if [ ! -d "$ONEDRIVE_PATH" ]; then
    error "Folder not found: $ONEDRIVE_PATH"
    error "Make sure OneDrive is synced and re-run the installer."
    exit 1
  fi
fi
log "OneDrive path: $ONEDRIVE_PATH"

# Warn about missing subfolders (non-fatal — they may still be syncing)
MISSING=()
for f in lp-theme-generic lp-theme-programme client-images generated-themes; do
  [ -d "$ONEDRIVE_PATH/$f" ] || MISSING+=("$f")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  warn "Missing subfolders (OneDrive may still be syncing): ${MISSING[*]}"
fi

# Recreate symlinks (idempotent)
for f in lp-theme-generic lp-theme-programme generated-themes client-images; do
  LINK="$INSTALL_DIR/$f"
  TARGET="$ONEDRIVE_PATH/$f"
  if [ -L "$LINK" ] || [ -e "$LINK" ]; then rm -rf "$LINK"; fi
  if [ -d "$TARGET" ]; then
    ln -s "$TARGET" "$LINK"
    log "Linked $f → OneDrive"
  fi
done

# ─── Step 5: Write .env ───────────────────────────────────────────────────────
section "[5/6]" "Writing $ENV_FILE..."

# Preserve existing secrets if already set; otherwise placeholder
HS_CLIENT_SECRET="REPLACE_WITH_SECRET"
AUTH_SECRET="REPLACE_WITH_SECRET"
if [ -f "$ENV_FILE" ]; then
  EXISTING_HS=$(grep -E '^HS_CLIENT_SECRET=' "$ENV_FILE" | sed 's/^HS_CLIENT_SECRET=//' || true)
  EXISTING_AUTH=$(grep -E '^AUTH_SECRET=' "$ENV_FILE" | sed 's/^AUTH_SECRET=//' || true)
  [ -n "$EXISTING_HS" ]   && HS_CLIENT_SECRET="$EXISTING_HS"
  [ -n "$EXISTING_AUTH" ] && AUTH_SECRET="$EXISTING_AUTH"
fi

cat > "$ENV_FILE" <<EOF
# Latigid LP Generator — Environment Configuration
# Auto-generated by installer. Do not edit unless instructed.

# HubSpot OAuth App (shared)
HS_APP_ID=37936322
HS_CLIENT_ID=891cdadd-e450-44b7-9c36-c6e0166e7825
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
log ".env written ($(wc -l < "$ENV_FILE" | tr -d ' ') lines)"

# ─── Step 6: Claude Desktop config ────────────────────────────────────────────
section "[6/6]" "Configuring Claude Desktop..."

mkdir -p "$(dirname "$CLAUDE_CONFIG")"
[ -f "$CLAUDE_CONFIG" ] && cp "$CLAUDE_CONFIG" "$CLAUDE_CONFIG.bak" && log "Backed up existing Claude config"

node -e "
const fs = require('fs');
const configPath = process.argv[1];
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
config.mcpServers = config.mcpServers || {};
config.mcpServers['hs-lp-generator'] = {
  command: 'node',
  args: ['$INSTALL_DIR/index.js']
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
" "$CLAUDE_CONFIG"
log "Claude Desktop configured"

# ─── Final validation ─────────────────────────────────────────────────────────
section "Validation" "Syntax-checking server..."
if (cd "$INSTALL_DIR" && node --check index.js 2>/dev/null); then
  log "index.js syntax OK"
else
  warn "index.js failed syntax check — try running the installer again"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Installation complete 🎉"

NEEDS_SECRETS=0
[ "$HS_CLIENT_SECRET" = "REPLACE_WITH_SECRET" ] && NEEDS_SECRETS=1
[ "$AUTH_SECRET" = "REPLACE_WITH_SECRET" ]      && NEEDS_SECRETS=1

if [ "$NEEDS_SECRETS" -eq 1 ]; then
  echo "  ${BOLD}Next steps:${NC}"
  echo ""
  echo "  1. ${BOLD}Get the shared secrets from Filipe (Slack)${NC} and update:"
  echo "     $ENV_FILE"
  echo "     Fill in: HS_CLIENT_SECRET and AUTH_SECRET"
  echo ""
  echo "  2. ${BOLD}Restart Claude Desktop${NC} (Cmd+Q, then reopen)"
  echo ""
  echo "  3. ${BOLD}Connect HubSpot${NC} — ask Claude:"
  echo -e "     ${GREEN}\"List the themes in portal 2662575\"${NC}"
  echo "     Claude will open the auth page automatically."
else
  echo -e "  ${BOLD}Restart Claude Desktop${NC} (Cmd+Q, then reopen) to load the changes."
fi

echo ""
echo "  ${BOLD}Available tools:${NC} list_themes, get_forms, generate_lp, upload_theme,"
echo "  create_page, update_page, get_page, update_page_content, upload_image,"
echo "  scan_images, search_stock_image, analyse_wireframe, web_search, write_file,"
echo "  list_emails, get_email, create_email, update_email_content"
echo ""
read -p "  Press Enter to close..."
