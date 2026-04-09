#!/usr/bin/env node
/**
 * patch-onedrive.mjs
 * Run once after moving folders to OneDrive.
 * Updates generate.js and index.js to resolve paths from ONEDRIVE_PATH.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Resolve ONEDRIVE_PATH in the script itself ────────────────────────────────
const envFile = path.join(ROOT, '.env');
let ONEDRIVE_PATH = path.dirname(ROOT); // fallback: parent of hs-lp-generator

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^ONEDRIVE_PATH=(.*)$/);
    if (m) { ONEDRIVE_PATH = m[1].trim(); break; }
  }
}

console.log(`OneDrive path: ${ONEDRIVE_PATH}`);

// ─── Patch generate.js ────────────────────────────────────────────────────────

const generatePath = path.join(ONEDRIVE_PATH, 'lp-theme-generic', 'generate.js');
let gen = fs.readFileSync(generatePath, 'utf8');

const oldOutputDir = `const OUTPUT_DIR = path.join(__dirname, "..", "generated-themes");`;
const newOutputDir = `// Resolve paths relative to OneDrive shared folder
function getOnedrivePath() {
  const envFile = path.join(__dirname, '..', 'hs-lp-generator', '.env');
  if (fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, 'utf8');
    for (const line of raw.split('\\n')) {
      const m = line.match(/^ONEDRIVE_PATH=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  return path.join(__dirname, '..');
}
const ONEDRIVE_PATH = getOnedrivePath();
const OUTPUT_DIR = path.join(ONEDRIVE_PATH, 'generated-themes');`;

if (gen.includes(oldOutputDir)) {
  gen = gen.replace(oldOutputDir, newOutputDir);
  fs.writeFileSync(generatePath, gen, 'utf8');
  console.log('✓ generate.js — OUTPUT_DIR patched');
} else if (gen.includes('ONEDRIVE_PATH')) {
  console.log('✓ generate.js — already patched');
} else {
  console.log('✗ generate.js — OUTPUT_DIR line not found');
}

// ─── Patch index.js ───────────────────────────────────────────────────────────

const indexPath = path.join(ROOT, 'index.js');
let idx = fs.readFileSync(indexPath, 'utf8');

const importMarker = `import { generateTheme, collectFiles } from "./lp-theme-generic/generate.js";`;
const onedrivePatch = `import { generateTheme, collectFiles } from "./lp-theme-generic/generate.js";

// ─── Resolve OneDrive shared path ─────────────────────────────────────────────
function getOnedrivePath() {
  const raw = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const line of raw.split('\\n')) {
    const m = line.match(/^ONEDRIVE_PATH=(.*)$/);
    if (m) return m[1].trim();
  }
  return path.join(__dirname, '..');
}
const ONEDRIVE_PATH = getOnedrivePath();
const CLIENT_IMAGES_DIR = path.join(ONEDRIVE_PATH, 'client-images');
const THEMES_DIR = path.join(ONEDRIVE_PATH, 'lp-theme-generic');
const PROGRAMME_THEMES_DIR = path.join(ONEDRIVE_PATH, 'lp-theme-programme');`;

if (!idx.includes('ONEDRIVE_PATH') && idx.includes(importMarker)) {
  idx = idx.replace(importMarker, onedrivePatch);
  fs.writeFileSync(indexPath, idx, 'utf8');
  console.log('✓ index.js — ONEDRIVE_PATH resolver added');
} else if (idx.includes('ONEDRIVE_PATH')) {
  console.log('✓ index.js — already patched');
} else {
  console.log('✗ index.js — import marker not found');
}

// ─── Add logging to index.js ───────────────────────────────────────────────────

idx = fs.readFileSync(indexPath, 'utf8');

const loggerCode = `
// ─── Per-user logger ───────────────────────────────────────────────────────────
import os from 'os';
const USERNAME = os.userInfo().username;
const LOG_FILE = path.join(ONEDRIVE_PATH, 'logs', \`\${USERNAME}.log\`);

function writeLog(tool, params) {
  try {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const summary = Object.entries(params)
      .filter(([k]) => ['portal_id','theme_name','theme_path','page_name','query','file_path','folder_path'].includes(k))
      .map(([k, v]) => \`\${k}:\${v}\`)
      .join(' | ');
    const line = \`[\${ts}] \${USERNAME} | \${tool} | \${summary}\\n\`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}
`;

const serverMarker = `const server = new McpServer({`;
if (!idx.includes('writeLog') && idx.includes(serverMarker)) {
  idx = idx.replace(serverMarker, loggerCode + serverMarker);
  fs.writeFileSync(indexPath, idx, 'utf8');
  console.log('✓ index.js — logger added');
} else if (idx.includes('writeLog')) {
  console.log('✓ index.js — logger already present');
} else {
  console.log('✗ index.js — McpServer marker not found');
}

// ─── Create logs directory ─────────────────────────────────────────────────────

const logsDir = path.join(ONEDRIVE_PATH, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  console.log('✓ logs/ directory created in OneDrive');
} else {
  console.log('✓ logs/ directory already exists');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Patch complete. Restart Claude Desktop.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
