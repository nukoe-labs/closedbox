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

export const USAGE = `stillsuit ${VERSION}
Runs your AI coding assistant in a closed box. Inside, it sees only this project folder,
reaches only the websites you approve, and never sees your API keys.

Start:
  stillsuit claude               open Claude Code in the box
  stillsuit codex                open Codex in the box
  stillsuit shell -- npm test    run any command in the box

Set up a project (optional):
  stillsuit audit claude         run once with every website allowed, then list the ones used
  stillsuit init                 create a settings file (stillsuit.toml) in this folder
  stillsuit trust                read and approve the settings file of this folder

While it runs:
  stillsuit watch                show each connection live, in another terminal
  stillsuit clean                remove what a crash left behind

Options:
  --allow <website>    allow one more website for this run (repeat it for more)
  --project <folder>   use this folder instead of the current one
  --live               also show each connection in this terminal
  --no-scan            skip the check for trapped files before the start
  --runtime <name>     docker or podman (default: the one that is running)

More help: https://github.com/nukoe-labs/stillsuit`;

/** The line added under every error, so that the next step is always clear. */
export const HELP_HINT = "Run `stillsuit --help` to see every command.";

/** An example value for each option that takes one, shown when the value is missing. */
const OPTION_EXAMPLES: Record<string, string> = { "--allow": "api.stripe.com", "--runtime": "docker", "--project": "~/code/my-app" };

/** What the command line asks for. */
export type CommandLine =
  | { command: "launch"; options: LaunchOptions }
  | { command: "init" | "trust" | "watch" | "clean" | "help" | "version"; projectFolder: string };

/** The options that take a value, by name. */
const VALUE_OPTIONS = new Set(["--allow", "--runtime", "--project"]);
const SIMPLE_COMMANDS = new Set(["init", "trust", "watch", "clean"]);
const HELP_WORDS = new Set(["--help", "-h", "help"]);
const VERSION_WORDS = new Set(["--version", "-v", "-V"]);

/** The state collected while reading the command line. */
interface Reading {
  words: string[];
  extraHosts: string[];
  runtime: string;
  projectFolder: string;
  scan: boolean;
  liveJournal: boolean;
}

/** Reads one option with its value, and stops with an example when the value is missing. */
function readValueOption(reading: Reading, name: string, value: string | undefined): void {
  if (value === undefined || value.startsWith("--")) {
    throw new RangeError(`${name} needs a value, for example: ${name} ${OPTION_EXAMPLES[name] as string}`);
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

/** Tells whether the person asked for help with a stillsuit command, such as `stillsuit init --help`. */
function asksForHelp(words: string[]): boolean {
  const [first = "--help", second = ""] = words;
  const helpWanted = HELP_WORDS.has(first) || (SIMPLE_COMMANDS.has(first) && HELP_WORDS.has(second));
  return helpWanted;
}

/** Returns the position it is given: the first row of the edit count is 0, 1, 2, and so on. */
function positionOf(_unused: unknown, index: number): number {
  return index;
}

/** Counts the letters to change to turn one word into another, to recognize a typing mistake. */
function countEdits(typed: string, known: string): number {
  let previous = Array.from({ length: known.length + 1 }, positionOf);
  for (const [row, typedLetter] of [...typed].entries()) {
    previous = nextEditRow(previous, typedLetter, known, row + 1);
  }
  return previous[known.length] as number;
}

/** Computes one row of the edit count, for one more letter of the typed word. */
function nextEditRow(previous: number[], typedLetter: string, known: string, rowStart: number): number[] {
  const row = [rowStart];
  for (const [column, knownLetter] of [...known].entries()) {
    const replaceCost = (previous[column] as number) + (typedLetter === knownLetter ? 0 : 1);
    row.push(Math.min((previous[column + 1] as number) + 1, (row[column] as number) + 1, replaceCost));
  }
  return row;
}

/** Explains an unknown first word, suggesting the closest command when it looks like a typing mistake. */
function describeUnknownWord(word: string): string {
  const known = [...Object.keys(PROFILES), "audit", ...SIMPLE_COMMANDS];
  const closest = known.find(isCloseTo.bind(undefined, word));
  if (closest !== undefined) {
    return `"${word}" is not a stillsuit command. Did you mean: stillsuit ${closest}`;
  }
  return `"${word}" is not a stillsuit command. Start with: stillsuit claude, stillsuit codex or stillsuit shell`;
}

/** Tells whether a known command is at most two letters away from the typed word. */
function isCloseTo(typed: string, known: string): boolean {
  const MAXIMUM_TYPING_MISTAKES = 2;
  const close = countEdits(typed, known) <= MAXIMUM_TYPING_MISTAKES;
  return close;
}

/** Reads the command line. */
export function parseCommandLine(argumentsList: string[], workingFolder: string): CommandLine {
  const reading = readWords(argumentsList, workingFolder);
  if (asksForHelp(reading.words)) {
    return { command: "help", projectFolder: reading.projectFolder };
  }
  const [first = "--help", ...rest] = reading.words;
  if (VERSION_WORDS.has(first)) {
    return { command: "version", projectFolder: reading.projectFolder };
  }
  if (SIMPLE_COMMANDS.has(first)) {
    return { command: first as "init", projectFolder: reading.projectFolder };
  }
  const isAudit = first === "audit";
  const agent = isAudit ? (rest.shift() ?? "") : first;
  if (isAudit && !(agent in PROFILES)) {
    throw new RangeError(`audit needs an assistant to start, for example: stillsuit audit claude`);
  }
  if (!(agent in PROFILES)) {
    throw new RangeError(describeUnknownWord(agent));
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
    context.write(`${configPath} already exists. Edit it, then approve it with: stillsuit trust`);
    return 1;
  }
  const text = writeConfigText([], "stillsuit settings. Run `stillsuit audit claude` to see which websites your project needs.");
  writeFileSync(configPath, text);
  trustConfig(join(context.paths.config, "trusted.json"), projectFolder, text);
  context.write(`Created ${configPath}. Add websites to it, then approve it with: stillsuit trust`);
  return 0;
}

/** Shows the stillsuit.toml of the project, then records that the person approved it. */
export function trustProjectConfig(context: Context, projectFolder: string): number {
  const configPath = join(projectFolder, CONFIG_FILE);
  if (!existsSync(configPath)) {
    context.write(`There is no ${CONFIG_FILE} in ${projectFolder}. Create one with: stillsuit init`);
    return 1;
  }
  const text = readFileSync(configPath, "utf8");
  context.write(text);
  trustConfig(join(context.paths.config, "trusted.json"), projectFolder, text);
  context.write(`Approved ${configPath}. If it changes, stillsuit will ask you to approve it again.`);
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
  context.write(`Cleaned up: ${containerIds.length} leftover box(es) removed.`);
  return 0;
}

/** Prints the journal of the latest session, then the new lines as they come, until stopped. */
export function watchJournal(context: Context, intervalMs: number): { stop: () => void } | undefined {
  const latestPath = join(context.paths.state, "latest");
  if (!existsSync(latestPath)) {
    context.write("Nothing to watch yet. Start a session first, for example: stillsuit claude");
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
    context.write(HELP_HINT);
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
