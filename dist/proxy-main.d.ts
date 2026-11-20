import type { Server } from "node:http";
import { type CertificatePair, type ProxyPolicy } from "./proxy.js";
/** The configuration given to the proxy container in the STILLSUIT_PROXY_CONFIG variable. */
export interface ProxyConfiguration {
    policy: ProxyPolicy;
    certificates: Record<string, CertificatePair>;
}
/** Reads the values of the secrets named in the policy from the environment of the proxy container. */
export declare function readSecretValues(policy: ProxyPolicy, environment: NodeJS.ProcessEnv): Record<string, string>;
/** Starts the proxy inside its container, on the given port, and returns the server. */
export declare function main(environment: NodeJS.ProcessEnv, port: number): Server;
