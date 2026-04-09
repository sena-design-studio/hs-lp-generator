#!/bin/bash

# ─── hs-lp-generator updater ──────────────────────────────────────────────────
# Double-click to pull the latest version from GitHub.

INSTALL_DIR="$HOME/.latigid/hs-lp-generator"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()    { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}!${NC} $1"; }
header() { echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  $1"; echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

clear
header "Latigid LP Generator — Update"

if [ ! -d "$INSTALL_DIR" ]; then
  echo "LP Generator not found. Please run the installer first."
  exit 1
fi

cd "$INSTALL_DIR"

# Check current version
CURRENT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
log "Current version: $CURRENT"

# Pull latest
echo "Checking for updates..."
git fetch --quiet origin main 2>/dev/null

LATEST=$(git rev-parse --short origin/main 2>/dev/null || echo "unknown")

if [ "$CURRENT" = "$LATEST" ]; then
  log "Already up to date."
else
  warn "Update available ($CURRENT → $LATEST). Updating..."
  git pull --quiet origin main
  npm install --quiet
  log "Updated to latest version ($LATEST)"
fi

header "Done!"
echo "  Restart Claude Desktop (Cmd+Q, then reopen) to load the changes."
echo ""
read -p "Press Enter to close..."
