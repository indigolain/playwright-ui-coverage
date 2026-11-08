// Playwright reporter used by CI (UICOV_CHECK_STEPS=1): fails the run if UI
// coverage recording shows up as steps in the report or trace, which happens
// when its calls aren't marked internal. It sees every step category (API
// calls, hooks, fixtures, attachments).
//
// CommonJS on purpose: older Playwright versions can hang loading ESM reporters.
const path = require('node:path');

const FORBIDDEN = /evaluate|screenshot|exposeBinding|addInitScript|attach|ui-?coverage/i;

class NoStepsReporter {
  constructor() {
    this.found = [];
    this.steps = 0;
    this.tests = 0;
  }

  onTestBegin() {
    this.tests++;
  }

  onStepBegin(test, _result, step) {
    this.steps++;
    const file = step.location?.file ?? '';
    // Steps the tests make themselves (e.g. a locator.evaluate) point at demo/tests;
    // leaked recording steps point at src/ or nowhere.
    const fromLibrary = file.includes(`${path.sep}src${path.sep}`);
    const fromTest = file.includes(`${path.sep}demo${path.sep}tests${path.sep}`);
    if (fromLibrary || (FORBIDDEN.test(step.title) && !fromTest))
      this.found.push(`${test.title}: [${step.category}] "${step.title}"${file ? ` at ${path.relative(process.cwd(), file)}:${step.location.line}` : ''}`);
  }

  onEnd() {
    if (this.tests === 0) return;
    if (this.steps === 0) {
      console.error('✗ no-steps-reporter saw no steps at all');
      return { status: 'failed' };
    }
    if (this.found.length) {
      console.error('✗ UI coverage recording leaked into the test steps:');
      for (const f of [...new Set(this.found)]) console.error(`  ${f}`);
      return { status: 'failed' };
    }
    console.log(`✓ no recording steps among ${this.steps} steps`);
  }

  printsToStdio() {
    return false;
  }
}

module.exports = NoStepsReporter;
