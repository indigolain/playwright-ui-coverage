# Contributing

This page is for working on playwright-ui-coverage itself: setting up the repository, running the demo and the checks, and building these docs.

## Setup

```bash
git clone https://github.com/indigolain/playwright-ui-coverage.git
cd playwright-ui-coverage
npm install
npx playwright install chromium
```

## The demo

`demo/` is a small app (`demo/site/`, served by `demo/server.mjs`) with tests in `demo/tests/` that exercise most features. `ui-coverage.config.ts` and `playwright.config.ts` at the repository root configure it.

```bash
npm run demo          # fixture mode: runs demo/tests, writes ui-coverage-report/
npm run demo:register # register mode: same tests, config-only recording
npm run demo:serve    # serves the demo app, to look at it in a browser
```

Variants, from environment variables and profiles in `ui-coverage.config.ts`:

```bash
UI_COVERAGE_PROFILE=thresholds-fail npm run demo  # per-view thresholds that fail (exit code 1)
UI_COVERAGE_PROFILE=thresholds-pass npm run demo  # per-view thresholds that pass
UICOV_DEMO_FAIL=1 npx playwright test --retries=1  # adds a failing and a flaky test (demo/tests/failing.spec.ts)
UICOV_TRACE=1 npm run demo                        # records traces; "Tested by" links to them in playwright-report/
UICOV_DEMO_BASELINE=update npm run demo           # writes demo/ui-coverage-baseline.json (gitignored)
UICOV_DEMO_BASELINE=check UICOV_DEMO_GAP=1 npm run demo  # a test skips a step: fails with 1 new untested element
UICOV_DEMO_LEGACY=1 npm run demo                  # no config file: rules and recording options in use.uiCoverage (deprecated for rules); same report
```

## Checks

```bash
npm run typecheck
npm run build                # compiles to dist/
npm test                     # unit tests (vitest)
npm run check:interactivity  # in-browser check of the interactivity rules and interaction types
npm run check:locators       # checks suggested locators and a11y hints; with a demo report, that every locator resolves
npm run check:rebuild        # the report CLI rebuilds the same report from data/, changed rules apply, config profiles/validation
npm run check:baseline       # baseline update/check, a new gap (UICOV_DEMO_GAP=1), compare and the step summary, end to end
npm run demo:sharded         # runs 2 blob shards + merge-reports, checks it matches an unsharded run
npm run example:ct           # component testing example (examples/ct-react): installs it, runs it, writes its report
npm run example:ct:register  # the same, in register mode
npm run perf                 # builds a 300-route synthetic report in perf-report/ and times it in Chromium
BROWSER=firefox scripts/demo-both-modes.sh  # what CI runs: both modes, same coverage, no extra steps
```

`scripts/demo-both-modes.sh` runs the demo in fixture and register mode and checks they produce the same `coverage.json`. `PORT=4201` runs the demo server on another port, e.g. to run several checkouts side by side.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

- **checks:** typecheck, build, unit tests, and the docs build (`npm run docs:build`, which fails on dead links);
- **demo:** both recording modes on Chromium, Firefox and WebKit with `@playwright/test` 1.50.0 and the latest release; the Chromium jobs also run `check:interactivity`, `check:locators`, `demo:sharded`, `check:rebuild` (both modes) and `check:baseline`.

`.github/workflows/playwright-next.yml` runs the demo weekly against `@playwright/test@next`, to catch changes to the private instrumentation API that register mode relies on. `.github/workflows/docs.yml` builds this site and deploys it to GitHub Pages on every push to `main` that touches the docs.

## Releasing

Releases are made with [Changesets](https://github.com/changesets/changesets).

1. **Every PR that changes the package adds a changeset.** Run `npx changeset`, pick `patch`, `minor` or `major`, write a one-line summary for the changelog, and commit the generated `.changeset/*.md` file. The `changeset-check` workflow fails a PR without one, except PRs that only touch `.github/` or `docs/`. For a change that shouldn't be released at all (tests, demo, tooling), use `npx changeset --empty`.
2. **Merging to `main` opens or updates a "chore: version packages" PR.** `.github/workflows/publish.yml` collects the pending changesets, bumps the version in `package.json`, and writes `CHANGELOG.md`.
3. **Merging that PR publishes.** The same workflow publishes the new version to npm with provenance, then creates the `vX.Y.Z` tag and a GitHub release with the changelog entry.

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token is stored in the repository. The package's trusted publisher on npmjs.com names this repository, the `publish.yml` workflow and the `npm` environment, so renaming the workflow file or the environment breaks publishing.

Dependabot opens weekly PRs for npm dependencies; `.github/workflows/dependabot-changeset.yml` adds a patch changeset to each one, so dependency updates appear in the changelog and get released.

## Documentation

The site is built with [VitePress](https://vitepress.dev) from the `docs/` folder. Its dependencies are in `docs/package.json`, separate from the library's, so installing the library for development or CI doesn't pull them in.

```bash
npm run docs:dev        # live preview at http://localhost:5173/playwright-ui-coverage/
npm run docs:build      # builds docs/.vitepress/dist/; fails on dead links and missing #anchors
npm run docs:preview    # serves the built site
npm run docs:screenshots  # regenerates the screenshots in docs/images/ (run `npm run demo` first)
```

The first `docs:*` run installs the docs dependencies (`npm ci --prefix docs`).

Writing docs:

- Each page starts with a sentence on what the reader gets from it.
- Link between pages with relative `.md` links (`../guide/views.md#pattern-syntax`), so they work both on the site and when browsing `docs/` on GitHub. Heading anchors follow GitHub's rules on both.
- Use the published import paths in examples: `playwright-ui-coverage`, `playwright-ui-coverage/reporter`, `playwright-ui-coverage/register`, `playwright-ui-coverage/config`.
- Link to source files with full GitHub URLs; the build only accepts links to pages in `docs/`.
