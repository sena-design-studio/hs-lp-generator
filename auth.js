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

// Re-parse .env on every call so Claude Desktop picks up changes without restart
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
  };
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(64).toString("base64url");
}

function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── Token storage (per portal) ──────────────────────────────────────────────

function loadTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return {};
  return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export function getTokenForPortal(portalId) {
  const tokens = loadTokens();
  return tokens[String(portalId)] || null;
}

export function saveTokenForPortal(portalId, tokenData) {
  const tokens = loadTokens();
  tokens[String(portalId)] = {
    ...tokenData,
    saved_at: Date.now(),
  };
  saveTokens(tokens);
}

export function listAuthorisedPortals() {
  return Object.keys(loadTokens());
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshToken(portalId) {
  const token = getTokenForPortal(portalId);
  if (!token?.refresh_token) {
    throw new Error(`No refresh token for portal ${portalId}. Re-run: node auth.js`);
  }

  const { HS_CLIENT_ID, HS_CLIENT_SECRET, HS_REDIRECT_URI } = getCredentials();

  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: HS_CLIENT_ID,
      client_secret: HS_CLIENT_SECRET,
      redirect_uri: HS_REDIRECT_URI,
      refresh_token: token.refresh_token,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);

  const refreshed = await res.json();
  saveTokenForPortal(portalId, refreshed);
  return refreshed.access_token;
}

// ─── Get valid access token (auto-refresh if expired) ────────────────────────

export async function getValidAccessToken(portalId) {
  const token = getTokenForPortal(portalId);
  if (!token) {
    throw new Error(`Portal ${portalId} not authorised. Run: node auth.js`);
  }

  const ageMs = Date.now() - token.saved_at;
  const expiresMs = (token.expires_in || 1800) * 1000;
  const isExpired = ageMs > expiresMs - 60_000;

  if (isExpired) {
    console.error(`[auth] Token expired for portal ${portalId}, refreshing...`);
    return await refreshToken(portalId);
  }

  return token.access_token;
}

// ─── OAuth 2.1 + PKCE flow ────────────────────────────────────────────────────

export async function runOAuthFlow() {
  return new Promise((resolve, reject) => {
    const app = express();
    let server;

    const { HS_CLIENT_ID, HS_CLIENT_SECRET, HS_REDIRECT_URI, HS_SCOPES } = getCredentials();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

    app.get("/oauth/callback", async (req, res) => {
      const { code, error, state: returnedState } = req.query;

      if (error) {
        res.send(`<h2 style="font-family:sans-serif">Auth failed: ${error}</h2>`);
        server.close();
        return reject(new Error(error));
      }

      if (returnedState !== state) {
        res.send(`<h2 style="font-family:sans-serif">State mismatch — possible CSRF attack</h2>`);
        server.close();
        return reject(new Error("State mismatch"));
      }

      try {
        const { HS_CLIENT_ID, HS_CLIENT_SECRET, HS_REDIRECT_URI } = getCredentials();
        const tokenRes = await fetch("https://api.hubapi.com/oauth/v1/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: HS_CLIENT_ID,
            client_secret: HS_CLIENT_SECRET,
            redirect_uri: HS_REDIRECT_URI,
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

        saveTokenForPortal(portalId, tokenData);

        res.send(`
          <!DOCTYPE html>
          <html>
            <body style="font-family:sans-serif;max-width:480px;margin:80px auto;color:#1a2e4a">
              <h2>Connected</h2>
              <p>Portal <strong>${portalId}</strong> (${info.hub_domain}) has been authorised.</p>
              <p style="color:#666">You can close this tab and return to the terminal.</p>
            </body>
          </html>
        `);

        console.log(`\n[auth] Authorised portal: ${portalId} (${info.hub_domain})`);
        console.log(`[auth] Token saved to .tokens.json\n`);

        server.close();
        resolve(portalId);
      } catch (err) {
        res.send(`<h2 style="font-family:sans-serif">Error: ${err.message}</h2>`);
        server.close();
        reject(err);
      }
    });

    server = app.listen(3000, async () => {
      const { HS_CLIENT_ID, HS_REDIRECT_URI, HS_SCOPES } = getCredentials();
      const authUrl =
        `https://app.hubspot.com/oauth/authorize` +
        `?client_id=${HS_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(HS_REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(HS_SCOPES)}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256` +
        `&state=${state}`;

      console.log("\n[auth] Opening HubSpot OAuth in your browser...");
      console.log(`[auth] If it doesn't open automatically, visit:\n${authUrl}\n`);
      await open(authUrl);
    });

    server.on("error", reject);
  });
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args[0] === "list") {
    const portals = listAuthorisedPortals();
    if (portals.length === 0) {
      console.log("No authorised portals. Run: node auth.js");
    } else {
      console.log("Authorised portals:");
      portals.forEach((id) => console.log(`  - ${id}`));
    }
  } else {
    runOAuthFlow().catch((err) => {
      console.error("[auth] Error:", err.message);
      process.exit(1);
    });
  }
}
