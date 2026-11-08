// Playwright reporter used by CI (UICOV_CHECK_STEPS=1): fails the run if UI
// coverage recording shows up as steps in the report or trace, which happens
// when its calls aren't marked internal. It sees every step category (API
// calls, hooks, fixtures, attachments). The demo tests never call these APIs.
//
// CommonJS on purpose: older Playwright versions can hang loading ESM reporters.
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
    if (FORBIDDEN.test(step.title)) this.found.push(`${test.title}: [${step.category}] "${step.title}"`);
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
