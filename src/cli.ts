import { existsSync, readFileSync, statSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, writeConfigText } from "./config.js";
import { PROFILES } from "./profiles.js";
import type { ProxyMode } from "./proxy.js";
import { SYSTEM_RUNNER, type Runner } from "./runner.js";
import type { HostUser } from "./runtime.js";
import { EXIT_SETUP_FAILED, launch, type Context, type LaunchOptions, type Paths } from "./session.js";
import { trustConfig } from "./trust.js";

/** The version printed by --version, kept equal to the one in package.json. */
export const VERSION = "0.1.0";

export const USAGE = `stillsuit ${VERSION}: run a coding agent in a container, deny-by-default network, secrets kept outside.

Usage:
  stillsuit <agent> [agent arguments]     start claude, codex or shell in the sandbox
  stillsuit audit <agent>                 let every connection through, then write stillsuit.audit.toml
  stillsuit init                          write a commented stillsuit.toml in this folder
  stillsuit trust                         approve the stillsuit.toml of this folder
  stillsuit watch                         follow the journal of the running session
  stillsuit clean                         remove containers and networks left by a crash

Options (anywhere before --):
  --allow <host>      allow one more host for this session (repeatable)
  --no-scan           do not scan the project with wormsign first
  --live              show the journal on this terminal too
  --runtime <name>    docker or podman (default: the first one running)
  --project <folder>  the folder to mount (default: the current folder)

Agents: ${Object.keys(PROFILES).join(", ")}. Docs: https://github.com/nukoe-labs/stillsuit`;

/** What the command line asks for. */
export type CommandLine =
  | { command: "launch"; options: LaunchOptions }
  | { command: "init" | "trust" | "watch" | "clean" | "help" | "version"; projectFolder: string };

/** The options that take a value, by name. */
const VALUE_OPTIONS = new Set(["--allow", "--runtime", "--project"]);
const SIMPLE_COMMANDS = new Set(["init", "trust", "watch", "clean"]);

/** The state collected while reading the command line. */
interface Reading {
  words: string[];
  extraHosts: string[];
  runtime: string;
  projectFolder: string;
  scan: boolean;
  liveJournal: boolean;
}

/** Reads one option with its value, and returns how many words it used. */
function readValueOption(reading: Reading, name: string, value: string | undefined): void {
  if (value === undefined || value.startsWith("--")) {
    throw new RangeError(`${name} needs a value.\n\n${USAGE}`);
  }
  if (name === "--allow") {
    reading.extraHosts.push(value);
  } else if (name === "--runtime") {
    reading.runtime = value;
  } else {
    reading.projectFolder = resolve(value);
  }
}

/** Reads the words of the command line into options and the remaining words. */
function readWords(argumentsList: string[], workingFolder: string): Reading {
  const reading: Reading = { words: [], extraHosts: [], runtime: "auto", projectFolder: workingFolder, scan: true, liveJournal: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const word = argumentsList[index] as string;
    if (word === "--") {
      reading.words.push(...argumentsList.slice(index + 1));
      break;
    }
    if (VALUE_OPTIONS.has(word)) {
      index += 1;
      readValueOption(reading, word, argumentsList[index]);
    } else if (word === "--no-scan" || word === "--live") {
      reading.scan = reading.scan && word !== "--no-scan";
      reading.liveJournal = reading.liveJournal || word === "--live";
    } else {
      reading.words.push(word);
    }
  }
  return reading;
}

/** Reads the command line. */
export function parseCommandLine(argumentsList: string[], workingFolder: string): CommandLine {
  const reading = readWords(argumentsList, workingFolder);
  const [first = "--help", ...rest] = reading.words;
  if (first === "--help" || first === "-h" || first === "help") {
    return { command: "help", projectFolder: reading.projectFolder };
  }
  if (first === "--version" || first === "-v") {
    return { command: "version", projectFolder: reading.projectFolder };
  }
  if (SIMPLE_COMMANDS.has(first)) {
    return { command: first as "init", projectFolder: reading.projectFolder };
  }
  const isAudit = first === "audit";
  const agent = isAudit ? (rest.shift() ?? "") : first;
  if (!(agent in PROFILES)) {
    throw new RangeError(`Unknown agent "${agent}".\n\n${USAGE}`);
  }
  const mode: ProxyMode = isAudit ? "audit" : "enforce";
  const { extraHosts, runtime, projectFolder, scan, liveJournal } = reading;
  return { command: "launch", options: { agent, argumentsList: rest, projectFolder, mode, extraHosts, scan, runtime, liveJournal } };
}

/** Finds the folders of stillsuit, following the XDG conventions. */
export function resolvePaths(environment: NodeJS.ProcessEnv, home: string, packageFolder: string): Paths {
  const configHome = environment.XDG_CONFIG_HOME ?? join(home, ".config");
  const stateHome = environment.XDG_STATE_HOME ?? join(home, ".local", "state");
  const cacheHome = environment.XDG_CACHE_HOME ?? join(home, ".cache");
  return { config: join(configHome, "stillsuit"), state: join(stateHome, "stillsuit"), cache: join(cacheHome, "stillsuit"), packageFolder };
}

/** Writes a commented stillsuit.toml, refusing to replace an existing one, and approves it. */
export function initConfig(context: Context, projectFolder: string): number {
  const configPath = join(projectFolder, CONFIG_FILE);
  if (existsSync(configPath)) {
    context.write(`${configPath} already exists.`);
    return 1;
  }
  const text = writeConfigText([], "stillsuit configuration. Run `stillsuit audit <agent>` to see which hosts your project needs.");
  writeFileSync(configPath, text);
  trustConfig(join(context.paths.config, "trusted.json"), projectFolder, text);
  context.write(`Wrote ${configPath}.`);
  return 0;
}

/** Shows the stillsuit.toml of the project, then records that the person approved it. */
export function trustProjectConfig(context: Context, projectFolder: string): number {
  const configPath = join(projectFolder, CONFIG_FILE);
  if (!existsSync(configPath)) {
    context.write(`No ${CONFIG_FILE} in ${projectFolder}.`);
    return 1;
  }
  const text = readFileSync(configPath, "utf8");
  context.write(text);
  trustConfig(join(context.paths.config, "trusted.json"), projectFolder, text);
  context.write(`Approved ${configPath}. Any later change needs a new approval.`);
  return 0;
}

/** Removes the containers and networks left by a session that crashed. */
export async function cleanLeftovers(context: Context, runtime: string): Promise<number> {
  const engine = runtime === "auto" ? "docker" : runtime;
  const containers = await context.runner.run(engine, ["ps", "-aq", "--filter", "label=stillsuit.session"]);
  const containerIds = containers.stdout.split("\n").filter(Boolean);
  if (containerIds.length > 0) {
    await context.runner.run(engine, ["rm", "-f", ...containerIds]);
  }
  await context.runner.run(engine, ["network", "prune", "-f", "--filter", "label=stillsuit.session"]);
  context.write(`Removed ${containerIds.length} container(s) and the unused stillsuit networks.`);
  return 0;
}

/** Prints the journal of the latest session, then the new lines as they come, until stopped. */
export function watchJournal(context: Context, intervalMs: number): { stop: () => void } | undefined {
  const latestPath = join(context.paths.state, "latest");
  if (!existsSync(latestPath)) {
    context.write("No session yet.");
    return undefined;
  }
  const logPath = readFileSync(latestPath, "utf8").trim();
  const state = { printed: 0 };
  /** Prints the part of the journal written since the last look. */
  function printNewLines(): void {
    const text = readFileSync(logPath, "utf8");
    const fresh = text.slice(state.printed).trimEnd();
    state.printed = statSync(logPath).size;
    if (fresh !== "") {
      context.write(fresh);
    }
  }
  printNewLines();
  watchFile(logPath, { interval: intervalMs }, printNewLines);
  return { stop: unwatchFile.bind(undefined, logPath, printNewLines) };
}

/** Runs one command of the command line and returns its exit code. */
async function runCommandLine(context: Context, commandLine: CommandLine): Promise<number> {
  switch (commandLine.command) {
    case "launch":
      return launch(context, commandLine.options);
    case "init":
      return initConfig(context, commandLine.projectFolder);
    case "trust":
      return trustProjectConfig(context, commandLine.projectFolder);
    case "clean":
      return cleanLeftovers(context, "auto");
    case "watch":
      watchJournal(context, 300);
      return 0;
    case "version":
      context.write(VERSION);
      return 0;
    default:
      context.write(USAGE);
      return 0;
  }
}

/** Runs stillsuit with a context, writes errors as messages and returns the exit code. */
export async function run(argumentsList: string[], context: Context, workingFolder: string): Promise<number> {
  try {
    const commandLine = parseCommandLine(argumentsList, workingFolder);
    return await runCommandLine(context, commandLine);
  } catch (error) {
    context.write(`stillsuit: ${(error as Error).message}`);
    return EXIT_SETUP_FAILED;
  }
}

/** Writes one line on the standard error, where it never mixes with the output of the agent. */
function writeLine(text: string): void {
  process.stderr.write(`${text}\n`);
}

/** What stillsuit reads about the computer it runs on: the terminals and the user. */
export interface Host {
  /** Tells whether the standard input is a terminal. */
  input: boolean;
  /** Tells whether the standard error is a terminal. */
  error: boolean;
  user: HostUser;
}

/** Builds the real context: real programs, real folders, the real terminal. */
export function createSystemContext(runner: Runner, environment: NodeJS.ProcessEnv, host: Host): Context {
  const packageFolder = dirname(fileURLToPath(import.meta.url));
  const useColor = host.error && (environment.NO_COLOR ?? "") === "";
  const isTerminal = host.input;
  return { runner, environment, paths: resolvePaths(environment, homedir(), packageFolder), write: writeLine, useColor, isTerminal, user: host.user };
}

/** Starts stillsuit from the command line, as the given user of the computer. */
export function main(argumentsList: string[], user: HostUser): Promise<number> {
  const host = { input: process.stdin.isTTY === true, error: process.stderr.isTTY === true, user };
  return run(argumentsList, createSystemContext(SYSTEM_RUNNER, process.env, host), process.cwd());
}
