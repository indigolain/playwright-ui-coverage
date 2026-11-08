#!/usr/bin/env bash
# Runs the demo in fixture mode and in register mode, then checks that both
# recorded the same coverage. Used by CI; works locally too:
#
#   PORT=4201 BROWSER=firefox scripts/demo-both-modes.sh
#
# UICOV_STRICT=1 turns "register mode is not supported" into an error, and
# UICOV_CHECK_STEPS=1 fails the run if recording shows up as test steps.
set -euo pipefail
cd "$(dirname "$0")/.."

out=.ui-coverage-ci
rm -rf "$out"
mkdir -p "$out"
export UICOV_STRICT=1 UICOV_CHECK_STEPS=1

for mode in fixture register; do
  echo "::group::demo ($mode mode, ${BROWSER:-chromium})"
  rm -rf ui-coverage-report
  if [ "$mode" = register ]; then npm run demo:register; else npm run demo; fi
  echo "::endgroup::"
  if [ ! -f ui-coverage-report/coverage.json ]; then
    echo "✗ $mode mode wrote no ui-coverage-report/coverage.json (nothing was recorded)" >&2
    exit 1
  fi
  cp -R ui-coverage-report "$out/$mode"
done

node scripts/compare-modes.mjs "$out/fixture/coverage.json" "$out/register/coverage.json"
