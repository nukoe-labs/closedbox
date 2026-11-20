# Audit of existing sandboxes for coding agents

Measured on 2026-11-20. Stars come from the GitHub API on that day. "Gap" lists what is missing **for this use case**:
open an untrusted repository with Claude Code or Codex, without letting a hook, a postinstall script or a prompt
injection read your keys or send them anywhere.

The bar stillsuit sets for itself:

1. **One command**, nothing to write first: `npx stillsuit claude`.
2. **Any agent**: Claude Code, Codex, or any command (`stillsuit shell -- ...`).
3. **Network denied by default**, with an allowlist a person can read in ten seconds.
4. **Secrets never mounted**: API keys are injected by a proxy, only towards their own host; the agent sees a placeholder.
5. **A journal of every refused connection**, with the process that asked for it.
6. **Only the project folder is mounted**, minus `.env` and keys; nothing from `$HOME`.
7. **A scan before start** (wormsign), because the hook runs before the first prompt.

## Projects reviewed

| Project | Stars | What it is | Gap for this use case |
|---|---:|---|---|
| [anthropics/claude-code](https://github.com/anthropics/claude-code) `.devcontainer` | 156,405 (repo) | Reference dev container with an `iptables` firewall script (`init-firewall.sh`) that allows npm, GitHub and the Anthropic API | Needs VS Code or the devcontainers CLI and a copy of the files into each project; allowlist by IP ranges resolved at start, not by host name; the API key or login lives inside the container; no journal of refused connections; Claude only |
| Claude Code `sandbox` setting, built on [anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime) (`srt`) | 7,197 | OS sandbox (Seatbelt on macOS, bubblewrap on Linux) with a domain allowlist enforced by a local proxy | Not a container: the agent runs on the host kernel with the host user; reads are allowed by default outside denied paths, so the home folder is visible unless you list every secret; the agent process itself keeps its API key |
| [openai/codex](https://github.com/openai/codex) sandbox | 135,961 (repo) | Seatbelt on macOS, Landlock and seccomp on Linux; network off in `workspace-write` | Codex only; network is all or nothing (no allowlist); the key stays in the agent process; no journal of refused connections |
| [dagger/container-use](https://github.com/dagger/container-use) | 4,099 | MCP server that gives each agent its own container and git branch | Isolates the work of the agent, not the agent itself: the agent runs on the host; no egress allowlist; needs Dagger |
| [e2b-dev/E2B](https://github.com/e2b-dev/E2B) | 14,942 | Cloud micro-VMs for running AI-generated code | Cloud service with an account and an API key; made for code execution through an SDK, not for running Claude Code on a local repository |
| [daytonaio/daytona](https://github.com/daytonaio/daytona) | 71,308 (archived) | Infrastructure for AI-generated code sandboxes | Archived; cloud or self-hosted platform, not a one-line local command |
| [netblue30/firejail](https://github.com/netblue30/firejail) | 7,745 | Linux SUID sandbox with profiles | Linux only, SUID binary; network filtering by interface or `netfilter` rules, no host allowlist proxy; no secret injection |
| [containers/bubblewrap](https://github.com/containers/bubblewrap) | 9,562 | Unprivileged Linux namespaces | A building block: no network allowlist, no secrets handling, Linux only |
| [google/nsjail](https://github.com/google/nsjail) | 4,200 | Linux process isolation with seccomp | Building block; no allowlist by host name; Linux only |
| [RchGrav/claudebox](https://github.com/RchGrav/claudebox) | 1,180 | Docker environment for Claude Code with profiles and a per-project firewall allowlist | Claude only; the agent holds its credentials; firewall by IP inside the container; no journal naming the process; no scan before start |
| [trailofbits/claude-code-devcontainer](https://github.com/trailofbits/claude-code-devcontainer) | 982 | Hardened dev container for audits with Claude Code | Claude only; the OAuth token is passed into the container (`CLAUDE_CODE_OAUTH_TOKEN`); no egress allowlist proxy or refusal journal |
| [strongdm/leash](https://github.com/strongdm/leash) | 601 | Wraps agents in containers with Cedar policies, file and network telemetry, MCP observer | Closest in spirit. Policies are written in Cedar; credential injection by a proxy is not documented in its README; no wormsign-style scan of the repository before start |
| [nikvdp/cco](https://github.com/nikvdp/cco) | 432 | Sandbox wrapper for Claude Code (native sandbox or Docker) | Native mode exposes the whole host read-only; full host network by design (README) |
| [superagent-ai/vibekit](https://github.com/superagent-ai/vibekit) | 1,872 | SDK to run coding agents in sandboxes (cloud providers), with secret redaction in output | Cloud sandbox providers; redaction of output, not keeping the key out of the agent |
| [agent-infra/sandbox](https://github.com/agent-infra/sandbox) | 6,371 | All-in-one container (browser, shell, VS Code) for agents | Built to give agents tools, not to confine an agent on your repository; no egress allowlist |
| [superradcompany/microsandbox](https://github.com/superradcompany/microsandbox) | 9,152 | Self-hosted micro-VMs for untrusted code | Strong isolation, but a server and SDK for running code, not a launcher for Claude Code or Codex on a local folder |
| [nolabs-ai/nono](https://github.com/nolabs-ai/nono) | 5,054 | Landlock (Linux) and Seatbelt (macOS) sandbox with a credential-injecting network proxy | The strongest overlap on keys: it already keeps API keys out of the agent. It is not a container (host kernel, host user, capability rules to write per tool); no scan of the repository before start |
| [onecli/onecli](https://github.com/onecli/onecli) | 3,647 | Credential vault: an HTTP gateway injects API keys so agents never hold them | Solves the key part only: no sandbox around the agent, no egress allowlist for other hosts |
| [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) | 21,827 | Sandboxed runtime for autonomous agents governed by declarative YAML policies | A runtime platform with its own policy language, not a one-line launcher for Claude Code or Codex on a local folder |
| [trailofbits/coop](https://github.com/trailofbits/coop) | 818 | Runs Claude Code and Codex in disposable microVMs (Firecracker on Linux, Lima on macOS) | Stronger isolation than a container; network allowlisting, key injection and a refusal journal are not its focus |
| [eugene1g/agent-safehouse](https://github.com/eugene1g/agent-safehouse) | 2,152 | macOS `sandbox-exec` profiles for coding agents, deny first | macOS only, host kernel and user; keys stay in the agent |
| [pipelab-org/pipelock](https://github.com/pipelab-org/pipelock) | 1,010 | Egress proxy with DLP scanning, SSRF protection and MCP response scanning | An egress layer to wire around your own agent setup, not a launcher that confines the agent |
| [textcortex/claude-code-sandbox](https://github.com/textcortex/claude-code-sandbox) | 324 (archived) | Claude Code in Docker containers | Archived |

## Where stillsuit stands

Each piece exists somewhere: nono and OneCLI keep keys out of the agent, the Claude Code devcontainer and claudebox
filter egress, coop and microsandbox isolate harder with microVMs. What stillsuit adds is the combination, in one
`npx` command, for any agent, with Docker or Podman:

- **A container on a network with no route out**, whose only exit is an allowlist proxy, so a planted script cannot
  bypass the proxy by ignoring `HTTPS_PROXY`.
- **The key outside the container**: the agent gets a placeholder; the proxy writes the real key only towards its own
  host, and removes any other credential header there, so a planted script cannot spend tokens on an attacker's
  account through an allowed host.
- **A refusal journal that names the process**: "BLOCKED evil.example:443 (by node scripts/setup.js)".
- **An allowlist written from what the project really needs**: `stillsuit audit claude` lets everything through once,
  then writes `stillsuit.audit.toml` with the hosts seen.
- **A repository's own configuration refused until approved**: a trapped repository can ship a `stillsuit.toml` that
  allows its exfiltration host; stillsuit refuses any new or changed file until `stillsuit trust`.
- **A scan before the first prompt**: SessionStart hooks run as soon as the agent opens the folder, so stillsuit runs
  the wormsign rules on the folder first and does not start on a worm sign.
- **Escape tests in CI**: 30 attempts against a real sandbox on every push.

## Honest limits of stillsuit

- A container shares the host kernel. A kernel exploit escapes it; micro-VMs (E2B, microsandbox) do not have that risk.
- An allowlist limits **where** data can go, not **what** is sent there. An allowed host that accepts uploads
  (a package registry with a token, GitHub with `github = true`) can still carry data out.
- Requests to the hosts that receive a key are decrypted by the proxy with a local CA that only the agent image trusts.
- Apple `container` is not supported yet: stillsuit needs an internal network with no route out, and uses Docker
  (Docker Desktop, OrbStack, Colima, Rancher Desktop) or Podman.
