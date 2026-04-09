#!/usr/bin/env node
// Run this once to patch generate.js to use ONEDRIVE_PATH
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatePath = path.join(__dirname, '..', 'lp-theme-generic', 'generate.js');

let content = fs.readFileSync(generatePath, 'utf8');

// Replace OUTPUT_DIR to use ONEDRIVE_PATH
const oldOutputDir = `const OUTPUT_DIR = path.join(__dirname, '..', 'generated-themes');`;
const newOutputDir = `// Resolve OUTPUT_DIR from ONEDRIVE_PATH env var or fall back to local
const ONEDRIVE_PATH = (() => {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, 'utf8');
    for (const line of raw.split('\\n')) {
      const m = line.match(/^ONEDRIVE_PATH=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  return null;
})();
const OUTPUT_DIR = ONEDRIVE_PATH
  ? path.join(ONEDRIVE_PATH, 'generated-themes')
  : path.join(__dirname, '..', 'generated-themes');`;

if (content.includes(oldOutputDir)) {
  content = content.replace(oldOutputDir, newOutputDir);
  fs.writeFileSync(generatePath, content, 'utf8');
  console.log('✓ generate.js patched — OUTPUT_DIR now reads from ONEDRIVE_PATH');
} else {
  console.log('OUTPUT_DIR pattern not found — may already be patched or format differs');
  console.log('Searching for OUTPUT_DIR...');
  const match = content.match(/const OUTPUT_DIR.+/);
  if (match) console.log('Found:', match[0]);
}
