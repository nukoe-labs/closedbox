import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanLeftovers, createSystemContext, initConfig, main, parseCommandLine, resolvePaths, run, trustProjectConfig, USAGE, VERSION, watchJournal } from "../src/cli.js";
import { SYSTEM_RUNNER } from "../src/runner.js";
import type { Context } from "../src/session.js";
import { isTrusted } from "../src/trust.js";
import { createFakeRunner, makeTemporaryFolder, wait } from "./helpers.js";

/** Builds a context with temporary folders and collected output. */
function createContext(runner = createFakeRunner()): Context & { written: string[] } {
  const root = makeTemporaryFolder("cli");
  const written: string[] = [];
  const paths = { config: join(root, "config"), state: join(root, "state"), cache: join(root, "cache"), packageFolder: root };
  return { runner, environment: {}, paths, write: pushTo.bind(undefined, written), useColor: false, isTerminal: false, written };
}

/** Adds a text to a list. */
function pushTo(list: string[], text: string): void {
  list.push(text);
}

/** Checks every form of the command line. */
function readsTheCommandLine(): void {
  expect(parseCommandLine([], "/w")).toEqual({ command: "help", projectFolder: "/w" });
  expect(parseCommandLine(["-h"], "/w").command).toBe("help");
  expect(parseCommandLine(["--version"], "/w").command).toBe("version");
  expect(parseCommandLine(["watch"], "/w").command).toBe("watch");
  const launch = parseCommandLine(["claude", "--allow", "a.example", "--dangerously-skip-permissions", "--no-scan", "--live", "--runtime", "podman", "--project", "/tmp/x", "--", "--allow", "b"], "/w");
  expect(launch).toEqual({ command: "launch", options: { agent: "claude", argumentsList: ["--dangerously-skip-permissions", "--allow", "b"], projectFolder: "/tmp/x", mode: "enforce", extraHosts: ["a.example"], scan: false, runtime: "podman", liveJournal: true } });
  expect(parseCommandLine(["audit", "codex"], "/w")).toMatchObject({ options: { agent: "codex", mode: "audit" } });
}

/** Checks the refused command lines. */
function refusesWrongCommandLines(): void {
  expect(parseCommandLine.bind(undefined, ["cursor"], "/w")).toThrow('Unknown agent "cursor"');
  expect(parseCommandLine.bind(undefined, ["audit"], "/w")).toThrow('Unknown agent ""');
  expect(parseCommandLine.bind(undefined, ["claude", "--allow"], "/w")).toThrow("--allow needs a value");
  expect(parseCommandLine.bind(undefined, ["claude", "--runtime", "--live"], "/w")).toThrow("--runtime needs a value");
}

/** Checks the XDG folders. */
function resolvesTheFolders(): void {
  expect(resolvePaths({}, "/home/a", "/pkg")).toEqual({ config: "/home/a/.config/stillsuit", state: "/home/a/.local/state/stillsuit", cache: "/home/a/.cache/stillsuit", packageFolder: "/pkg" });
  expect(resolvePaths({ XDG_CONFIG_HOME: "/c", XDG_STATE_HOME: "/s", XDG_CACHE_HOME: "/k" }, "/home/a", "/pkg")).toMatchObject({ config: "/c/stillsuit", state: "/s/stillsuit", cache: "/k/stillsuit" });
}

/** Checks init and trust, which approve the file they show or write. */
function initializesAndTrustsTheConfig(): void {
  const context = createContext();
  const project = makeTemporaryFolder("project");
  expect(trustProjectConfig(context, project)).toBe(1);
  expect(initConfig(context, project)).toBe(0);
  expect(initConfig(context, project)).toBe(1);
  const configPath = join(project, "stillsuit.toml");
  expect(isTrusted(join(context.paths.config, "trusted.json"), project, readFileSync(configPath, "utf8"))).toBe(true);
  appendFileSync(configPath, "# changed\n");
  expect(trustProjectConfig(context, project)).toBe(0);
  expect(context.written.join("\n")).toContain("# changed");
}

/** Checks the removal of leftovers, with and without containers. */
async function removesLeftovers(): Promise<void> {
  const runner = createFakeRunner({ "ps -aq": { stdout: "a1\nb2\n" } });
  const context = createContext(runner);
  await expect(cleanLeftovers(context, "auto")).resolves.toBe(0);
  expect(runner.calls[1]?.argumentsList).toEqual(["rm", "-f", "a1", "b2"]);
  const empty = createFakeRunner();
  await cleanLeftovers(createContext(empty), "podman");
  expect(empty.calls.map(readCommand)).toEqual(["podman", "podman"]);
}

/** Returns the command of a recorded call. */
function readCommand(call: { command: string }): string {
  return call.command;
}

/** Checks that watch prints the journal and the lines added later. */
async function followsTheJournal(): Promise<void> {
  const context = createContext();
  expect(watchJournal(context, 20)).toBeUndefined();
  mkdirSync(context.paths.state, { recursive: true });
  const logPath = join(context.paths.state, "session.log");
  writeFileSync(logPath, "first\n");
  writeFileSync(join(context.paths.state, "latest"), `${logPath}\n`);
  const watcher = watchJournal(context, 20);
  await wait(60);
  appendFileSync(logPath, "second\n");
  await wait(200);
  appendFileSync(logPath, "");
  writeFileSync(logPath, "first\nsecond\n");
  await wait(200);
  watcher?.stop();
  expect(context.written).toEqual(["No session yet.", "first", "second"]);
}

/** Checks that run dispatches each command and turns errors into messages. */
async function runsEachCommand(): Promise<void> {
  const context = createContext();
  const project = makeTemporaryFolder("project");
  await expect(run(["--version"], context, project)).resolves.toBe(0);
  await expect(run([], context, project)).resolves.toBe(0);
  await expect(run(["init"], context, project)).resolves.toBe(0);
  await expect(run(["trust"], context, project)).resolves.toBe(0);
  await expect(run(["clean"], context, project)).resolves.toBe(0);
  await expect(run(["watch"], context, project)).resolves.toBe(0);
  await expect(run(["nope"], context, project)).resolves.toBe(2);
  await expect(run(["shell", "--no-scan"], createContext(createFakeRunner({ info: { code: 1 } })), project)).resolves.toBe(2);
  expect(context.written).toContain(VERSION);
  expect(context.written).toContain(USAGE);
}

/** Checks the real context and the real entry point. */
async function buildsTheRealContext(): Promise<void> {
  const context = createSystemContext(SYSTEM_RUNNER, { NO_COLOR: "1" }, { input: true, error: true });
  expect(context.useColor).toBe(false);
  expect(context.isTerminal).toBe(true);
  expect(createSystemContext(SYSTEM_RUNNER, {}, { input: false, error: true }).useColor).toBe(true);
  expect(context.paths.packageFolder).toMatch(/src$/u);
  await expect(main(["--version"])).resolves.toBe(0);
}

describe("cli", describeCli);

/** Groups the command line tests. */
function describeCli(): void {
  it("reads the command line", readsTheCommandLine);
  it("refuses wrong command lines", refusesWrongCommandLines);
  it("resolves the folders", resolvesTheFolders);
  it("initializes and trusts the config", initializesAndTrustsTheConfig);
  it("removes leftovers", removesLeftovers);
  it("follows the journal", followsTheJournal);
  it("runs each command", runsEachCommand);
  it("builds the real context", buildsTheRealContext);
}
