#!/usr/bin/env bash
# This script runs the escape probes in a real stillsuit sandbox and fails if any escape succeeds.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$(mktemp -d)"
CANARY="$HOME/stillsuit-canary-$$"
trap 'rm -rf "$PROJECT" "$CANARY"' EXIT

echo "REALCANARY-home-file" > "$CANARY"
cp "$ROOT/test/escape/probes.sh" "$PROJECT/probes.sh"
echo "DATABASE_PASSWORD=REALCANARY-dotenv" > "$PROJECT/.env"
mkdir -p "$PROJECT/config" && echo "REALCANARY-private-key" > "$PROJECT/config/id_rsa"

cd "$PROJECT"
OUTPUT="$(ANTHROPIC_API_KEY=sk-ant-api03-REALCANARY GITHUB_TOKEN=ghp_canary node "$ROOT/dist/bin/stillsuit.js" shell --no-scan -- bash /workspace/probes.sh 2>&1 || true)"
echo "$OUTPUT"

BLOCKED="$(grep -c '^blocked ' <<<"$OUTPUT" || true)"
ESCAPED="$(grep -c '^ESCAPED ' <<<"$OUTPUT" || true)"
EXPECTED="$(grep -c '; report ' "$ROOT/test/escape/probes.sh")"
echo "escape tests: $BLOCKED of $EXPECTED blocked, $ESCAPED escaped"
grep -q '^control ' <<<"$OUTPUT"
[ "$ESCAPED" -eq 0 ] && [ "$BLOCKED" -eq "$EXPECTED" ]
