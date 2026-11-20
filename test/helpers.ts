import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, LineStream, Runner } from "../src/runner.js";

/** One command received by the fake runner. */
export interface RecordedCall {
  kind: "run" | "interactive" | "stream";
  command: string;
  argumentsList: string[];
  environment: NodeJS.ProcessEnv | undefined;
}

/** A fake runner: it records each command and answers with the first matching scripted answer. */
export interface FakeRunner extends Runner {
  calls: RecordedCall[];
  /** The callbacks of the streams that were started, to push lines into them. */
  streams: { argumentsList: string[]; onLine: (line: string) => void; sent: string[]; stopped: boolean }[];
}

/** A scripted answer: when the joined arguments contain the key, the result is returned. */
export type Script = Record<string, Partial<CommandResult>>;

/** Finds the scripted result of a command, or a success with no output. */
function findResult(script: Script, command: string, argumentsList: string[]): CommandResult {
  const line = [command, ...argumentsList].join(" ");
  const key = Object.keys(script).find(isIncludedIn, line);
  const scripted = key === undefined ? {} : script[key];
  return { code: 0, stdout: "", stderr: "", ...scripted };
}

/** Tells whether a key is part of the line given as this. */
function isIncludedIn(this: string, key: string): boolean {
  return this.includes(key);
}

/** Creates a fake runner with scripted answers; streamLines are written to every started stream. */
export function createFakeRunner(script: Script = {}, streamLines: string[] = []): FakeRunner {
  const runner: FakeRunner = { calls: [], streams: [], run: fakeRun, interactive: fakeInteractive, stream: fakeStream };
  /** Records a command run to the end. */
  async function fakeRun(command: string, argumentsList: string[], environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
    runner.calls.push({ kind: "run", command, argumentsList, environment });
    return findResult(script, command, argumentsList);
  }
  /** Records an interactive command. */
  async function fakeInteractive(command: string, argumentsList: string[], environment: NodeJS.ProcessEnv): Promise<number> {
    runner.calls.push({ kind: "interactive", command, argumentsList, environment });
    return findResult(script, command, argumentsList).code;
  }
  /** Records a stream and writes the scripted lines to it soon after. */
  function fakeStream(command: string, argumentsList: string[], onLine: (line: string) => void): LineStream {
    runner.calls.push({ kind: "stream", command, argumentsList, environment: undefined });
    const entry = { argumentsList, onLine, sent: [] as string[], stopped: false };
    runner.streams.push(entry);
    setTimeout(writeLines, 5, onLine, streamLines);
    return { send: pushSent.bind(undefined, entry.sent), stop: markStopped.bind(undefined, entry) };
  }
  return runner;
}

/** Writes scripted lines to a stream callback. */
function writeLines(onLine: (line: string) => void, lines: string[]): void {
  lines.forEach(callWithLine, onLine);
}

/** Calls the callback given as this with one line. */
function callWithLine(this: (line: string) => void, line: string): void {
  this(line);
}

/** Records a line sent to a fake stream. */
function pushSent(sent: string[], line: string): void {
  sent.push(line);
}

/** Records that a fake stream was stopped. */
function markStopped(entry: { stopped: boolean }): void {
  entry.stopped = true;
}

/** Creates an empty temporary folder. */
export function makeTemporaryFolder(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `stillsuit-${prefix}-`));
}

/** Waits for a number of milliseconds. */
export function wait(milliseconds: number): Promise<void> {
  return new Promise(resolveAfter.bind(undefined, milliseconds));
}

/** Resolves a promise after a delay. */
function resolveAfter(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}
