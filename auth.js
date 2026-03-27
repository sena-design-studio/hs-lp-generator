import "dotenv/config";
import express from "express";
import open from "open";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_FILE = path.join(__dirname, ".tokens.json");
const ENV_FILE = path.join(__dirname, ".env");

// ─── Read credentials fresh from .env on every call ──────────────────────────

function getCredentials() {
  const raw = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const env = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
  return {
    HS_CLIENT_ID:     env.HS_CLIENT_ID     || process.env.HS_CLIENT_ID     || "",
    HS_CLIENT_SECRET: env.HS_CLIENT_SECRET || process.env.HS_CLIENT_SECRET || "",
    HS_REDIRECT_URI:  env.HS_REDIRECT_URI  || process.env.HS_REDIRECT_URI  || "",
    HS_SCOPES:        env.HS_SCOPES        || process.env.HS_SCOPES        || "",
    REMOTE_AUTH_URL:  env.REMOTE_AUTH_URL  || process.env.REMOTE_AUTH_URL  || "",
    AUTH_SECRET:      env.AUTH_SECRET      || process.env.AUTH_SECRET      || "",
  };
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(64).toString("base64url");
}

function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── Remote token fetch ───────────────────────────────────────────────────────

async function getTokenFromRemote(portalId) {
  const { REMOTE_AUTH_URL, AUTH_SECRET } = getCredentials();
  if (!REMOTE_AUTH_URL || !AUTH_SECRET) return null;

  try {
    const res = await fetch(`${REMOTE_AUTH_URL}/api/token/${portalId}`, {
      headers: { "x-auth-secret": AUTH_SECRET },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

async function listPortalsFromRemote() {
  const { REMOTE_AUTH_URL, AUTH_SECRET } = getCredentials();
  if (!REMOTE_AUTH_URL || !AUTH_SECRET) return null;

  try {
    const res = await fetch(`${REMOTE_AUTH_URL}/api/portals`, {
      headers: { "x-auth-secret": AUTH_SECRET },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.portals || null;
  } catch {
    return null;
  }
}

// ─── Local token storage (fallback / dev mode) ────────────────────────────────

function loadLocalTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch { return {}; }
}

function saveLocalToken(portalId, tokenData) {
  const tokens = loadLocalTokens();
  tokens[String(portalId)] = { ...tokenData, saved_at: Date.now() };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function getLocalToken(portalId) {
  return loadLocalTokens()[String(portalId)] || null;
}

// ─── Main: get valid access token ────────────────────────────────────────────

export async function getValidAccessToken(portalId) {
  // Try remote server first
  const remoteToken = await getTokenFromRemote(portalId);
  if (remoteToken) return remoteToken;

  // Fall back to local .tokens.json (dev mode)
  const token = getLocalToken(portalId);
  if (!token) {
    const { REMOTE_AUTH_URL } = getCredentials();
    const authUrl = REMOTE_AUTH_URL || "the auth portal";
    throw new Error(`Portal ${portalId} not connected. Visit ${authUrl} to connect.`);
  }

  const ageMs = Date.now() - token.saved_at;
  const expiresMs = (token.expires_in || 1800) * 1000;
  const isExpired = ageMs > expiresMs - 60_000;

  if (isExpired) {
    console.error(`[auth] Local token expired for portal ${portalId}, refreshing...`);
    return await refreshLocalToken(portalId);
  }

  return token.access_token;
}

export async function listAuthorisedPortals() {
  // Try remote first
  const remote = await listPortalsFromRemote();
  if (remote) return remote;

  // Fall back to local
  return Object.keys(loadLocalTokens());
}

// ─── Local token refresh (fallback) ──────────────────────────────────────────

async function refreshLocalToken(portalId) {
  const token = getLocalToken(portalId);
  if (!token?.refresh_token) throw new Error(`No refresh token for portal ${portalId}.`);

  const { HS_CLIENT_ID, HS_CLIENT_SECRET, HS_REDIRECT_URI } = getCredentials();

  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     HS_CLIENT_ID,
      client_secret: HS_CLIENT_SECRET,
      redirect_uri:  HS_REDIRECT_URI,
      refresh_token: token.refresh_token,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const refreshed = await res.json();
  saveLocalToken(portalId, refreshed);
  return refreshed.access_token;
}

// ─── Local OAuth flow (dev mode — run: node auth.js) ─────────────────────────

export async function runOAuthFlow() {
  return new Promise((resolve, reject) => {
    const app = express();
    let server;

    const { HS_CLIENT_ID, HS_CLIENT_SECRET, HS_REDIRECT_URI, HS_SCOPES } = getCredentials();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

    // Override redirect URI for local flow
    const localRedirect = "http://localhost:3000/oauth/callback";

    app.get("/oauth/callback", async (req, res) => {
      const { code, error, state: returnedState } = req.query;

      if (error) {
        res.send(`<h2>Auth failed: ${error}</h2>`);
        server.close();
        return reject(new Error(error));
      }

      if (returnedState !== state) {
        res.send(`<h2>State mismatch</h2>`);
        server.close();
        return reject(new Error("State mismatch"));
      }

      try {
        const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type:    "authorization_code",
            client_id:     HS_CLIENT_ID,
            client_secret: HS_CLIENT_SECRET,
            redirect_uri:  localRedirect,
            code,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenRes.ok) throw new Error(await tokenRes.text());
        const tokenData = await tokenRes.json();

        const infoRes = await fetch(
          `https://api.hubapi.com/oauth/v1/access-tokens/${tokenData.access_token}`
        );
        const info = await infoRes.json();
        const portalId = String(info.hub_id);

        saveLocalToken(portalId, tokenData);

        res.send(`
          <body style="font-family:sans-serif;max-width:480px;margin:80px auto">
            <h2>Connected</h2>
            <p>Portal <strong>${portalId}</strong> (${info.hub_domain}) saved locally.</p>
            <p style="color:#666">You can close this tab.</p>
          </body>
        `);

        console.log(`\n[auth] Connected portal: ${portalId} (${info.hub_domain})`);
        server.close();
        resolve(portalId);
      } catch (err) {
        res.send(`<h2>Error: ${err.message}</h2>`);
        server.close();
        reject(err);
      }
    });

    server = app.listen(3000, async () => {
      const authUrl =
        `https://app.hubspot.com/oauth/authorize` +
        `?client_id=${HS_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(localRedirect)}` +
        `&scope=${encodeURIComponent(HS_SCOPES)}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256` +
        `&state=${state}`;

      console.log("\n[auth] Opening HubSpot OAuth in your browser...");
      await open(authUrl);
    });

    server.on("error", reject);
  });
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args[0] === "list") {
    const portals = await listAuthorisedPortals();
    if (!portals.length) {
      console.log("No authorised portals. Visit auth.latigid.dev or run: node auth.js");
    } else {
      console.log("Authorised portals:");
      portals.forEach(id => console.log(`  - ${id}`));
    }
  } else {
    runOAuthFlow().catch(err => {
      console.error("[auth] Error:", err.message);
      process.exit(1);
    });
  }
}
