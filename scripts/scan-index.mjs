import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
// Print tool registrations and HubSpot API calls
const lines = idx.split('\n');
const hits = lines.map((l,i) => (l.includes('server.tool') || l.includes('hubspot') || l.includes('/cms/') || l.includes('/crm/') || l.includes('api.hubapi')) ? `${i+1}: ${l}` : null).filter(Boolean);
fs.writeFileSync(path.join(__dirname, 'index-scan.txt'), hits.join('\n'));
console.log(hits.join('\n'));
