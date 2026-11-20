import type { SessionSettings } from "./config.js";
import type { MaskedPath } from "./masks.js";
import type { Runner } from "./runner.js";
/** The container engines stillsuit can drive. */
export type RuntimeName = "docker" | "podman";
/** The address of the proxy as seen from the agent container. */
export declare const PROXY_ALIAS = "stillsuit-proxy";
export declare const PROXY_PORT = 3128;
/** The project folder inside the container. */
export declare const WORKSPACE = "/workspace";
/** Where the compiled stillsuit files are mounted, read only, in both containers. */
export declare const PACKAGE_MOUNT = "/opt/stillsuit";
/** The CA file path inside the agent image. */
export declare const CA_IN_IMAGE = "/usr/local/share/ca-certificates/stillsuit.crt";
/** An address reserved for documentation (RFC 5737): DNS queries sent there go nowhere. */
export declare const BLACKHOLE_DNS = "192.0.2.1";
/** Finds a container engine: the one asked for, or Docker then Podman. Apple container has no internal network yet. */
export declare function detectRuntime(runner: Runner, wanted: string): Promise<RuntimeName>;
/** The names and settings of one session. */
export interface SessionPlan {
    id: string;
    projectFolder: string;
    /** The compiled stillsuit folder on the computer. */
    packageFolder: string;
    agentImage: string;
    proxyImage: string;
    command: string;
    argumentsList: string[];
    settings: SessionSettings;
    masks: MaskedPath[];
    /** The environment variables given to the agent with a placeholder value, by name. */
    placeholders: Record<string, string>;
    useTerminal: boolean;
    /** The volume kept as the home folder of the agent, one per agent and per project, so that projects never share it. */
    homeVolume: string;
}
/** Returns the names of the network and containers of a session. */
export declare function sessionNames(id: string): {
    network: string;
    proxy: string;
    agent: string;
};
/** Builds the arguments that create the internal network: containers on it have no route out. */
export declare function buildNetworkArguments(plan: SessionPlan): string[];
/** Builds the arguments that start the proxy, the only container with a route to the Internet. */
export declare function buildProxyArguments(plan: SessionPlan): string[];
/** Builds the arguments that attach the proxy to the internal network under its alias. */
export declare function buildConnectArguments(plan: SessionPlan): string[];
/** Tells whether a masked path can be written in a --mount option, which splits on commas and quotes. */
export declare function isMountablePath(masked: MaskedPath): boolean;
/** Lists the environment of the agent: the proxy address, the CA for every language, and the placeholders. */
export declare function buildAgentEnvironment(plan: SessionPlan): Record<string, string>;
/** Builds the arguments that start the agent on the internal network, with the project folder as the only mount. */
export declare function buildAgentArguments(plan: SessionPlan): string[];
