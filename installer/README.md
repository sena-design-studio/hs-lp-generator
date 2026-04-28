# Installer Build Kit

Builds `LP-Generator-Installer.pkg` — a native macOS installer for the LP Generator MCP server.

## Building (one-time, on your Mac)

From the repo root:

```bash
bash installer/build.sh
```

Output: `installer/dist/LP-Generator-Installer.pkg` (~10 KB).

Requires `pkgbuild` and `productbuild` (built into macOS — install Xcode Command Line Tools if missing: `xcode-select --install`).

## Distributing

Send the `.pkg` to a teammate via Slack/Drive, plus their two shared secrets:

- **HubSpot Client Secret** — from HubSpot Developer Account → app `37936322` → Auth tab
- **Auth Secret** — the random string shared between local installs and `auth.latigid.dev`

They double-click the `.pkg`, click through the macOS Installer dialogs, then enter their three credentials in the Terminal window that opens.

## What the installer does

1. **Preinstall (root):** wipes any prior install at `~/.latigid/hs-lp-generator`
2. **Payload:** drops `install.sh` into `/private/var/tmp/lp-generator-installer/`
3. **Postinstall (root → user):** opens Terminal as the actual user and runs `install.sh`
4. **`install.sh` (user, in Terminal):**
   - Checks for Xcode CLI tools (triggers Apple's installer if missing, aborts with retry message)
   - Checks for Node.js (auto-installs via Homebrew if available, falls back to the official `.pkg`)
   - Clones the latest version from GitHub
   - Prompts for Anthropic API key, HubSpot Client Secret, Auth Secret
   - Detects (or asks for) the OneDrive folder
   - Symlinks shared folders (`lp-theme-generic`, `lp-theme-programme`, `client-images`, `generated-themes`)
   - Writes `.env` and `claude_desktop_config.json`
   - Validates `index.js` with `node --check`
   - Quits and relaunches Claude Desktop

## Gatekeeper note

The `.pkg` is unsigned. The first time a teammate opens it, they get a "can't be opened because Apple cannot check it for malicious software" warning.

To bypass: **right-click → Open** → click **Open** in the dialog. Once per teammate per `.pkg` version.

To produce a signed `.pkg` (no warning), you'd need an Apple Developer ID ($99/yr) and to add `--sign "Developer ID Installer: <name>"` to the `productbuild` call in `build.sh`.

## When to rebuild the .pkg

Only when `install.sh` itself changes. The `.pkg` bundles a snapshot of `install.sh` at build time. The MCP server code (which `install.sh` clones from GitHub) updates independently — a teammate doesn't need a new `.pkg` just because the server code shipped a new tool.

Rebuild when:
- HubSpot OAuth app credentials change (`HS_APP_ID` / `HS_CLIENT_ID` are pinned in `install.sh`)
- The install flow itself changes (new prompts, new dependencies, etc.)
- Pinned Node version is bumped

## Files

```
installer/
├── README.md                         ← this file
├── build.sh                          ← run on Mac to produce the .pkg
├── pkg-resources/
│   ├── Distribution.xml              ← installer GUI definition
│   ├── welcome.html                  ← shown before install
│   ├── conclusion.html               ← shown after install
│   └── scripts/
│       ├── preinstall                ← wipes prior install (runs as root)
│       └── postinstall               ← opens Terminal with install.sh (runs as root)
└── dist/                             ← build output (gitignored)
    └── LP-Generator-Installer.pkg
```
