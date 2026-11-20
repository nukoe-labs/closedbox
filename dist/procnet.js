import { readdirSync, readFileSync, readlinkSync } from "node:fs";
/** Reads /proc on the real system. */
export const SYSTEM_PROC = {
    readFile: readTextFile,
    readdir: readdirSync,
    readlink: readlinkSync,
};
/** Reads a whole text file. */
function readTextFile(path) {
    return readFileSync(path, "utf8");
}
const LONGEST_COMMAND = 160;
/** Returns the socket inode of a line of /proc/net/tcp when its local port is the one searched, or undefined. */
function readInodeOfLine(line, port) {
    const columns = line.trim().split(/\s+/u);
    const localAddress = columns[1] ?? "";
    const localPort = Number.parseInt(localAddress.split(":")[1] ?? "", 16);
    if (localPort !== port) {
        return undefined;
    }
    return columns[9];
}
/** Finds the inode of the socket whose local port is the one given, in the text of /proc/net/tcp or tcp6. */
export function findSocketInode(procNetText, port) {
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
function processHoldsSocket(reader, pid, socketLink) {
    try {
        const descriptors = reader.readdir(`/proc/${pid}/fd`);
        return descriptors.some(isLinkTo.bind(undefined, reader, `/proc/${pid}/fd`, socketLink));
    }
    catch {
        return false;
    }
}
/** Tells whether one open file of a process is a link to the socket. */
function isLinkTo(reader, folder, socketLink, descriptor) {
    try {
        return reader.readlink(`${folder}/${descriptor}`) === socketLink;
    }
    catch {
        return false;
    }
}
/** Tells whether a /proc entry is a process number. */
function isProcessFolder(name) {
    return /^\d+$/u.test(name);
}
/** Reads the command line of a process, with spaces between the arguments, cut to a readable length. */
export function readCommand(reader, pid) {
    try {
        const command = reader.readFile(`/proc/${pid}/cmdline`).split("\0").filter(Boolean).join(" ");
        return command.length > LONGEST_COMMAND ? `${command.slice(0, LONGEST_COMMAND)}…` : command;
    }
    catch {
        return undefined;
    }
}
/** Reads the socket table of IPv4, then of IPv6, and returns the inode found for the port. */
function findInodeInTables(reader, port) {
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
function readOptionalFile(reader, path) {
    try {
        return reader.readFile(path);
    }
    catch {
        return "";
    }
}
/** Finds the command line of the process that opened the TCP connection from the given local port. */
export function findCommandForPort(reader, port) {
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
function processHoldsSocketWith(reader, socketLink, pid) {
    return processHoldsSocket(reader, pid, socketLink);
}
