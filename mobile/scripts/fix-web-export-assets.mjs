// Run after `expo export --platform web --output-dir ../public/app`.
// Expo puts library assets (icon fonts, navigation images) under
// assets/node_modules/, but the Vercel CLI never uploads folders named
// node_modules, so those files 404 on the live site (icons render as boxes).
// This moves them to assets/vendor/ and rewrites the references.
//   node scripts/fix-web-export-assets.mjs [outputDir=../public/app]

import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..', 'public', 'app'));
const from = path.join(out, 'assets', 'node_modules');
const to = path.join(out, 'assets', 'vendor');

if (fs.existsSync(from)) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
}

let rewritten = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|html|css|json)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      const next = text.replaceAll('/assets/node_modules/', '/assets/vendor/');
      if (next !== text) { fs.writeFileSync(file, next); rewritten += 1; }
    }
  }
};
walk(out);
console.log(`web assets: moved to ${path.relative(process.cwd(), to)}, rewrote ${rewritten} file(s)`);
