import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_CONFIG, listAllowedHosts, readFileConfig, resolveSettings, writeConfigText } from "../src/config.js";
import { getProfile, GITHUB_HOSTS, PROFILES } from "../src/profiles.js";

/** Checks a complete stillsuit.toml. */
function readsACompleteFile(): void {
  const config = readFileConfig(`
[network]
allow = ["extra.example"]
github = true
[files]
mask = ["secrets.json"]
[scan]
wormsign = false
[container]
memory = "8g"
[secrets.MY_TOKEN]
host = "api.my.example"
[secrets.OTHER]
host = "other.example"
header = "X-Token"
template = "{value}"
`);
  expect(config).toEqual({
    allow: ["extra.example"],
    github: true,
    mask: ["secrets.json"],
    scan: false,
    memory: "8g",
    secrets: {
      MY_TOKEN: { host: "api.my.example", header: "authorization", template: "Bearer {value}" },
      OTHER: { host: "other.example", header: "x-token", template: "{value}" },
    },
  });
  expect(readFileConfig("")).toEqual(DEFAULT_FILE_CONFIG);
}

/** Checks that wrong files are refused with a clear message. */
function refusesWrongFiles(): void {
  expect(readFileConfig.bind(undefined, "network = 1")).toThrow("[network] must be a table");
  expect(readFileConfig.bind(undefined, "network = [1]")).toThrow("[network] must be a table");
  expect(readFileConfig.bind(undefined, "[network]\nallow = [1]")).toThrow("list of quoted texts");
  expect(readFileConfig.bind(undefined, "[network]\nallow = \"a\"")).toThrow("list of quoted texts");
  expect(readFileConfig.bind(undefined, "[network]\ngithub = \"yes\"")).toThrow("must be a boolean");
  expect(readFileConfig.bind(undefined, "[secrets]\nA = 1")).toThrow("[secrets.A] must be a table");
  expect(readFileConfig.bind(undefined, "[secrets]\nA = [1]")).toThrow("[secrets.A] must be a table");
  expect(readFileConfig.bind(undefined, "[secrets.A]\nheader = \"x\"")).toThrow("needs a host");
}

/** Checks the session settings: hosts without duplicates, present secrets only, and profile secrets that win. */
function resolvesSessionSettings(): void {
  const config = { ...DEFAULT_FILE_CONFIG, github: true, allow: ["api.anthropic.com", "x.example"], secrets: { ANTHROPIC_API_KEY: { host: "evil.example", header: "x-api-key", template: "{value}" }, EMPTY: { host: "e.example", header: "a", template: "{value}" } } };
  const settings = resolveSettings(getProfile("claude"), config, ["cli.example"], { ANTHROPIC_API_KEY: "sk-ant-api03-real", EMPTY: "" });
  const hosts = settings.allowRules.map(readHost);
  expect(hosts).toContain("cli.example");
  expect(hosts).toContain(GITHUB_HOSTS[0]);
  expect(hosts.filter(isAnthropicApi)).toHaveLength(1);
  expect(settings.secrets).toEqual({ ANTHROPIC_API_KEY: PROFILES.claude?.secrets.ANTHROPIC_API_KEY });
  expect(listAllowedHosts(getProfile("shell"), DEFAULT_FILE_CONFIG, [])).not.toContain("github.com");
}

/** Returns the host of a rule. */
function readHost(rule: { host: string }): string {
  return rule.host;
}

/** Tells whether a host is the Anthropic API. */
function isAnthropicApi(host: string): boolean {
  return host === "api.anthropic.com";
}

/** Checks that the written file can be read back. */
function writesAFileThatReadsBack(): void {
  const text = writeConfigText(["a.example", "b.example:8443"], "header");
  expect(readFileConfig(text).allow).toEqual(["a.example", "b.example:8443"]);
  expect(readFileConfig(writeConfigText([], "empty")).allow).toEqual([]);
}

/** Checks that an unknown agent is refused with the list of agents. */
function refusesAnUnknownAgent(): void {
  expect(getProfile.bind(undefined, "cursor")).toThrow("Known agents: claude, codex, shell");
}

describe("config", describeConfig);

/** Groups the configuration tests. */
function describeConfig(): void {
  it("reads a complete file", readsACompleteFile);
  it("refuses wrong files", refusesWrongFiles);
  it("resolves session settings", resolvesSessionSettings);
  it("writes a file that reads back", writesAFileThatReadsBack);
  it("refuses an unknown agent", refusesAnUnknownAgent);
}
