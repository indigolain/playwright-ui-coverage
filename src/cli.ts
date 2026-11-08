#!/usr/bin/env node
/**
 * The `playwright-ui-coverage` command:
 *
 *   report    rebuild the report from ui-coverage-report/data/
 *   baseline  check against / update the committed baseline file
 *   compare   compare two coverage.json files (markdown for PR comments, or JSON)
 *   summary   markdown summary of one coverage.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_BASELINE_FILE,
  forDisplay,
  formatBaselineCheck,
  resolveBaselineOption,
  runBaseline,
  type BaselineOption,
} from './baseline';
import { compareReports } from './compare';
import type { CoverageReport } from './coverage-report';
import { comparisonMarkdown, reportMarkdown, type MarkdownOptions } from './markdown';
import {
  configTrace,
  envProfile,
  findConfigFile,
  loadConfigFile,
  resolveConfig,
  type RunInfo,
  type UiCoverageConfig,
} from './config';
import { buildReport, DATA_DIR, readData, type ReportInput, type ReportOptions } from './report';
import { assertCoverageReport } from './units';

const USAGE = `Usage: playwright-ui-coverage <command> [options]

Commands:
  report                    Rebuild the report (index.html, coverage.json) from
                            stored data, applying the rules in the config file.
  baseline check            Exit 1 if coverage.json has untested elements the
                            baseline doesn't list; writes <file>.next.json.
  baseline update           Write the baseline file from coverage.json.
  compare <base> <head>     Compare two coverage.json files: coverage delta, new
                            untested elements, resolved gaps, added/removed views.
  summary [coverage.json]   Markdown summary of one run (what githubSummary writes).

report and baseline options:
  --config <file>   UI coverage config file (.ts, .mts, .cts, .mjs, .js, .cjs,
                    .json). Default: $UI_COVERAGE_CONFIG, else
                    ui-coverage.config.* in the working directory, else
                    default options. Relative paths in it resolve from its folder
  --profile <name>  Profile to apply (default: $UI_COVERAGE_PROFILE; report:
                    else the profile the reporter used, else automatic
                    selection from the recorded projects and tags). '' selects none

report options:
  --data <dir>      Data folder written by the reporter (default: data/ in the
                    config's outputFolder, else ui-coverage-report/data)
  --out <dir>       Where to write the report (default: the folder that
                    contains the data folder). Only index.html, coverage.json
                    and screens/ are replaced; nothing else is deleted.

baseline options:
  --report <file>      coverage.json (default: coverage.json in the config's
                       outputFolder, else ui-coverage-report/coverage.json)
  --file <file>        Baseline file (default: the config's baseline.file, else
                       ${DEFAULT_BASELINE_FILE})
  --allow-new-views    check: untested elements of views not in the baseline
                       don't fail

compare / summary options:
  --format <fmt>       compare: markdown (default) or json
  --out <file>         Write to a file instead of stdout
  --report-url <url>   URL of the published HTML report: views link to it
  --title <text>       Heading (default: "UI coverage")

  -h, --help           Show this help

Exit codes: 0 ok, 1 a threshold or the baseline check failed, 2 usage or input error.
`;

/** The config file: --config, else $UI_COVERAGE_CONFIG, else ui-coverage.config.* in the working directory. */
async function configFileOf(values: Values): Promise<{ file?: string; config: UiCoverageConfig }> {
  const given = str(values.config) ?? process.env.UI_COVERAGE_CONFIG;
  const file = given ? path.resolve(given) : findConfigFile(process.cwd());
  return { file, config: file ? await loadConfigFile(file) : {} };
}

/** Projects and tags of the recorded tests, for automatic profile selection. */
function runInfo(input: ReportInput): RunInfo {
  const tests = new Map<string, string[] | undefined>();
  for (const a of input.attempts) tests.set(a.testId, a.tags);
  return {
    projects: [...new Set(input.attempts.map((a) => a.project ?? ''))],
    tests: [...tests.values()].map((tags) => ({ tags })),
  };
}

const COMMAND_OPTIONS: Record<string, string[]> = {
  report: ['data', 'config', 'profile', 'out'],
  baseline: ['report', 'file', 'config', 'profile', 'allow-new-views'],
  compare: ['format', 'out', 'report-url', 'title'],
  summary: ['out', 'report-url', 'title'],
};

class UsageError extends Error {}

type Values = Record<string, string | boolean | undefined>;
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);

function readReport(file: string): CoverageReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`can't read ${file}: ${(e as Error).message}`);
  }
  return assertCoverageReport(parsed, file);
}

function output(text: string, out: string | undefined) {
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, text);
  } else process.stdout.write(text);
}

/** outputFolder in the config is relative to the config file (like in playwright.config.ts). */
function reportDirOf(config: string | undefined, options: ReportOptions) {
  return config && options.outputFolder
    ? path.resolve(path.dirname(path.resolve(config)), options.outputFolder)
    : path.resolve('ui-coverage-report');
}

const baseDirOf = (config: string | undefined) => (config ? path.dirname(path.resolve(config)) : process.cwd());

async function reportCommand(values: Values): Promise<number> {
  const { file, config: fileConfig } = await configFileOf(values);
  let explicit = str(values.profile) ?? envProfile();
  // The data folder: with automatic profile selection, from the base config's outputFolder.
  const base = resolveConfig(fileConfig, undefined, { explicit }).config;
  const reportDir = reportDirOf(file, base);
  const dataDir = path.resolve(str(values.data) ?? path.join(reportDir, DATA_DIR));
  const out = path.resolve(str(values.out) ?? (values.data ? path.dirname(dataDir) : reportDir));
  const input = readData(dataDir);
  // Without an explicit choice, use the profile the reporter used, if the config still has it.
  const recorded = input.config?.profile;
  if (explicit === undefined && recorded) {
    if (fileConfig.profiles?.some((p) => p.name === recorded)) explicit = recorded;
    else
      console.warn(
        `playwright-ui-coverage: the data was reported with profile "${recorded}", which the config doesn't define; selecting automatically`,
      );
  }
  const { config, profile } = resolveConfig(fileConfig, undefined, { explicit, run: runInfo(input) });
  const trace = configTrace({ config, file, inline: [], profile });
  if (profile) console.log(`\nUI coverage profile: ${profile}`);
  fs.mkdirSync(out, { recursive: true });
  const { failed } = buildReport(input, config, out, { baseDir: baseDirOf(file), config: trace });
  return failed ? 1 : 0;
}

async function baselineCommand(sub: string | undefined, values: Values): Promise<number> {
  if (sub !== 'check' && sub !== 'update') throw new UsageError('baseline: expected "check" or "update"');
  const { file: config, config: fileConfig } = await configFileOf(values);
  const options = resolveConfig(fileConfig, undefined, { explicit: str(values.profile) ?? envProfile() }).config;
  const configured: BaselineOption = options.baseline && options.baseline !== true ? options.baseline : {};
  const fromConfig = typeof configured === 'string' ? { file: configured } : (configured as Exclude<BaselineOption, boolean | string>);
  const file = str(values.file) !== undefined
    ? path.resolve(str(values.file)!)
    : path.resolve(baseDirOf(config), fromConfig.file ?? DEFAULT_BASELINE_FILE);
  const option = resolveBaselineOption(
    { file, mode: sub, allowNewViews: values['allow-new-views'] === true || fromConfig.allowNewViews === true },
    process.cwd(),
  )!;
  const reportFile = path.resolve(str(values.report) ?? path.join(reportDirOf(config, options), 'coverage.json'));
  const report = readReport(reportFile);
  const outDir = path.dirname(reportFile);
  const check = runBaseline(report, option, outDir);
  const { info, errors } = formatBaselineCheck(forDisplay(check, outDir));
  if (info.length) console.log(info.join('\n'));
  if (errors.length) console.error(errors.join('\n'));
  return check.status === 'failed' ? 1 : 0;
}

function markdownOptions(values: Values): MarkdownOptions {
  const reportUrl = str(values['report-url']);
  const title = str(values.title);
  return { ...(reportUrl ? { reportUrl } : {}), ...(title ? { title } : {}) };
}

function compareCommand(args: string[], values: Values): number {
  if (args.length !== 2) throw new UsageError('compare: expected <base coverage.json> <head coverage.json>');
  const format = str(values.format) ?? 'markdown';
  if (format !== 'markdown' && format !== 'json') throw new UsageError(`--format: expected markdown or json, got ${format}`);
  const comparison = compareReports(readReport(args[0]), readReport(args[1]));
  const text =
    format === 'json' ? JSON.stringify(comparison, null, 2) + '\n' : comparisonMarkdown(comparison, markdownOptions(values));
  output(text, str(values.out));
  return 0;
}

function summaryCommand(args: string[], values: Values): number {
  if (args.length > 1) throw new UsageError('summary: expected at most one coverage.json');
  const report = readReport(args[0] ?? path.resolve('ui-coverage-report', 'coverage.json'));
  output(reportMarkdown(report, markdownOptions(values)), str(values.out));
  return 0;
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
        report: { type: 'string' },
        file: { type: 'string' },
        'allow-new-views': { type: 'boolean' },
        format: { type: 'string' },
        'report-url': { type: 'string' },
        title: { type: 'string' },
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
  const [command, ...args] = positionals;
  try {
    if (!command) throw new UsageError('');
    const allowed = COMMAND_OPTIONS[command];
    if (!allowed) throw new UsageError(`Unknown command: ${positionals.join(' ')}`);
    const extra = Object.keys(values).filter((k) => k !== 'help' && !allowed.includes(k));
    if (extra.length) throw new UsageError(`${command}: unknown option ${extra.map((k) => `--${k}`).join(', ')}`);
    switch (command) {
      case 'report':
        if (args.length) throw new UsageError(`Unknown command: ${positionals.join(' ')}`);
        return await reportCommand(values);
      case 'baseline':
        if (args.length > 1) throw new UsageError(`Unknown command: ${positionals.join(' ')}`);
        return await baselineCommand(args[0], values);
      case 'compare':
        return compareCommand(args, values);
      default:
        return summaryCommand(args, values);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message ? `${e.message}\n\n${USAGE}` : USAGE);
      return 2;
    }
    console.error(`playwright-ui-coverage: ${(e as Error).message.replace(/^\[playwright-ui-coverage\] /, '')}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
