#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Build LP-Generator-Installer.pkg
# ─────────────────────────────────────────────────────────────────────────────
#  Run on macOS to produce a distributable .pkg installer.
#  Uses pkgbuild + productbuild (built into macOS — no extra tools needed).
#  Output: installer/dist/LP-Generator-Installer.pkg
# ─────────────────────────────────────────────────────────────────────────────

set -e

INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$INSTALLER_DIR/.." && pwd)"
DIST_DIR="$INSTALLER_DIR/dist"

VERSION="1.0.0"
IDENTIFIER="dev.latigid.lp-generator-installer"
INSTALL_LOCATION="/private/var/tmp/lp-generator-installer"

GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
log()   { echo -e "${GREEN}✓${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; }

trap 'error "Build failed at line $LINENO"' ERR

# ─── Sanity checks ────────────────────────────────────────────────────────────
if [ "$(uname)" != "Darwin" ]; then
  error "This build script must run on macOS (pkgbuild/productbuild are macOS-only)."
  exit 1
fi
if ! command -v pkgbuild &>/dev/null || ! command -v productbuild &>/dev/null; then
  error "pkgbuild/productbuild not found. Install Xcode Command Line Tools:"
  error "  xcode-select --install"
  exit 1
fi
if [ ! -f "$REPO_ROOT/install.sh" ]; then
  error "install.sh not found at $REPO_ROOT/install.sh"
  exit 1
fi

echo "Building LP-Generator-Installer.pkg ..."

# ─── Stage payload ────────────────────────────────────────────────────────────
PAYLOAD_DIR="$(mktemp -d)"
trap 'rm -rf "$PAYLOAD_DIR"' EXIT
cp "$REPO_ROOT/install.sh" "$PAYLOAD_DIR/install.sh"
chmod +x "$PAYLOAD_DIR/install.sh"
log "Payload staged"

# ─── Make scripts executable ──────────────────────────────────────────────────
chmod +x "$INSTALLER_DIR/pkg-resources/scripts/preinstall"
chmod +x "$INSTALLER_DIR/pkg-resources/scripts/postinstall"

# ─── Build component .pkg ─────────────────────────────────────────────────────
mkdir -p "$DIST_DIR"
COMPONENT_PKG="$DIST_DIR/component.pkg"
pkgbuild \
  --root "$PAYLOAD_DIR" \
  --scripts "$INSTALLER_DIR/pkg-resources/scripts" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "$INSTALL_LOCATION" \
  "$COMPONENT_PKG" >/dev/null
log "Component package built"

# ─── Build distribution .pkg ──────────────────────────────────────────────────
PKG_OUT="$DIST_DIR/LP-Generator-Installer.pkg"
productbuild \
  --distribution "$INSTALLER_DIR/pkg-resources/Distribution.xml" \
  --resources "$INSTALLER_DIR/pkg-resources" \
  --package-path "$DIST_DIR" \
  "$PKG_OUT" >/dev/null
log "Distribution package built"

rm -f "$COMPONENT_PKG"

echo ""
echo -e "${GREEN}✓${NC} Built: ${BOLD}$PKG_OUT${NC}"
echo ""
echo "  Distribute this file via Slack/Drive."
echo "  Teammates double-click → Installer.app handles the rest."
echo "  (First-time Gatekeeper warning: right-click → Open.)"
