import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const f = path.join(__dirname, '..', 'lp-theme-generic', 'generate.js');
const lines = fs.readFileSync(f, 'utf8').split('\n');
const hits = lines.map((l,i) => l.includes('OUTPUT_DIR') || l.includes('generated-themes') || l.includes('__dirname') ? `${i+1}: ${l}` : null).filter(Boolean);
fs.writeFileSync(path.join(__dirname, 'scripts', 'output.txt'), hits.join('\n'));
console.log(hits.join('\n'));
