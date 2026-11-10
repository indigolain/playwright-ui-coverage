# playwright-ui-coverage

## 0.2.0

### Minor Changes

- [#59](https://github.com/indigolain/playwright-ui-coverage/pull/59) [`60eeee3`](https://github.com/indigolain/playwright-ui-coverage/commit/60eeee3142d92e785b56453a0552b2ed32dcc4c2) Thanks [@indigolain](https://github.com/indigolain)! - Record test steps (opt-in `steps: 'on'`: each interaction and page load with its Playwright call and spec location, plus a screenshot after it) and step through every captured state of a view in the report ("All states", ←/→).

- [#60](https://github.com/indigolain/playwright-ui-coverage/pull/60) [`c68d351`](https://github.com/indigolain/playwright-ui-coverage/commit/c68d35191b82e13a030ba8c42f31d2955a168f26) Thanks [@indigolain](https://github.com/indigolain)! - Per-test walkthrough in the report: a "Tests" tab lists every test run, and each one steps through its recorded steps (←/→) with the Playwright call, spec location and a screenshot with the element acted on outlined; "Tested by" links to the matching step.

- [#65](https://github.com/indigolain/playwright-ui-coverage/pull/65) [`dbbc891`](https://github.com/indigolain/playwright-ui-coverage/commit/dbbc891e6b5c966edfe718a7d645372f1e8bdea3) Thanks [@indigolain](https://github.com/indigolain)! - Walkthrough: a step on one of several instances of an element (a "Delete" on every row) names which one it acted on (`row 2 of 3 · #user-2`), and Before outlines only that one when an identity tells it apart.

## 0.1.1

### Patch Changes

- [#50](https://github.com/indigolain/playwright-ui-coverage/pull/50) [`8f9bd9f`](https://github.com/indigolain/playwright-ui-coverage/commit/8f9bd9f8a9292901a57851c41a6ed0b7443f1bf9) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump @types/node from 22.20.5 to 26.6.6

- [#54](https://github.com/indigolain/playwright-ui-coverage/pull/54) [`82c6fd7`](https://github.com/indigolain/playwright-ui-coverage/commit/82c6fd7089e802f50b7d72eefceeeca046c739f0) Thanks [@indigolain](https://github.com/indigolain)! - Bump typescript from 5.9.3 to 7.0.2
