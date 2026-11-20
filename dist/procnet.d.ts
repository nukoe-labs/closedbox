/** The few file operations used to read /proc, replaceable in tests. */
export interface ProcReader {
    readFile: (path: string) => string;
    readdir: (path: string) => string[];
    readlink: (path: string) => string;
}
/** Reads /proc on the real system. */
export declare const SYSTEM_PROC: ProcReader;
/** Finds the inode of the socket whose local port is the one given, in the text of /proc/net/tcp or tcp6. */
export declare function findSocketInode(procNetText: string, port: number): string | undefined;
/** Reads the command line of a process, with spaces between the arguments, cut to a readable length. */
export declare function readCommand(reader: ProcReader, pid: string): string | undefined;
/** Finds the command line of the process that opened the TCP connection from the given local port. */
export declare function findCommandForPort(reader: ProcReader, port: number): string | undefined;
