import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILE_CONFIG, resolveSettings } from "../src/config.js";
import { getProfile } from "../src/profiles.js";
import type { CommandResult, LineStream, Runner } from "../src/runner.js";
import { SYSTEM_RUNNER } from "../src/runner.js";
import { buildAgentArguments, buildAgentEnvironment, buildProxyArguments, detectRuntime, isMountablePath, type SessionPlan } from "../src/runtime.js";
import { buildProxyConfiguration, chooseCommand, EXIT_WORM_FOUND, homeVolumeName, launch, makePlaceholder, PROXY_START_TIMEOUT_MS, type Context, type LaunchOptions } from "../src/session.js";
import { trustConfig } from "../src/trust.js";
import { createFakeRunner, makeTemporaryFolder, wait, type FakeRunner, type Script } from "./helpers.js";

const READY = '{"ready":true}';
const BLOCKED_LINE = JSON.stringify({ action: "blocked", host: "evil.example", port: 443, sourcePort: 41000, reason: "not in the allowlist" });
const AUDIT_LINE = JSON.stringify({ action: "allowed", host: "cdn.example", port: 443, sourcePort: 41001, reason: "audit: not in the allowlist" });

/** Builds a runner that fakes the container engine and runs the real openssl, so that real certificates are made. */
function createEngineRunner(script: Script, streamLines: string[]): FakeRunner {
  const fake = createFakeRunner(script, streamLines);
  const fakeRun = fake.run;
  /** Sends openssl to the real runner and everything else to the fake one. */
  function run(command: string, argumentsList: string[], environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
    if (command === "openssl") {
      return SYSTEM_RUNNER.run(command, argumentsList, environment);
    }
    return fakeRun(command, argumentsList, environment);
  }
  /** Lets the agent run for a short while, as a real agent would, before it ends. */
  async function interactive(command: string, argumentsList: string[], environment: NodeJS.ProcessEnv): Promise<number> {
    await wait(150);
    return fakeInteractive(command, argumentsList, environment);
  }
  const fakeInteractive = fake.interactive;
  fake.run = run;
  fake.interactive = interactive;
  return fake;
}

/** Builds a context with temporary folders and collected output. */
function createContext(runner: Runner, environment: NodeJS.ProcessEnv, isTerminal = true): Context & { written: string[] } {
  const root = makeTemporaryFolder("session");
  const written: string[] = [];
  const paths = { config: join(root, "config"), state: join(root, "state"), cache: join(root, "cache"), packageFolder: "/pkg/dist" };
  return { runner, environment, paths, write: pushTo.bind(undefined, written), useColor: false, isTerminal, written };
}

/** Adds a text to a list. */
function pushTo(list: string[], text: string): void {
  list.push(text);
}

/** Builds launch options for a project. */
function createOptions(projectFolder: string, overrides: Partial<LaunchOptions> = {}): LaunchOptions {
  return { agent: "claude", argumentsList: ["--model", "x"], projectFolder, mode: "enforce", extraHosts: [], scan: true, runtime: "auto", liveJournal: false, ...overrides };
}

/** Lists the argument lists of the recorded calls of one kind. */
function listCalls(runner: FakeRunner, kind: string): string[][] {
  return runner.calls.filter(hasKind, kind).map(readArguments);
}

/** Tells whether a call is of the kind given as this. */
function hasKind(this: string, call: { kind: string }): boolean {
  return call.kind === this;
}

/** Returns the arguments of a call. */
function readArguments(call: { argumentsList: string[] }): string[] {
  return call.argumentsList;
}

/** Checks a full session: placeholders only, secrets only in the proxy, journal, cleanup and summary. */
async function runsAFullSession(): Promise<void> {
  const project = makeTemporaryFolder("project");
  writeFileSync(join(project, ".env"), "PASSWORD=x");
  const runner = createEngineRunner({ "run --rm": { code: 7 } }, [READY, BLOCKED_LINE]);
  const context = createContext(runner, { ANTHROPIC_API_KEY: "sk-ant-api03-REAL", PATH: process.env.PATH });
  const launching = launch(context, createOptions(project));
  await waitForStreams(runner, 2);
  runner.streams[1]?.onLine(JSON.stringify({ port: 41000, command: "node scripts/setup.js" }));
  await expect(launching).resolves.toBe(7);
  const interactive = runner.calls.find(isAgentRun);
  expect(interactive?.argumentsList.join(" ")).not.toContain("REAL");
  expect(interactive?.environment?.ANTHROPIC_API_KEY).toMatch(/^sk-ant-api03-/u);
  expect(interactive?.environment?.ANTHROPIC_API_KEY).toContain("stillsuit-placeholder");
  expect(interactive?.argumentsList).toEqual(expect.arrayContaining(["--model", "x", "type=bind,source=/dev/null,target=/workspace/.env,readonly"]));
  const proxyRun = runner.calls.find(isProxyRun);
  expect(proxyRun?.environment?.ANTHROPIC_API_KEY).toBe("sk-ant-api03-REAL");
  expect(JSON.parse(proxyRun?.environment?.STILLSUIT_PROXY_CONFIG ?? "{}").certificates["api.anthropic.com"].cert).toContain("BEGIN CERTIFICATE");
  expect(listCalls(runner, "run")).toContainEqual(expect.arrayContaining(["network", "rm"]));
  expect(runner.streams[1]?.sent).toEqual(["41000"]);
  expect(context.written.join("\n")).toContain("blocked 1 host(s): evil.example");
  const latest = readFileSync(join(context.paths.state, "latest"), "utf8");
  expect(readFileSync(latest, "utf8")).toContain("BLOCKED  evil.example:443  (by node scripts/setup.js)");
}

/** Waits until the session has started a number of streams. */
async function waitForStreams(runner: FakeRunner, count: number): Promise<void> {
  while (runner.streams.length < count) {
    await wait(5);
  }
}

/** Tells whether a call starts the agent. */
function isAgentRun(call: { kind: string }): boolean {
  return call.kind === "interactive";
}

/** Tells whether a call starts the proxy. */
function isProxyRun(call: { argumentsList: string[] }): boolean {
  return call.argumentsList.includes("-d");
}

/** Checks that audit mode writes the allowlist found, and that the journal is shown live without a terminal. */
async function writesTheAuditAllowlist(): Promise<void> {
  const project = makeTemporaryFolder("project");
  const runner = createEngineRunner({}, [READY, AUDIT_LINE]);
  const context = createContext(runner, {}, false);
  await launch(context, createOptions(project, { mode: "audit", agent: "shell", argumentsList: [] }));
  const audit = readFileSync(join(project, "stillsuit.audit.toml"), "utf8");
  expect(audit).toContain('"cdn.example"');
  expect(context.written.join("\n")).toContain("AUDIT");
  expect(context.written).toContain("allowed  cdn.example:443  [audit: not in the allowlist]\r");
}

/** Checks that a trapped project stops the start before any container, unless the scan is turned off. */
async function refusesATrappedProject(): Promise<void> {
  const project = makeTemporaryFolder("project");
  mkdirSync(join(project, ".claude"));
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node .claude/setup.js" }] }] } }));
  const runner = createEngineRunner({}, [READY]);
  const context = createContext(runner, {});
  await expect(launch(context, createOptions(project))).resolves.toBe(EXIT_WORM_FOUND);
  expect(runner.calls).toEqual([]);
  expect(context.written.join("\n")).toContain("the agent was not started");
  await expect(launch(context, createOptions(project, { scan: false }))).resolves.toBe(0);
  const quietProject = makeTemporaryFolder("project");
  writeFileSync(join(quietProject, "stillsuit.toml"), "[scan]\nwormsign = false\n");
  trustConfig(join(context.paths.config, "trusted.json"), quietProject, "[scan]\nwormsign = false\n");
  await expect(launch(context, createOptions(quietProject))).resolves.toBe(0);
}

/** Checks that a new or changed stillsuit.toml is refused until approved. */
async function refusesAnUnapprovedConfig(): Promise<void> {
  const project = makeTemporaryFolder("project");
  writeFileSync(join(project, "stillsuit.toml"), '[network]\nallow = ["evil.example"]\n');
  const context = createContext(createEngineRunner({}, [READY]), {});
  await expect(launch(context, createOptions(project))).rejects.toThrow("stillsuit trust");
}

/** Checks that a failed start still removes what was created. */
async function cleansUpAfterAFailedStart(): Promise<void> {
  const project = makeTemporaryFolder("project");
  const runner = createEngineRunner({ "network create": { code: 1, stderr: "no space\n" } }, []);
  await expect(launch(createContext(runner, {}), createOptions(project, { agent: "codex" }))).rejects.toThrow("network create failed: no space");
  expect(listCalls(runner, "run")).toContainEqual(expect.arrayContaining(["network", "rm"]));
}

/** Checks that stillsuit gives up when the proxy never says it is ready. */
async function givesUpWhenTheProxyNeverStarts(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const project = makeTemporaryFolder("project");
  const runner = createEngineRunner({}, []);
  const launching = launch(createContext(runner, {}), createOptions(project, { agent: "shell" }));
  const failure = expect(launching).rejects.toThrow("did not start in time");
  await waitForFirstStream(runner);
  await vi.advanceTimersByTimeAsync(PROXY_START_TIMEOUT_MS + 100);
  await failure;
}

/** Waits until the session follows the proxy output. */
async function waitForFirstStream(runner: FakeRunner): Promise<void> {
  while (runner.streams.length === 0) {
    await vi.advanceTimersByTimeAsync(10);
  }
}

/** Puts the real timers back after each test. */
function restoreTimers(): void {
  vi.useRealTimers();
}

/** Checks the choice of the container engine. */
async function detectsTheEngine(): Promise<void> {
  await expect(detectRuntime(createFakeRunner(), "auto")).resolves.toBe("docker");
  await expect(detectRuntime(createFakeRunner({ "docker info": { code: 1 } }), "auto")).resolves.toBe("podman");
  await expect(detectRuntime(createFakeRunner(), "podman")).resolves.toBe("podman");
  await expect(detectRuntime(createFakeRunner({ info: { code: 1 } }), "docker")).rejects.toThrow("No running container engine");
}

/** Builds a plan for the argument tests. */
function createPlan(overrides: Partial<SessionPlan>): SessionPlan {
  const settings = resolveSettings(getProfile("claude"), DEFAULT_FILE_CONFIG, [], { ANTHROPIC_API_KEY: "k" });
  return { id: "abcd", projectFolder: "/p", packageFolder: "/pkg", agentImage: "img", proxyImage: "proxy", command: "claude", argumentsList: [], settings, masks: [], placeholders: { ANTHROPIC_API_KEY: "ph" }, useTerminal: false, homeVolume: "home", ...overrides };
}

/** Checks the arguments of both containers: internal network, no privileges, masks and environment by name only. */
function buildsHardenedArguments(): void {
  const masks = [{ path: ".aws", isFolder: true }, { path: "a,b.pem", isFolder: false }];
  const agent = buildAgentArguments(createPlan({ masks, useTerminal: true }));
  expect(agent).toEqual(expect.arrayContaining(["-it", "--network", "stillsuit-net-abcd", "--dns", "192.0.2.1", "--cap-drop", "ALL", "no-new-privileges", "type=tmpfs,destination=/workspace/.aws,tmpfs-size=1m", "home:/home/node"]));
  expect(agent.join(" ")).not.toContain("a,b.pem");
  expect(agent).not.toContain("ph");
  expect(isMountablePath({ path: 'x"y', isFolder: false })).toBe(false);
  expect(buildAgentEnvironment(createPlan({})).HTTPS_PROXY).toBe("http://stillsuit-proxy:3128");
  expect(buildProxyArguments(createPlan({}))).toEqual(expect.arrayContaining(["-e", "ANTHROPIC_API_KEY", "--read-only", "/pkg:/opt/stillsuit:ro"]));
  expect(JSON.parse(buildProxyConfiguration(createPlan({}), "audit", {})).policy).toMatchObject({ mode: "audit", allowPrivate: false });
}

/** Checks the small helpers of the session. */
function buildsPlaceholdersNamesAndCommands(): void {
  expect(makePlaceholder("sk-ant-oat01-secret")).toMatch(/^sk-ant-oat01-stillsuit/u);
  expect(makePlaceholder("other")).toMatch(/^stillsuit-placeholder/u);
  expect(homeVolumeName("claude", "/a")).not.toBe(homeVolumeName("claude", "/b"));
  expect(chooseCommand("claude", ["-p"])).toEqual({ command: "claude", argumentsList: ["-p"] });
  expect(chooseCommand("", ["node", "x.js"])).toEqual({ command: "node", argumentsList: ["x.js"] });
  expect(chooseCommand("", [])).toEqual({ command: "bash", argumentsList: [] });
  expect(existsSync("/pkg/dist")).toBe(false);
}

/** Keeps the type of LineStream used, so that the fake streams stay compatible with the real ones. */
export type UsedStream = LineStream;

describe("session", describeSession);

/** Groups the session tests. */
function describeSession(): void {
  afterEach(restoreTimers);
  it("runs a full session", runsAFullSession);
  it("writes the audit allowlist", writesTheAuditAllowlist);
  it("refuses a trapped project", refusesATrappedProject);
  it("refuses an unapproved config", refusesAnUnapprovedConfig);
  it("cleans up after a failed start", cleansUpAfterAFailedStart);
  it("gives up when the proxy never starts", givesUpWhenTheProxyNeverStarts);
  it("detects the engine", detectsTheEngine);
  it("builds hardened arguments", buildsHardenedArguments);
  it("builds placeholders, names and commands", buildsPlaceholdersNamesAndCommands);
}
