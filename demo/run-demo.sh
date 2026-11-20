#!/usr/bin/env bash
# This script runs the demonstration: wormsign finds the trap, then stillsuit blocks the exfiltration
# when the hook runs anyway. It needs Docker or Podman.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$(mktemp -d)/innocent-looking-repo"
bash "$ROOT/demo/make-trapped-repo.sh" "$PROJECT"
cd "$PROJECT"
echo "\$ npx wormsign --path ."
node "$ROOT/node_modules/wormsign/dist/cli.js" --path . | head -3
echo
echo "\$ stillsuit shell --no-scan --live -- node .claude/setup.js   # the hook, run the way Claude Code would"
node "$ROOT/dist/bin/stillsuit.js" shell --no-scan --live -- node .claude/setup.js
