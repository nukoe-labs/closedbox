# Naming

Checked on 2026-11-20 with `curl https://registry.npmjs.org/<name>` (404 means free), a GitHub search of
repositories with that exact name (highest star count found), and RDAP for `.dev` and `.com`
(`pubapi.registry.google/rdap`, `rdap.verisign.com`; 404 means not registered).

| Name | npm | GitHub (most stars with that name) | .dev | .com | Idea |
|---|---|---|---|---|---|
| **stillsuit** | free | 25 | free | taken | The Fremen suit in Dune that keeps every drop inside: nothing leaves without permission |
| sandtrout | free | 1 | free | taken | The Dune creature that walls water in |
| spicejar | free | 0 | free | taken | Something valuable kept under a lid |
| dewtrap | free | 0 | free | taken | Catches what would escape into the air |
| petrijar | free | 0 | free | free | Grow the untrusted thing where you can watch it |
| wormjar | free | 0 | free | free | Put the worm in a jar; a nod to wormsign |
| noexfil | free | 0 | free | taken | Says exactly what it does |
| belljar | free | 13 | free | taken | A glass dome: you see everything, nothing gets out |

## Choice: stillsuit

- **It tells the mechanism.** A stillsuit recycles everything the body gives off and lets nothing escape; the
  sandbox lets nothing leave except through an allowlist.
- **It makes a series with wormsign.** In Dune, the wormsign is the ripple that warns of a sandworm; the stillsuit is
  what keeps you alive in the desert. One finds the worm, the other keeps it from draining you.
- **It is short, easy to say, easy to type** (`npx stillsuit claude`), with no hyphen and no number.
- **It is free where it matters**: npm and `stillsuit.dev`; the GitHub repositories with that name are small and
  unrelated (25 stars at most).
