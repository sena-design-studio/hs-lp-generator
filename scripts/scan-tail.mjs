import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const lines = idx.split('\n');
// Print lines 556 to end
const section = lines.slice(555).map((l, i) => `${i + 556}: ${l}`).join('\n');
fs.writeFileSync(path.join(__dirname, 'index-tail.txt'), section);
console.log(section);
