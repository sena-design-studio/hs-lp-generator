import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const indexPath = path.join(__dirname, '..', 'index.js');
let idx = fs.readFileSync(indexPath, 'utf8');

// Show where the START marker is relative to the new tools
const startPos = idx.indexOf('// ─── START ───');
const getPagePos = idx.indexOf('"get_page"');
const webSearchPos = idx.indexOf('"web_search"');

console.log(`File length: ${idx.length}`);
console.log(`START marker position: ${startPos}`);
console.log(`get_page position: ${getPagePos}`);
console.log(`web_search position: ${webSearchPos}`);
console.log(`get_page is BEFORE start: ${getPagePos < startPos}`);
console.log(`web_search is BEFORE start: ${webSearchPos < startPos}`);
