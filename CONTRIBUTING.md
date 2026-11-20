# Contributing

Every change follows the same path: an issue, a branch, a pull request, a green CI.

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run coverage      # 100 % of lines, branches, functions and statements is required
pnpm run build         # dist/ is committed and checked in CI
pnpm run escape-tests  # needs Docker or Podman
```

- A new escape attempt goes in `test/escape/probes.sh` and must print `blocked` on the current code.
- A new default host needs a public source that shows the agent or the registry calls it.
- Named functions only (no arrow functions), braces on every `if` and loop, guard clauses, one-sentence comments.
