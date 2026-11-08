// Runs a script of the documentation site (docs/package.json: dev, build,
// preview), installing its dependencies first when they're missing. The site's
// dependencies (VitePress) are kept out of the library's own package.json so
// `npm ci` for the library and its CI jobs doesn't install them.
//
//   node scripts/docs.mjs build   (npm run docs:build)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const [script, ...args] = process.argv.slice(2);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmdArgs) => {
  const r = spawnSync(npm, cmdArgs, { cwd: docs, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!fs.existsSync(path.join(docs, 'node_modules', 'vitepress'))) {
  console.log('Installing the docs dependencies (npm ci in docs/)…');
  run(['ci', '--no-audit', '--no-fund']);
}
run(['run', script, ...(args.length ? ['--', ...args] : [])]);
