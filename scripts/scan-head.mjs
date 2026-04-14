import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const lines = idx.split('\n');
// Print lines 1 to 30 to see imports and setup
const head = lines.slice(0, 30).map((l, i) => `${i + 1}: ${l}`).join('\n');
console.log(head);
