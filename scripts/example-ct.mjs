// Builds the library, installs it into examples/ct-react and runs the
// component tests there.
//
//   npm run example:ct              → fixture mode
//   npm run example:ct -- register  → register mode
//
// The example installs the built package as a copy (`--install-links`), not a
// symlink, so it resolves the example's own @playwright/test, the version that
// matches its @playwright/experimental-ct-react, like a real install would.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'examples/ct-react');
// Drop the npm_config_* variables `npm run` sets for the root project, so the
// example's npm reads its own config.
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)));
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...baseEnv, ...env } });

run('npm run build', root);
// npm doesn't refresh a copied `file:` dependency on its own; remove it so it's copied again.
fs.rmSync(path.join(example, 'node_modules/playwright-ui-coverage'), { recursive: true, force: true });
run('npm install --install-links --no-audit --no-fund', example);
run('npx playwright install chromium', example);

const register = process.argv.includes('register');
try {
  run('npx playwright test -c playwright-ct.config.ts', example, register ? { UICOV_MODE: 'register' } : {});
} catch {
  process.exit(1);
}
