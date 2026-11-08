#!/usr/bin/env node
/**
 * `playwright-ui-coverage report [--data <dir>] [--config <file>] [--out <dir>]`
 *
 * Rebuilds the report from `ui-coverage-report/data/` with the current
 * report-time rules, without running tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { pickRules, validateRules } from './model/rules';
import { buildReport, DATA_DIR, readData, type UiCoverageReporterOptions } from './report';

const USAGE = `Usage: playwright-ui-coverage report [options]

Rebuilds the UI coverage report (index.html, coverage.json) from stored data,
applying the rules in the config file. Exits with code 1 if a threshold fails.

Options:
  --data <dir>     Data folder written by the reporter (default: data/ in the
                   config's outputFolder, else ui-coverage-report/data)
  --config <file>  Module exporting the reporter options (.js, .cjs, .mjs, .json;
                   .ts/.mts when your Node.js version can import TypeScript)
  --out <dir>      Where to write the report (default: the folder that
                   contains the data folder). Only index.html, coverage.json
                   and screens/ are replaced; nothing else is deleted.
  -h, --help       Show this help
`;

// tsc compiles `import()` to `require()` for CommonJS output; keep a real dynamic import for ESM/TS configs.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

export async function loadConfig(file: string): Promise<UiCoverageReporterOptions> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`config file not found: ${file}`);
  const ext = path.extname(abs).toLowerCase();
  let mod: any;
  if (ext === '.json') {
    mod = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } else {
    try {
      mod = await dynamicImport(pathToFileURL(abs).href);
    } catch (e) {
      if (['.ts', '.mts', '.cts'].includes(ext)) {
        throw new Error(
          `can't load ${file}: ${(e as Error).message}\n` +
            `TypeScript configs need a Node.js version that can import .ts files (22.18+ / 23.6+); ` +
            `otherwise use a .js, .mjs or .json config.`,
        );
      }
      throw e;
    }
    // ESM default export, or CommonJS `module.exports` (exposed as `default` too).
    mod = mod?.default ?? mod;
    if (mod && typeof mod === 'object' && 'default' in mod && Object.keys(mod).length === 1) mod = mod.default;
  }
  if (!mod || typeof mod !== 'object' || Array.isArray(mod))
    throw new Error(`${file} must export the reporter options object`);
  return mod as UiCoverageReporterOptions;
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        data: { type: 'string' },
        config: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals[0] !== 'report' || positionals.length > 1) {
    console.error(positionals.length ? `Unknown command: ${positionals.join(' ')}\n\n${USAGE}` : USAGE);
    return 2;
  }

  try {
    const options = values.config ? await loadConfig(values.config) : {};
    validateRules(pickRules(options as Record<string, unknown>), values.config ?? 'options');
    // The folder the reporter wrote to. outputFolder in the config is relative
    // to the config file (like in playwright.config.ts).
    const reportDir =
      values.config && options.outputFolder
        ? path.resolve(path.dirname(path.resolve(values.config)), options.outputFolder)
        : path.resolve('ui-coverage-report');
    const dataDir = path.resolve(values.data ?? path.join(reportDir, DATA_DIR));
    const out = path.resolve(values.out ?? (values.data ? path.dirname(dataDir) : reportDir));
    const attempts = readData(dataDir);
    fs.mkdirSync(out, { recursive: true });
    const { failed } = buildReport(attempts, options, out);
    return failed ? 1 : 0;
  } catch (e) {
    console.error(`playwright-ui-coverage: ${(e as Error).message.replace(/^\[playwright-ui-coverage\] /, '')}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
