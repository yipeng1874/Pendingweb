const fs = require('fs');
const path = require('path');
function walk(dir) {
  if (dir.includes('node_modules')) return;
  if (dir.includes('.git')) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else {
      try {
        const content = fs.readFileSync(p, 'utf8');
        if (content.includes('\\`')) {
          console.log('FOUND \\` in', p);
        }
      } catch (e) {}
    }
  }
}
walk('d:/Pendingweb');