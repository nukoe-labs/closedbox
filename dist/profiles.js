/** The hosts of the package registries, allowed for every agent so that it can install dependencies. */
export const REGISTRY_HOSTS = [
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "pypi.org",
    "files.pythonhosted.org",
    "proxy.golang.org",
    "sum.golang.org",
    "crates.io",
    "static.crates.io",
    "index.crates.io",
];
/** The hosts added by the github = true option, for git clone, git fetch and release downloads. */
export const GITHUB_HOSTS = ["github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com"];
const CLAUDE_PROFILE = {
    command: "claude",
    arguments: [],
    allow: ["api.anthropic.com", "claude.ai", "console.anthropic.com", "statsig.anthropic.com"],
    secrets: {
        ANTHROPIC_API_KEY: { host: "api.anthropic.com", header: "x-api-key", template: "{value}" },
        CLAUDE_CODE_OAUTH_TOKEN: { host: "api.anthropic.com", header: "authorization", template: "Bearer {value}" },
    },
};
const CODEX_PROFILE = {
    command: "codex",
    arguments: [],
    allow: ["api.openai.com", "auth.openai.com", "chatgpt.com"],
    secrets: {
        OPENAI_API_KEY: { host: "api.openai.com", header: "authorization", template: "Bearer {value}" },
    },
};
/** The shell profile runs the command given after --, or bash when there is none. */
const SHELL_PROFILE = {
    command: "",
    arguments: [],
    allow: [],
    secrets: {},
};
/** The starting profiles, by agent name. */
export const PROFILES = {
    claude: CLAUDE_PROFILE,
    codex: CODEX_PROFILE,
    shell: SHELL_PROFILE,
};
/** Returns the profile of an agent, or throws an error that lists the known agents. */
export function getProfile(agent) {
    const profile = PROFILES[agent];
    if (profile === undefined) {
        const knownAgents = Object.keys(PROFILES).join(", ");
        throw new RangeError(`Unknown agent "${agent}". Known agents: ${knownAgents}.`);
    }
    return profile;
}
