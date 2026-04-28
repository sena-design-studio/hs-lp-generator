#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Latigid LP Generator — Updater
# ─────────────────────────────────────────────────────────────────────────────
#  Pulls the latest code, refreshes deps, validates, and shows what changed.
#  Double-click "Update LP Generator.command" to run.
# ─────────────────────────────────────────────────────────────────────────────

set -e

INSTALL_DIR="$HOME/.latigid/hs-lp-generator"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()    { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}!${NC} $1"; }
error()  { echo -e "${RED}✗${NC} $1" >&2; }
header() { echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "  ${BOLD}$1${NC}"; echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

clear
header "Latigid LP Generator — Update"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  error "LP Generator not installed at $INSTALL_DIR"
  error "Run the installer first."
  exit 1
fi

cd "$INSTALL_DIR"

# ─── Check current vs. remote ─────────────────────────────────────────────────
CURRENT=$(git rev-parse --short HEAD)
log "Current version: $CURRENT"

echo "  Checking for updates..."
git fetch --quiet origin main

LATEST=$(git rev-parse --short origin/main)

if [ "$CURRENT" = "$LATEST" ]; then
  log "Already up to date ($CURRENT)"
  echo ""
  read -p "  Press Enter to close..."
  exit 0
fi

# ─── Show changelog before applying ───────────────────────────────────────────
echo ""
echo -e "  ${BOLD}New commits ($CURRENT → $LATEST):${NC}"
git log --oneline --no-decorate "$CURRENT..origin/main" | sed 's/^/    /'
echo ""

# ─── Pull and refresh deps ────────────────────────────────────────────────────
git pull --quiet origin main
log "Pulled to $LATEST"

# Reinstall deps only if package files changed
if git diff --name-only "$CURRENT" "$LATEST" | grep -qE '^(package(-lock)?\.json)$'; then
  echo "  package.json changed — reinstalling dependencies..."
  npm install --quiet
  log "Dependencies refreshed"
else
  log "Dependencies unchanged"
fi

# ─── Validate ─────────────────────────────────────────────────────────────────
if node --check index.js 2>/dev/null; then
  log "index.js syntax OK"
else
  warn "index.js failed syntax check — please report this to Filipe"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Update complete"

echo "  ${BOLD}Restart Claude Desktop${NC} (Cmd+Q, then reopen) to load the changes."
echo ""
read -p "  Press Enter to close..."
