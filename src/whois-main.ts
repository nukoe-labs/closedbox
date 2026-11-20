import { createInterface } from "node:readline";
import { findCommandForPort, SYSTEM_PROC, type ProcReader } from "./procnet.js";

/** Answers one line that holds a port with a JSON line that gives the command which opened the connection. */
export function answerPortLine(reader: ProcReader, line: string): string {
  const port = Number(line.trim());
  const command = Number.isInteger(port) ? findCommandForPort(reader, port) : undefined;
  return JSON.stringify({ port, command });
}

/** Writes the answer to one port read on the input. */
function answerOnOutput(output: NodeJS.WritableStream, line: string): void {
  output.write(`${answerPortLine(SYSTEM_PROC, line)}\n`);
}

/** Reads ports on the input, one per line, until the input closes. Runs inside the agent container. */
export function main(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  const lines = createInterface({ input });
  lines.on("line", answerOnOutput.bind(undefined, output));
}
