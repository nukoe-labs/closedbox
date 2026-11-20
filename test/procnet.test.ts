import { describe, expect, it } from "vitest";
import { findCommandForPort, findSocketInode, readCommand, SYSTEM_PROC, type ProcReader } from "../src/procnet.js";
import { answerPortLine } from "../src/whois-main.js";

const HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const TCP = `${HEADER}\n   0: 0200A8C0:9C40 0300A8C0:0C38 01 00000000:00000000 00:00000000 00000000  1000        0 5551 1\n   1: 0200A8C0:9C41 0300A8C0:0C38 06 00000000:00000000 00:00000000 00000000  1000        0 0 1\n`;
const TCP6 = `${HEADER}\n   0: 00000000000000000000000000000000:9C42 00000000000000000000000000000000:0C38 01 0 0 0 1000 0 6661 1\n`;

/** Builds a fake /proc with two processes; process 20 holds socket 5551 and 6661. */
function createFakeProc(files: Record<string, string>): ProcReader {
  const folders: Record<string, string[]> = { "/proc": ["1", "20", "self", "30"], "/proc/1/fd": ["0", "5"], "/proc/20/fd": ["0", "1", "9"] };
  const links: Record<string, string> = { "/proc/1/fd/0": "/dev/null", "/proc/20/fd/0": "/dev/null", "/proc/20/fd/1": "socket:[5551]", "/proc/20/fd/9": "socket:[6661]" };
  /** Reads a fake file. */
  function readFile(path: string): string {
    return readFrom(files, path);
  }
  /** Lists a fake folder. */
  function readdir(path: string): string[] {
    return readFrom(folders, path);
  }
  /** Reads a fake link. */
  function readlink(path: string): string {
    return readFrom(links, path);
  }
  return { readFile, readdir, readlink };
}

/** Returns a value of a table, or throws like a missing file. */
function readFrom<T>(table: Record<string, T>, path: string): T {
  const value = table[path];
  if (value === undefined) {
    throw new Error(`ENOENT ${path}`);
  }
  return value;
}

/** Checks the reading of the socket tables. */
function findsSocketInodes(): void {
  expect(findSocketInode(TCP, 0x9c40)).toBe("5551");
  expect(findSocketInode(TCP, 0x9c41)).toBeUndefined();
  expect(findSocketInode(TCP, 1)).toBeUndefined();
  expect(findSocketInode("", 1)).toBeUndefined();
  expect(findSocketInode(`${HEADER}\n   0: bad`, 1)).toBeUndefined();
}

/** Checks that the process is found in IPv4 and IPv6, and missing cases. */
function findsTheCommandOfAPort(): void {
  const longCommand = `node ${"a".repeat(200)}`;
  const reader = createFakeProc({ "/proc/net/tcp": TCP, "/proc/net/tcp6": TCP6, "/proc/20/cmdline": "node\0scripts/setup.js\0" });
  expect(findCommandForPort(reader, 0x9c40)).toBe("node scripts/setup.js");
  expect(findCommandForPort(reader, 0x9c42)).toBe("node scripts/setup.js");
  expect(findCommandForPort(reader, 1)).toBeUndefined();
  const withoutOwner = createFakeProc({ "/proc/net/tcp": TCP.replace("5551", "7777") });
  expect(findCommandForPort(withoutOwner, 0x9c40)).toBeUndefined();
  expect(findCommandForPort(withoutOwner, 0x9c42)).toBeUndefined();
  expect(readCommand(createFakeProc({ "/proc/5/cmdline": longCommand }), "5")).toHaveLength(161);
  expect(readCommand(createFakeProc({}), "5")).toBeUndefined();
}

/** Checks the answers of the helper that runs in the container. */
function answersPortLines(): void {
  const reader = createFakeProc({ "/proc/net/tcp": TCP, "/proc/20/cmdline": "curl\0https://evil.example\0" });
  expect(JSON.parse(answerPortLine(reader, "40000"))).toEqual({ port: 40000, command: "curl https://evil.example" });
  expect(JSON.parse(answerPortLine(reader, "x"))).toEqual({ port: null });
}

/** Checks that the real /proc reader works on the files of this computer. */
function readsRealFiles(): void {
  expect(SYSTEM_PROC.readFile(new URL(import.meta.url).pathname)).toContain("readsRealFiles");
}

describe("procnet", describeProcnet);

/** Groups the /proc tests. */
function describeProcnet(): void {
  it("finds socket inodes", findsSocketInodes);
  it("finds the command of a port", findsTheCommandOfAPort);
  it("answers port lines", answersPortLines);
  it("reads real files", readsRealFiles);
}
