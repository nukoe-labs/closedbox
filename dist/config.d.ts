import { type AllowRule } from "./hosts.js";
import { type AgentProfile, type SecretRule } from "./profiles.js";
/** The name of the configuration file read at the root of the project. */
export declare const CONFIG_FILE = "closedbox.toml";
/** The files hidden from the agent by default, even inside the project folder. */
export declare const DEFAULT_MASKS: string[];
/** The settings written in closedbox.toml. Every field is optional in the file. */
export interface FileConfig {
    allow: string[];
    github: boolean;
    mask: string[];
    scan: boolean;
    memory: string;
    secrets: Record<string, SecretRule>;
}
/** The settings used when the project has no closedbox.toml. */
export declare const DEFAULT_FILE_CONFIG: FileConfig;
/** Reads the text of closedbox.toml into a checked configuration. */
export declare function readFileConfig(text: string): FileConfig;
/** The settings of one session, built from the profile, the file and the command line. */
export interface SessionSettings {
    allowRules: AllowRule[];
    /** The secrets found on the computer, by environment variable name, with the rule that injects them. */
    secrets: Record<string, SecretRule>;
    masks: string[];
    scan: boolean;
    memory: string;
}
/** Lists the hosts allowed for a session, without duplicates, in a stable order. */
export declare function listAllowedHosts(profile: AgentProfile, config: FileConfig, extraHosts: string[]): string[];
/** Builds the settings of one session. */
export declare function resolveSettings(profile: AgentProfile, config: FileConfig, extraHosts: string[], environment: NodeJS.ProcessEnv): SessionSettings;
/** Writes a commented closedbox.toml that allows the given hosts on top of the agent profile. */
export declare function writeConfigText(extraHosts: string[], header: string): string;
