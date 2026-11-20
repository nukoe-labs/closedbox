# stillsuit

**Run Claude Code or Codex in a container with one command. The network is closed except for an allowlist you can
read, your API keys never enter the container, and every blocked connection is named with the process that tried it.**

[![CI](https://github.com/nukoe-labs/stillsuit/actions/workflows/ci.yml/badge.svg)](https://github.com/nukoe-labs/stillsuit/actions/workflows/ci.yml)
[![Escape tests](https://github.com/nukoe-labs/stillsuit/actions/workflows/escape.yml/badge.svg)](https://github.com/nukoe-labs/stillsuit/actions/workflows/escape.yml)
![coverage 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

```sh
npx github:nukoe-labs/stillsuit claude
```

![A trapped repository: wormsign flags its SessionStart hook, then stillsuit blocks the exfiltration and names the process](docs/demo.gif)

*A harmless trapped repository: wormsign flags its SessionStart hook; when the hook runs anyway, stillsuit blocks the
connection and names the process. Reproduce it with `bash demo/run-demo.sh`.*

## Why

In November 2026, the Mini Shai-Hulud and Miasma worms spread through repositories that start a script **as soon as
an agent opens the folder**: a `SessionStart` hook in `.claude/settings.json`, a `folderOpen` task in
`.vscode/tasks.json`. The script reads `~/.npmrc`, `~/.ssh`, cloud credentials and the AI API key from the
environment, then sends them out. Opening a repository became running it.

stillsuit makes "open this repository with my agent" safe by default:

| | Plain `claude` | `stillsuit claude` |
|---|---|---|
| Files the agent can read | your whole home folder | the project folder only, without `.env`, keys and cloud folders |
| Network | anywhere | the allowlist only (Anthropic API, package registries), through a proxy |
| Your `ANTHROPIC_API_KEY` | in the agent's environment | outside; the proxy adds it to requests to `api.anthropic.com` only |
| A planted script calls `evil.example` | it works, silently | `BLOCKED  evil.example:443  (by node scripts/setup.js)` |
| A trapped repository | the hook runs at once | wormsign finds it first and the agent does not start |
| `docker.sock`, `sudo`, capabilities | yours | none |

## Install and run

You need Node.js 20 or later and Docker (Docker Desktop, OrbStack, Colima, Rancher Desktop) or Podman.

```sh
cd some-repository-you-did-not-write
npx github:nukoe-labs/stillsuit claude            # Claude Code
npx github:nukoe-labs/stillsuit codex             # Codex
npx github:nukoe-labs/stillsuit shell -- npm test # any command
```

The first run builds a local image with Claude Code and Codex (about a minute). Arguments after the agent name go to
the agent: `stillsuit claude --dangerously-skip-permissions` is now a reasonable thing to type.

| Command | What it does |
|---|---|
| `stillsuit <agent> [args]` | start `claude`, `codex` or `shell` in the sandbox |
| `stillsuit audit <agent>` | let everything through once, then write `stillsuit.audit.toml` with every host seen |
| `stillsuit init` | write a commented `stillsuit.toml` |
| `stillsuit trust` | show and approve the `stillsuit.toml` of this folder |
| `stillsuit watch` | follow the journal of the running session in another terminal |
| `stillsuit clean` | remove containers and networks left by a crash |

Options: `--allow <host>` (repeatable), `--no-scan`, `--live` (journal on this terminal), `--runtime docker|podman`,
`--project <folder>`.

## The journal

Every connection goes through the proxy, which writes one line per decision (example below, process names shortened). stillsuit finds the process that opened
the connection from inside the container (`/proc/net/tcp`, then the socket owner):

```text
allowed  registry.npmjs.org:443  (by npm install)
secret   api.anthropic.com:443  (by claude)
BLOCKED  evil.example:443  (by node scripts/setup.js)  [not in the allowlist]
BLOCKED  169.254.169.254:80  (by curl -s http://169.254.169.254/latest/meta-data/)  [not in the allowlist]
```

`stillsuit watch` follows it live in another terminal; the summary is printed when the agent ends.

## Configuration

Nothing is required. To add hosts for a project, run `stillsuit audit claude`, use the project normally, then read
`stillsuit.audit.toml` and rename it `stillsuit.toml`:

```toml
[network]
# Hosts allowed on top of the agent profile and the package registries.
allow = ["api.stripe.com", "*.supabase.co", "staging.example.com:8443"]
# Set to true to allow git clone, git fetch and downloads from GitHub.
github = false

[files]
# Hidden from the agent on top of .env, .env.*, *.pem, *.key, id_rsa*, id_ed25519*, .npmrc, .pypirc, .netrc,
# .aws, .ssh, .docker and .kube.
mask = ["config/credentials.yml"]

[scan]
wormsign = true

[secrets.STRIPE_TEST_KEY]
# Read from your environment, given to the agent as a placeholder, written by the proxy only towards this host.
host = "api.stripe.com"
header = "authorization"
template = "Bearer {value}"
```

**A repository can ship its own `stillsuit.toml`** to allow its exfiltration host. stillsuit refuses any new or
changed `stillsuit.toml` until you run `stillsuit trust`, which shows it first. A file cannot move the keys of the
built-in profiles to another host.

Default allowlist: the agent's API and login hosts, plus `registry.npmjs.org`, `registry.yarnpkg.com`, `pypi.org`,
`files.pythonhosted.org`, `proxy.golang.org`, `sum.golang.org`, `crates.io`, `static.crates.io`, `index.crates.io`.
GitHub is off unless `github = true`.

## How it works

```text
 your computer                       container engine
 ─────────────                       ──────────────────────────────────────────────────────────────
 stillsuit ──► wormsign scan          internal network (no route out, DNS to 192.0.2.1)
     │                                ┌───────────────────────────────┐      ┌─────────────────────┐
     ├─► ANTHROPIC_API_KEY ─────────► │ proxy  (node, read-only,      │ ───► │ api.anthropic.com   │
     │   (never on a command line)    │ no capabilities)              │      │ registry.npmjs.org  │
     │                                │ allowlist, key injection,     │      └─────────────────────┘
     │                                │ one JSON line per decision    │
     │                                └──────────────▲────────────────┘
     │                                               │ HTTPS_PROXY only
     │                                ┌──────────────┴────────────────┐
     └─► journal ◄─ process name ──── │ agent  (uid 1000, no caps,    │
                                      │ no-new-privileges)            │
                                      │ /workspace = project folder   │
                                      │ .env → /dev/null, .aws → tmpfs│
                                      │ key = placeholder             │
                                      └───────────────────────────────┘
```

1. **wormsign** reads the agent and editor configuration files of the folder (hooks, `folderOpen` tasks, MCP
   servers, instruction files) and stops on a worm sign.
2. The **agent container** sits on a Docker `--internal` network: no default route, no external DNS. Its only way out
   is the proxy. It runs as uid 1000 with every capability dropped and `no-new-privileges`; it has no Docker socket and
   no host folder except the project. Its home folder is a volume per agent and per project.
3. The **proxy container** is the only one on a normal network. It refuses hosts outside the allowlist, IP literals
   that are not listed, and any name that resolves to a private, loopback or link-local address (cloud metadata,
   your router, host services). For the hosts that receive a key, it terminates TLS with a certificate from a local CA
   trusted only inside the agent image, writes the real key into the request, removes any other credential header, and
   re-encrypts towards the real host with normal certificate checks.
4. A refused connection is held for 1.5 seconds so that a helper in the agent container can name the process.

## Security tests

[`test/escape/probes.sh`](test/escape/probes.sh) runs 30 escape attempts inside a real sandbox on every push
([escape workflow](.github/workflows/escape.yml)); the job fails if any of them works, or if the allowed control host
is unreachable:

- direct TCP and raw sockets to the Internet, IPv4 and IPv6, ICMP;
- DNS exfiltration through the resolver, UDP to 8.8.8.8, TCP to 1.1.1.1, DNS over HTTPS;
- proxy: hosts outside the allowlist (CONNECT and plain HTTP), IP literals, `169.254.169.254`, `host.docker.internal`,
  the Docker API on the host, a swapped `Host` header;
- secrets: a canary file in the host home folder, `~/.ssh`, `~/.aws`, the project `.env` and a private key in the
  project, the real API key and a GitHub token in any process environment;
- privileges: Docker or Podman socket, capabilities, `no_new_privs`, `sudo`, `su`, `mount`, writing to `/etc`, root,
  `nsenter`.

The unit tests cover 100 % of lines, branches and functions, including the proxy with real TLS servers.

## Limits, said plainly

- A container shares the host kernel: a kernel exploit escapes it. A micro-VM is stronger.
- The allowlist decides **where** data can go, not **what** goes there. A host that accepts uploads can carry data out
  if you allow it with a token that can write.
- The agent can use the key it does not see, but only towards its own host, and only for your account.
- `stillsuit` starts Docker containers, so it needs the Docker socket on **your** side; the agent never gets it.
- Apple `container` is not supported yet: it has no internal network that blocks egress.
- Process names are best effort: a connection that closes before the helper looks at it is written without a name.

## Part of a series

- [wormsign](https://github.com/nukoe-labs/wormsign) finds agent worms in a GitHub account or a local folder.
- [awesome-coding-agent-security](https://github.com/nukoe-labs/awesome-coding-agent-security) lists attacks,
  advisories and defenses for coding agents.

In Dune, the wormsign warns you that a sandworm is coming, and the stillsuit keeps every drop of you inside.

## More

- [Audit of existing sandboxes](docs/audit.md): devcontainers, Claude Code sandbox, Codex sandbox, container-use, E2B,
  Daytona, firejail, bubblewrap, claudebox, leash, nono, OneCLI, coop and others, with their stars and gaps.
- [Why the name](docs/naming.md).
- [Security policy](SECURITY.md).

## License

MIT
