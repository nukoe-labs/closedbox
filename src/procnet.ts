import { readdirSync, readFileSync, readlinkSync } from "node:fs";

/** The few file operations used to read /proc, replaceable in tests. */
export interface ProcReader {
  readFile: (path: string) => string;
  readdir: (path: string) => string[];
  readlink: (path: string) => string;
}

/** Reads /proc on the real system. */
export const SYSTEM_PROC: ProcReader = {
  readFile: readTextFile,
  readdir: readdirSync,
  readlink: readlinkSync,
};

/** Reads a whole text file. */
function readTextFile(path: string): string {
  return readFileSync(path, "utf8");
}

const LONGEST_COMMAND = 160;

/** Returns the socket inode of a line of /proc/net/tcp when its local port is the one searched, or undefined. */
function readInodeOfLine(line: string, port: number): string | undefined {
  const columns = line.trim().split(/\s+/u);
  const localAddress = columns[1] ?? "";
  const localPort = Number.parseInt(localAddress.split(":")[1] ?? "", 16);
  if (localPort !== port) {
    return undefined;
  }
  return columns[9];
}

/** Finds the inode of the socket whose local port is the one given, in the text of /proc/net/tcp or tcp6. */
export function findSocketInode(procNetText: string, port: number): string | undefined {
  const lines = procNetText.split("\n").slice(1);
  for (const line of lines) {
    const inode = readInodeOfLine(line, port);
    if (inode !== undefined && inode !== "0") {
      return inode;
    }
  }
  return undefined;
}

/** Tells whether one process holds the socket, by reading the links of its open files. */
function processHoldsSocket(reader: ProcReader, pid: string, socketLink: string): boolean {
  try {
    const descriptors = reader.readdir(`/proc/${pid}/fd`);
    return descriptors.some(isLinkTo.bind(undefined, reader, `/proc/${pid}/fd`, socketLink));
  } catch {
    return false;
  }
}

/** Tells whether one open file of a process is a link to the socket. */
function isLinkTo(reader: ProcReader, folder: string, socketLink: string, descriptor: string): boolean {
  try {
    return reader.readlink(`${folder}/${descriptor}`) === socketLink;
  } catch {
    return false;
  }
}

/** Tells whether a /proc entry is a process number. */
function isProcessFolder(name: string): boolean {
  return /^\d+$/u.test(name);
}

/** Reads the command line of a process, with spaces between the arguments, cut to a readable length. */
export function readCommand(reader: ProcReader, pid: string): string | undefined {
  try {
    const command = reader.readFile(`/proc/${pid}/cmdline`).split("\0").filter(Boolean).join(" ");
    return command.length > LONGEST_COMMAND ? `${command.slice(0, LONGEST_COMMAND)}…` : command;
  } catch {
    return undefined;
  }
}

/** Reads the socket table of IPv4, then of IPv6, and returns the inode found for the port. */
function findInodeInTables(reader: ProcReader, port: number): string | undefined {
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = readOptionalFile(reader, table);
    const inode = findSocketInode(text, port);
    if (inode !== undefined) {
      return inode;
    }
  }
  return undefined;
}

/** Reads a file, or returns an empty text when it cannot be read. */
function readOptionalFile(reader: ProcReader, path: string): string {
  try {
    return reader.readFile(path);
  } catch {
    return "";
  }
}

/** Finds the command line of the process that opened the TCP connection from the given local port. */
export function findCommandForPort(reader: ProcReader, port: number): string | undefined {
  const inode = findInodeInTables(reader, port);
  if (inode === undefined) {
    return undefined;
  }
  const socketLink = `socket:[${inode}]`;
  const pids = reader.readdir("/proc").filter(isProcessFolder);
  const owner = pids.find(processHoldsSocketWith.bind(undefined, reader, socketLink));
  return owner === undefined ? undefined : readCommand(reader, owner);
}

/** Tells whether a process holds the socket, with the arguments in the order expected by find(). */
function processHoldsSocketWith(reader: ProcReader, socketLink: string, pid: string): boolean {
  return processHoldsSocket(reader, pid, socketLink);
}
