import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const indexPath = path.join(__dirname, '..', 'index.js');
let idx = fs.readFileSync(indexPath, 'utf8');

// Count server.tool occurrences to confirm current state
const toolCount = (idx.match(/server\.tool\(/g) || []).length;
console.log(`Current tool count: ${toolCount}`);
console.log(`File length: ${idx.length} chars`);

// Check if new tools are present
console.log('get_page present:', idx.includes('"get_page"'));
console.log('update_page_content present:', idx.includes('"update_page_content"'));
console.log('web_search present:', idx.includes('"web_search"'));

// Check the last 500 chars to see what's at the end
console.log('\nLast 500 chars:');
console.log(idx.slice(-500));
