import { type ProcReader } from "./procnet.js";
/** Answers one line that holds a port with a JSON line that gives the command which opened the connection. */
export declare function answerPortLine(reader: ProcReader, line: string): string;
/** Reads ports on the input, one per line, until the input closes. Runs inside the agent container. */
export declare function main(input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream): void;
