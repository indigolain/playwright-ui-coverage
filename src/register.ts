/**
 * Zero-code mode (experimental): import this once from playwright.config.ts
 *
 *   import 'playwright-ui-coverage/register';
 *
 * and every browser context created during a test is recorded, with no
 * changes to your test files.
 *
 * How: Playwright loads the config file inside every worker, so this module
 * runs there too. It adds a listener to Playwright's client instrumentation,
 * the same hook Playwright's own trace recorder uses, to start recording when
 * a context is created and to flush before it closes.
 *
 * `_instrumentation` is a private API. If a Playwright release changes it,
 * this mode turns itself off with a warning (an error with UICOV_STRICT=1);
 * the `uiCoverage` fixture keeps working.
 */
import path from 'node:path';
import { test, type BrowserContext } from '@playwright/test';
import { ContextRecorder } from './recorder';
import { recordingOptionsFor } from './config';

const FLAG = Symbol.for('playwright-ui-coverage.registered');

function loadPlaywrightCore(): any {
  // Resolve the same playwright-core instance that @playwright/test uses,
  // even when the user's node_modules has another copy hoisted.
  const testPkg = require.resolve('@playwright/test/package.json');
  const pwPkg = require.resolve('playwright/package.json', { paths: [path.dirname(testPkg)] });
  return require(require.resolve('playwright-core', { paths: [path.dirname(pwPkg)] }));
}

function currentTestInfo() {
  try {
    return test.info();
  } catch {
    return undefined; // context created outside a test (e.g. in globalSetup)
  }
}

function register() {
  const g = globalThis as any;
  if (g[FLAG]) return;
  g[FLAG] = true;

  let instrumentation: any;
  try {
    instrumentation = loadPlaywrightCore()._instrumentation;
  } catch {
    /* handled below */
  }
  if (typeof instrumentation?.addListener !== 'function') {
    const message =
      '[playwright-ui-coverage] register mode is not supported by this Playwright version; ' +
      'use the `uiCoverage` fixture instead.';
    // UICOV_STRICT=1 (used in CI) makes this an error instead of a warning.
    if (process.env.UICOV_STRICT) throw new Error(message);
    console.warn(message);
    return;
  }

  instrumentation.addListener({
    runAfterCreateBrowserContext: async (context: BrowserContext) => {
      const testInfo = currentTestInfo();
      if (!testInfo) return;
      const options = recordingOptionsFor(testInfo, (testInfo.project.use as any).uiCoverage);
      if (!options.enabled) return;
      await ContextRecorder.attach(context, testInfo, options);
    },
    runBeforeCloseBrowserContext: async (context: BrowserContext) => {
      await ContextRecorder.for(context)?.finish();
    },
  });
}

register();
