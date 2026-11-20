/** How the proxy puts a real secret into the requests sent to one host. */
export interface SecretRule {
    /** The only host that receives the secret. */
    host: string;
    /** The request header that carries the secret, in lower case. */
    header: string;
    /** The header value, where {value} is replaced by the secret. */
    template: string;
}
/** What stillsuit needs to start one agent. */
export interface AgentProfile {
    /** The command started in the container; empty for the shell profile, which runs the command of the person. */
    command: string;
    /** The arguments always given to the command, before those of the person. */
    arguments: string[];
    /** The hosts the agent needs to work. */
    allow: string[];
    /** The secrets read on the computer and injected by the proxy, by environment variable name. */
    secrets: Record<string, SecretRule>;
}
/** The hosts of the package registries, allowed for every agent so that it can install dependencies. */
export declare const REGISTRY_HOSTS: string[];
/** The hosts added by the github = true option, for git clone, git fetch and release downloads. */
export declare const GITHUB_HOSTS: string[];
/** The starting profiles, by agent name. */
export declare const PROFILES: Record<string, AgentProfile>;
/** Returns the profile of an agent, or throws an error that lists the known agents. */
export declare function getProfile(agent: string): AgentProfile;
