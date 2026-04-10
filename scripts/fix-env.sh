#!/bin/bash
# ─── Fix .env for teammate machines ───────────────────────────────────────────
# Run this on any machine where auth is failing after install.

ENV_FILE="$HOME/.latigid/hs-lp-generator/.env"

cat > "$ENV_FILE" << 'EOF'
# Latigid LP Generator — Environment Configuration
# These values are pre-configured. Do not edit unless instructed.

# HubSpot OAuth App
HS_APP_ID=34847043
HS_CLIENT_ID=1071c471-d9d3-48e6-9c00-566801d5132c
HS_CLIENT_SECRET=6e639e4a-b9a1-477d-8154-6cbb183913cf
HS_REDIRECT_URI=https://auth.latigid.dev/oauth/callback

# Remote auth server
REMOTE_AUTH_URL=https://auth.latigid.dev
AUTH_SECRET=bdbaaabf50ace8b2413c7649545a142a7b7418edc7e3a4d3f906a89d4837634e

# Pexels API
PEXELS_API_KEY=apdLrgHDvp6MjgeJSE2mmmQ3ddZYnjKIKnwCh2e8rul6hvE5yh5BtGZw
EOF

echo "✓ .env fixed at $ENV_FILE"
echo "  Restart Claude Desktop to apply changes."
