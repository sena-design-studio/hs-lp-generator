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

# ─── Self-heal symlinks ───────────────────────────────────────────────────────
# When new shared OneDrive folders are added in code (e.g. email-template-generic),
# existing installs need the symlinks created on update. install.sh creates them
# on first install; this block ensures parity for already-installed users.

# Resolve OneDrive path from .env, else best-effort auto-detect
ONEDRIVE_PATH=""
if [ -f "$INSTALL_DIR/.env" ]; then
  ONEDRIVE_PATH=$(grep -E '^ONEDRIVE_PATH=' "$INSTALL_DIR/.env" | sed 's/^ONEDRIVE_PATH=//')
fi
if [ -z "$ONEDRIVE_PATH" ]; then
  for candidate in \
    "$HOME/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents" \
    "$HOME/OneDrive - LATIGID LDA/MCP Claude - Documents" \
    "$HOME/OneDrive/MCP Claude - Documents"; do
    if [ -d "$candidate" ]; then ONEDRIVE_PATH="$candidate"; break; fi
  done
fi

if [ -n "$ONEDRIVE_PATH" ] && [ -d "$ONEDRIVE_PATH" ]; then
  created_any=0
  for f in lp-theme-generic lp-theme-programme email-template-generic generated-themes generated-email-templates client-images; do
    LINK="$INSTALL_DIR/$f"
    TARGET="$ONEDRIVE_PATH/$f"
    # Skip if a working symlink/dir is already present
    if [ -e "$LINK" ]; then continue; fi
    if [ -d "$TARGET" ]; then
      ln -s "$TARGET" "$LINK"
      log "Linked missing folder: $f"
      created_any=1
    fi
  done
  [ $created_any -eq 0 ] && log "All shared folders already linked"
else
  warn "OneDrive path not found — skipping symlink self-heal. If the MCP fails to start, run install.sh again."
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
