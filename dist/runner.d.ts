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
/** The way closedbox starts other programs (docker, podman, openssl), replaceable in tests. */
export interface Runner {
    /** Runs a command to the end and returns its output. */
    run: (command: string, argumentsList: string[], environment?: NodeJS.ProcessEnv) => Promise<CommandResult>;
    /** Runs a command attached to the terminal of the person and returns its exit code. */
    interactive: (command: string, argumentsList: string[], environment: NodeJS.ProcessEnv) => Promise<number>;
    /** Starts a command and calls onLine for each line it writes. */
    stream: (command: string, argumentsList: string[], onLine: (line: string) => void) => LineStream;
}
/** The runner that starts real programs. */
export declare const SYSTEM_RUNNER: Runner;
