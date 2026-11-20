import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/** What a finished command returned. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A running command whose output is read line by line, and which can be stopped. */
export interface LineStream {
  /** Sends one line to the standard input of the command. */
  send: (line: string) => void;
  stop: () => void;
}

/** The way stillsuit starts other programs (docker, podman, openssl), replaceable in tests. */
export interface Runner {
  /** Runs a command to the end and returns its output. */
  run: (command: string, argumentsList: string[], environment?: NodeJS.ProcessEnv) => Promise<CommandResult>;
  /** Runs a command attached to the terminal of the person and returns its exit code. */
  interactive: (command: string, argumentsList: string[], environment: NodeJS.ProcessEnv) => Promise<number>;
  /** Starts a command and calls onLine for each line it writes. */
  stream: (command: string, argumentsList: string[], onLine: (line: string) => void) => LineStream;
}

/** Collects the output of a child process and resolves when it ends. */
function collectResult(child: ChildProcess): Promise<CommandResult> {
  const chunks = { stdout: "", stderr: "" };
  child.stdout?.on("data", appendChunk.bind(undefined, chunks, "stdout"));
  child.stderr?.on("data", appendChunk.bind(undefined, chunks, "stderr"));
  return new Promise(waitForEnd.bind(undefined, child, chunks));
}

/** Adds one piece of output to the collected text. */
function appendChunk(chunks: { stdout: string; stderr: string }, stream: "stdout" | "stderr", chunk: Buffer): void {
  chunks[stream] += chunk.toString();
}

/** Resolves the promise when the child process closes, and with code 127 when it cannot start. */
function waitForEnd(child: ChildProcess, chunks: { stdout: string; stderr: string }, resolve: (result: CommandResult) => void): void {
  child.on("error", resolveNotFound.bind(undefined, chunks, resolve));
  child.on("close", resolveWithCode.bind(undefined, chunks, resolve));
}

/** Resolves with the exit code of the command. */
function resolveWithCode(chunks: { stdout: string; stderr: string }, resolve: (result: CommandResult) => void, code: number | null): void {
  resolve({ code: code ?? 1, ...chunks });
}

/** Resolves with code 127, the shell code for a command that does not exist. */
function resolveNotFound(chunks: { stdout: string; stderr: string }, resolve: (result: CommandResult) => void, error: Error): void {
  resolve({ code: 127, stdout: chunks.stdout, stderr: error.message });
}

/** Runs a command to the end without a shell, so that no argument is ever interpreted. */
function runCommand(command: string, argumentsList: string[], environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
  const child = spawn(command, argumentsList, { env: environment ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
  return collectResult(child);
}

/** Runs a command on the terminal of the person and resolves with its exit code. */
function runInteractive(command: string, argumentsList: string[], environment: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(command, argumentsList, { env: environment, stdio: "inherit" });
  return collectResult(child).then(readCode);
}

/** Returns the exit code of a result. */
function readCode(result: CommandResult): number {
  return result.code;
}

/** Starts a command and reads its standard output line by line. */
function streamCommand(command: string, argumentsList: string[], onLine: (line: string) => void): LineStream {
  const child = spawn(command, argumentsList, { stdio: ["pipe", "pipe", "ignore"] });
  child.on("error", onLine.bind(undefined, ""));
  child.stdin.on("error", onLine.bind(undefined, ""));
  createInterface({ input: child.stdout }).on("line", onLine);
  return { send: sendLine.bind(undefined, child), stop: stopChild.bind(undefined, child) };
}

/** Writes one line on the standard input of a child process that is still running. */
function sendLine(child: ChildProcess, line: string): void {
  if (child.exitCode === null && child.stdin?.writable === true) {
    child.stdin.write(`${line}\n`);
  }
}

/** Stops a child process. */
function stopChild(child: ChildProcess): void {
  child.kill();
}

/** The runner that starts real programs. */
export const SYSTEM_RUNNER: Runner = { run: runCommand, interactive: runInteractive, stream: streamCommand };
