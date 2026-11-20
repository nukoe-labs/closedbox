import { type Runner } from "./runner.js";
import type { HostUser } from "./runtime.js";
import { type Context, type LaunchOptions, type Paths } from "./session.js";
/** The version printed by --version, kept equal to the one in package.json. */
export declare const VERSION = "0.1.0";
export declare const USAGE = "closedbox 0.1.0\nRuns your AI coding assistant in a closed box. Inside, it sees only this project folder,\nreaches only the websites you approve, and never sees your API keys.\n\nStart:\n  closedbox claude               open Claude Code in the box\n  closedbox codex                open Codex in the box\n  closedbox shell -- npm test    run any command in the box\n\nSet up a project (optional):\n  closedbox audit claude         run once with every website allowed, then list the ones used\n  closedbox init                 create a settings file (closedbox.toml) in this folder\n  closedbox trust                read and approve the settings file of this folder\n\nWhile it runs:\n  closedbox watch                show each connection live, in another terminal\n  closedbox clean                remove what a crash left behind\n\nOptions:\n  --allow <website>    allow one more website for this run (repeat it for more)\n  --project <folder>   use this folder instead of the current one\n  --live               also show each connection in this terminal\n  --no-scan            skip the check for trapped files before the start\n  --runtime <name>     docker or podman (default: the one that is running)\n\nMore help: https://github.com/nukoe-labs/closedbox";
/** The line added under every error, so that the next step is always clear. */
export declare const HELP_HINT = "Run `closedbox --help` to see every command.";
/** What the command line asks for. */
export type CommandLine = {
    command: "launch";
    options: LaunchOptions;
} | {
    command: "init" | "trust" | "watch" | "clean" | "help" | "version";
    projectFolder: string;
};
/** Reads the command line. */
export declare function parseCommandLine(argumentsList: string[], workingFolder: string): CommandLine;
/** Finds the folders of closedbox, following the XDG conventions. */
export declare function resolvePaths(environment: NodeJS.ProcessEnv, home: string, packageFolder: string): Paths;
/** Writes a commented closedbox.toml, refusing to replace an existing one, and approves it. */
export declare function initConfig(context: Context, projectFolder: string): number;
/** Shows the closedbox.toml of the project, then records that the person approved it. */
export declare function trustProjectConfig(context: Context, projectFolder: string): number;
/** Removes the containers and networks left by a session that crashed. */
export declare function cleanLeftovers(context: Context, runtime: string): Promise<number>;
/** Prints the journal of the latest session, then the new lines as they come, until stopped. */
export declare function watchJournal(context: Context, intervalMs: number): {
    stop: () => void;
} | undefined;
/** Runs closedbox with a context, writes errors as messages and returns the exit code. */
export declare function run(argumentsList: string[], context: Context, workingFolder: string): Promise<number>;
/** What closedbox reads about the computer it runs on: the terminals and the user. */
export interface Host {
    /** Tells whether the standard input is a terminal. */
    input: boolean;
    /** Tells whether the standard error is a terminal. */
    error: boolean;
    user: HostUser;
}
/** Builds the real context: real programs, real folders, the real terminal. */
export declare function createSystemContext(runner: Runner, environment: NodeJS.ProcessEnv, host: Host): Context;
/** Starts closedbox from the command line, as the given user of the computer. */
export declare function main(argumentsList: string[], user: HostUser): Promise<number>;
