import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
/** Collects the output of a child process and resolves when it ends. */
function collectResult(child) {
    const chunks = { stdout: "", stderr: "" };
    child.stdout?.on("data", appendChunk.bind(undefined, chunks, "stdout"));
    child.stderr?.on("data", appendChunk.bind(undefined, chunks, "stderr"));
    return new Promise(waitForEnd.bind(undefined, child, chunks));
}
/** Adds one piece of output to the collected text. */
function appendChunk(chunks, stream, chunk) {
    chunks[stream] += chunk.toString();
}
/** Resolves the promise when the child process closes, and with code 127 when it cannot start. */
function waitForEnd(child, chunks, resolve) {
    child.on("error", resolveNotFound.bind(undefined, chunks, resolve));
    child.on("close", resolveWithCode.bind(undefined, chunks, resolve));
}
/** Resolves with the exit code of the command. */
function resolveWithCode(chunks, resolve, code) {
    resolve({ code: code ?? 1, ...chunks });
}
/** Resolves with code 127, the shell code for a command that does not exist. */
function resolveNotFound(chunks, resolve, error) {
    resolve({ code: 127, stdout: chunks.stdout, stderr: error.message });
}
/** Runs a command to the end without a shell, so that no argument is ever interpreted. */
function runCommand(command, argumentsList, environment) {
    const child = spawn(command, argumentsList, { env: environment ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    return collectResult(child);
}
/** Runs a command on the terminal of the person and resolves with its exit code. */
function runInteractive(command, argumentsList, environment) {
    const child = spawn(command, argumentsList, { env: environment, stdio: "inherit" });
    return collectResult(child).then(readCode);
}
/** Returns the exit code of a result. */
function readCode(result) {
    return result.code;
}
/** Starts a command and reads its standard output line by line. */
function streamCommand(command, argumentsList, onLine) {
    const child = spawn(command, argumentsList, { stdio: ["pipe", "pipe", "ignore"] });
    child.on("error", onLine.bind(undefined, ""));
    child.stdin.on("error", onLine.bind(undefined, ""));
    createInterface({ input: child.stdout }).on("line", onLine);
    return { send: sendLine.bind(undefined, child), stop: stopChild.bind(undefined, child) };
}
/** Writes one line on the standard input of a child process that is still running. */
function sendLine(child, line) {
    if (child.exitCode === null && child.stdin?.writable === true) {
        child.stdin.write(`${line}\n`);
    }
}
/** Stops a child process. */
function stopChild(child) {
    child.kill();
}
/** The runner that starts real programs. */
export const SYSTEM_RUNNER = { run: runCommand, interactive: runInteractive, stream: streamCommand };
