import { type FileConfig } from "./config.js";
import type { CertificatePair, ProxyMode } from "./proxy.js";
import type { Runner } from "./runner.js";
import { type SessionPlan } from "./runtime.js";
/** The exit code when wormsign found a worm sign and the agent was not started. */
export declare const EXIT_WORM_FOUND = 3;
/** The exit code when the session could not start. */
export declare const EXIT_SETUP_FAILED = 2;
/** How long a refused connection is held open, so that the journal can name the process. */
export declare const DENY_DELAY_MS = 1500;
/** How long stillsuit waits for the proxy to listen. */
export declare const PROXY_START_TIMEOUT_MS = 20000;
/** The folders stillsuit uses on the computer. */
export interface Paths {
    config: string;
    state: string;
    cache: string;
    /** The compiled stillsuit folder, mounted read only in the containers. */
    packageFolder: string;
}
/** Everything a session needs from the outside world, replaceable in tests. */
export interface Context {
    runner: Runner;
    environment: NodeJS.ProcessEnv;
    paths: Paths;
    write: (text: string) => void;
    useColor: boolean;
    isTerminal: boolean;
}
/** What the person asked for on the command line. */
export interface LaunchOptions {
    agent: string;
    argumentsList: string[];
    projectFolder: string;
    mode: ProxyMode;
    extraHosts: string[];
    scan: boolean;
    runtime: string;
    /** Shows the journal live on the terminal even when the agent uses it. */
    liveJournal: boolean;
}
/** Reads stillsuit.toml of the project, and refuses a file that the person has not approved. */
export declare function loadProjectConfig(context: Context, projectFolder: string): FileConfig;
/** Builds the placeholder given to the agent in place of a secret: the public prefix of the key, then a fixed text. */
export declare function makePlaceholder(value: string): string;
/** Names the home volume after the agent and the project, so that two projects never share a home folder. */
export declare function homeVolumeName(agent: string, projectFolder: string): string;
/** Chooses the command and its arguments: the profile command, or for the shell profile the first word of the person. */
export declare function chooseCommand(profileCommand: string, argumentsList: string[]): {
    command: string;
    argumentsList: string[];
};
/** Builds the JSON configuration of the proxy container. */
export declare function buildProxyConfiguration(plan: SessionPlan, mode: ProxyMode, certificates: Record<string, CertificatePair>): string;
/** Starts the agent in its sandbox, waits until it ends, cleans up and returns its exit code. */
export declare function launch(context: Context, options: LaunchOptions): Promise<number>;
