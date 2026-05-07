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

# ─── Self-heal config (.env + symlinks) ──────────────────────────────────────
# Two failure modes this block fixes:
#   1. New shared OneDrive folder added in code (e.g. email-template-generic)
#      that existing installs don't have a symlink for.
#   2. .env or symlinks were copied from another user's machine — paths point
#      to /Users/<someone-else>/... and never resolve on this Mac. Validate
#      that ONEDRIVE_PATH (and every symlink target) lives under $HOME, and
#      rebuild anything that doesn't.

ENV_FILE="$INSTALL_DIR/.env"
ONEDRIVE_PATH=""

if [ -f "$ENV_FILE" ]; then
  ONEDRIVE_PATH=$(grep -E '^ONEDRIVE_PATH=' "$ENV_FILE" | sed 's/^ONEDRIVE_PATH=//')
fi

# Validate the .env-supplied path: must be inside $HOME AND exist
ONEDRIVE_VALID=0
if [ -n "$ONEDRIVE_PATH" ]; then
  case "$ONEDRIVE_PATH" in
    "$HOME"/*)
      if [ -d "$ONEDRIVE_PATH" ]; then
        ONEDRIVE_VALID=1
      else
        warn "ONEDRIVE_PATH from .env points to a non-existent folder ($ONEDRIVE_PATH) — re-detecting"
      fi
      ;;
    *)
      warn "ONEDRIVE_PATH from .env points outside your home ($ONEDRIVE_PATH) — looks like the .env was copied from another user. Re-detecting."
      ;;
  esac
fi

# Re-detect via the same candidates install.sh uses
if [ $ONEDRIVE_VALID -eq 0 ]; then
  ONEDRIVE_PATH=""
  for candidate in \
    "$HOME/Library/CloudStorage/OneDrive-LATIGIDLDA/MCP Claude - Documents" \
    "$HOME/OneDrive - LATIGID LDA/MCP Claude - Documents" \
    "$HOME/OneDrive/MCP Claude - Documents"; do
    if [ -d "$candidate" ]; then ONEDRIVE_PATH="$candidate"; break; fi
  done
  if [ -z "$ONEDRIVE_PATH" ]; then
    for candidate in "$HOME"/Library/CloudStorage/OneDrive-*/"MCP Claude - Documents"; do
      if [ -d "$candidate" ]; then ONEDRIVE_PATH="$candidate"; break; fi
    done
  fi
fi

# Rewrite .env so subsequent runs (and the MCP itself, which reads it on every
# call) pick up the corrected path
if [ -n "$ONEDRIVE_PATH" ] && [ -f "$ENV_FILE" ]; then
  CURRENT_IN_ENV=$(grep -E '^ONEDRIVE_PATH=' "$ENV_FILE" | sed 's/^ONEDRIVE_PATH=//')
  if [ "$CURRENT_IN_ENV" != "$ONEDRIVE_PATH" ]; then
    if grep -q '^ONEDRIVE_PATH=' "$ENV_FILE"; then
      sed -i.bak "s|^ONEDRIVE_PATH=.*|ONEDRIVE_PATH=$ONEDRIVE_PATH|" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
    else
      echo "ONEDRIVE_PATH=$ONEDRIVE_PATH" >> "$ENV_FILE"
    fi
    log "Corrected .env: ONEDRIVE_PATH=$ONEDRIVE_PATH"
  fi
fi

# Validate + rebuild symlinks
if [ -n "$ONEDRIVE_PATH" ] && [ -d "$ONEDRIVE_PATH" ]; then
  rebuilt_any=0
  created_any=0
  for f in lp-theme-generic lp-theme-programme email-template-generic generated-themes generated-email-templates client-images; do
    LINK="$INSTALL_DIR/$f"
    TARGET="$ONEDRIVE_PATH/$f"

    # If existing symlink points outside $HOME, kill it
    if [ -L "$LINK" ]; then
      CURRENT_TARGET=$(readlink "$LINK")
      case "$CURRENT_TARGET" in
        "$HOME"/*) : ;;  # within home — keep
        *)
          warn "Symlink $f points outside your home ($CURRENT_TARGET) — rebuilding"
          rm -f "$LINK"
          rebuilt_any=1
          ;;
      esac
    fi

    # Create if missing
    if [ ! -e "$LINK" ] && [ -d "$TARGET" ]; then
      ln -s "$TARGET" "$LINK"
      log "Linked: $f → $TARGET"
      created_any=1
    fi
  done
  if [ $rebuilt_any -eq 0 ] && [ $created_any -eq 0 ]; then
    log "All shared folders already linked correctly"
  fi
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
