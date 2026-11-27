import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanLeftovers, createSystemContext, initConfig, main, parseCommandLine, resolvePaths, run, trustProjectConfig, HELP_HINT, USAGE, VERSION, watchJournal } from "../src/cli.js";
import { SYSTEM_RUNNER } from "../src/runner.js";
import type { Context } from "../src/session.js";
import { isTrusted } from "../src/trust.js";
import { createFakeRunner, makeTemporaryFolder, wait } from "./helpers.js";

/** Builds a context with temporary folders and collected output. */
function createContext(runner = createFakeRunner()): Context & { written: string[] } {
  const root = makeTemporaryFolder("cli");
  const written: string[] = [];
  const paths = { config: join(root, "config"), state: join(root, "state"), cache: join(root, "cache"), packageFolder: root };
  return { runner, environment: {}, paths, write: pushTo.bind(undefined, written), useColor: false, isTerminal: false, user: { uid: 1000, gid: 1000 }, written };
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
  const withEqualSigns = parseCommandLine(["claude", "--allow=a.example", "--runtime=podman", "--project=/tmp/x", "--", "--allow=b"], "/w");
  expect(withEqualSigns).toEqual({ command: "launch", options: { agent: "claude", argumentsList: ["--allow=b"], projectFolder: "/tmp/x", mode: "enforce", extraHosts: ["a.example"], scan: true, runtime: "podman", liveJournal: false } });
  expect(parseCommandLine(["--allow=a.example", "shell"], "/w")).toMatchObject({ options: { agent: "shell", extraHosts: ["a.example"] } });
  expect(parseCommandLine(["shell", "--allow=a=b"], "/w")).toMatchObject({ options: { extraHosts: ["a=b"] } });
  expect(parseCommandLine.bind(undefined, ["shell", "--allow="], "/w")).toThrow("--allow needs a value");
  expect(parseCommandLine.bind(undefined, ["shell", "--allow", ""], "/w")).toThrow("--allow needs a value");
  expect(parseCommandLine.bind(undefined, ["shell", "--runtime=lxc"], "/w")).toThrow("--runtime needs docker or podman");
  expect(parseCommandLine(["shell", "--live=1"], "/w")).toMatchObject({ options: { argumentsList: ["--live=1"] } });
  expect(parseCommandLine(["audit", "codex"], "/w")).toMatchObject({ options: { agent: "codex", mode: "audit" } });
}

/** Checks the refused command lines. */
function refusesWrongCommandLines(): void {
  expect(parseCommandLine.bind(undefined, ["cursor"], "/w")).toThrow('"cursor" is not a closedbox command. Start with: closedbox claude, closedbox codex or closedbox shell');
  expect(parseCommandLine.bind(undefined, ["clude"], "/w")).toThrow("Did you mean: closedbox claude");
  expect(parseCommandLine.bind(undefined, ["iint"], "/w")).toThrow("Did you mean: closedbox init");
  expect(parseCommandLine.bind(undefined, ["audit"], "/w")).toThrow("audit needs an assistant to start, for example: closedbox audit claude");
  expect(parseCommandLine.bind(undefined, ["claude", "--allow"], "/w")).toThrow("--allow needs a value, for example: --allow api.stripe.com");
  expect(parseCommandLine.bind(undefined, ["claude", "--runtime", "--live"], "/w")).toThrow("--runtime needs a value, for example: --runtime docker");
  expect(parseCommandLine.bind(undefined, ["claude", "--runtime", "podamn"], "/w")).toThrow('--runtime needs docker or podman, not "podamn".');
  expect(parseCommandLine.bind(undefined, ["clean", "--runtime", "nosuchtool"], "/w")).toThrow("--runtime needs docker or podman");
}

/** Checks that asking for help never runs the command, so that `closedbox init --help` never writes a file. */
function showsHelpInsteadOfRunning(): void {
  expect(parseCommandLine(["init", "--help"], "/w").command).toBe("help");
  expect(parseCommandLine(["clean", "-h"], "/w").command).toBe("help");
  expect(parseCommandLine(["help"], "/w").command).toBe("help");
  expect(parseCommandLine(["-V"], "/w").command).toBe("version");
  expect(parseCommandLine(["claude", "--help"], "/w")).toMatchObject({ command: "launch", options: { argumentsList: ["--help"] } });
}

/** Checks the XDG folders. */
function resolvesTheFolders(): void {
  expect(resolvePaths({}, "/home/a", "/pkg")).toEqual({ config: "/home/a/.config/closedbox", state: "/home/a/.local/state/closedbox", cache: "/home/a/.cache/closedbox", packageFolder: "/pkg" });
  expect(resolvePaths({ XDG_CONFIG_HOME: "/c", XDG_STATE_HOME: "/s", XDG_CACHE_HOME: "/k" }, "/home/a", "/pkg")).toMatchObject({ config: "/c/closedbox", state: "/s/closedbox", cache: "/k/closedbox" });
}

/** Checks init and trust, which approve the file they show or write. */
function initializesAndTrustsTheConfig(): void {
  const context = createContext();
  const project = makeTemporaryFolder("project");
  expect(trustProjectConfig(context, project)).toBe(1);
  expect(initConfig(context, project)).toBe(0);
  expect(initConfig(context, project)).toBe(1);
  const configPath = join(project, "closedbox.toml");
  expect(isTrusted(join(context.paths.config, "trusted.json"), project, readFileSync(configPath, "utf8"))).toBe(true);
  appendFileSync(configPath, "# changed\n");
  expect(trustProjectConfig(context, project)).toBe(0);
  expect(context.written.join("\n")).toContain("# changed");
  expect(context.written[0]).toContain("Create one with: closedbox init");
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
  expect(context.written).toEqual(["Nothing to watch yet. Start a session first, for example: closedbox claude", "first", "second"]);
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
  expect(context.written).toContain(HELP_HINT);
}

/** Checks the real context and the real entry point. */
async function buildsTheRealContext(): Promise<void> {
  const context = createSystemContext(SYSTEM_RUNNER, { NO_COLOR: "1" }, { input: true, error: true, user: { uid: 1, gid: 2 } });
  expect(context.useColor).toBe(false);
  expect(context.isTerminal).toBe(true);
  expect(createSystemContext(SYSTEM_RUNNER, {}, { input: false, error: true, user: { uid: 1, gid: 2 } }).useColor).toBe(true);
  expect(context.paths.packageFolder).toMatch(/src$/u);
  await expect(main(["--version"], { uid: 1, gid: 2 })).resolves.toBe(0);
}

describe("cli", describeCli);

/** Groups the command line tests. */
function describeCli(): void {
  it("reads the command line", readsTheCommandLine);
  it("refuses wrong command lines", refusesWrongCommandLines);
  it("shows the help instead of running a command", showsHelpInsteadOfRunning);
  it("resolves the folders", resolvesTheFolders);
  it("initializes and trusts the config", initializesAndTrustsTheConfig);
  it("removes leftovers", removesLeftovers);
  it("follows the journal", followsTheJournal);
  it("runs each command", runsEachCommand);
  it("builds the real context", buildsTheRealContext);
}
