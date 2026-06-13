const fs = require('fs');
const path = require('path');
function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      const content = fs.readFileSync(p, 'utf8');
      if (content.includes('\\`')) {
        console.log('FOUND backtick in', p);
      }
      if (content.includes('`') && content.match(/`[^`]*\\`[^`]*`/)) {
        console.log('FOUND escaped backtick in', p);
      }
    }
  }
}
walk('d:/Pendingweb/frontend/src');
walk('d:/Pendingweb/backend/src');