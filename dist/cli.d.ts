import { type Runner } from "./runner.js";
import { type Context, type LaunchOptions, type Paths } from "./session.js";
/** The version printed by --version, kept equal to the one in package.json. */
export declare const VERSION = "0.1.0";
export declare const USAGE: string;
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
/** Finds the folders of stillsuit, following the XDG conventions. */
export declare function resolvePaths(environment: NodeJS.ProcessEnv, home: string, packageFolder: string): Paths;
/** Writes a commented stillsuit.toml, refusing to replace an existing one, and approves it. */
export declare function initConfig(context: Context, projectFolder: string): number;
/** Shows the stillsuit.toml of the project, then records that the person approved it. */
export declare function trustProjectConfig(context: Context, projectFolder: string): number;
/** Removes the containers and networks left by a session that crashed. */
export declare function cleanLeftovers(context: Context, runtime: string): Promise<number>;
/** Prints the journal of the latest session, then the new lines as they come, until stopped. */
export declare function watchJournal(context: Context, intervalMs: number): {
    stop: () => void;
} | undefined;
/** Runs stillsuit with a context, writes errors as messages and returns the exit code. */
export declare function run(argumentsList: string[], context: Context, workingFolder: string): Promise<number>;
/** Tells which standard streams are attached to a terminal. */
export interface Terminals {
    input: boolean;
    error: boolean;
}
/** Builds the real context: real programs, real folders, the real terminal. */
export declare function createSystemContext(runner: Runner, environment: NodeJS.ProcessEnv, terminals: Terminals): Context;
/** Starts stillsuit from the command line. */
export declare function main(argumentsList: string[]): Promise<number>;
