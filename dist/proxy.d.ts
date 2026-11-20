import { type IncomingHttpHeaders, type Server } from "node:http";
import type { ProxyAction, ProxyEvent } from "./events.js";
import { type AllowRule } from "./hosts.js";
import type { SecretRule } from "./profiles.js";
/** "enforce" blocks every host outside the allowlist; "audit" lets everything through and records it. */
export type ProxyMode = "enforce" | "audit";
/** The rules the proxy applies, sent to the proxy container as JSON. */
export interface ProxyPolicy {
    mode: ProxyMode;
    allow: AllowRule[];
    secrets: Record<string, SecretRule>;
    /** How long a refused connection is held open, so that the process that opened it can be found. */
    denyDelayMs: number;
    /** Lets the proxy reach local addresses; only the tests turn it on. */
    allowPrivate: boolean;
}
/** A certificate and its private key, in PEM. */
export interface CertificatePair {
    key: string;
    cert: string;
}
/** Everything the proxy needs, apart from the policy. */
export interface ProxyOptions {
    policy: ProxyPolicy;
    /** The real secret values, by environment variable name. They never leave the proxy. */
    secretValues: Record<string, string>;
    /** The certificates presented to the agent for the hosts that receive a secret. */
    certificates: Record<string, CertificatePair>;
    emit: (event: ProxyEvent) => void;
    /** The certificate authorities trusted for the real hosts; undefined means the system ones. */
    upstreamCa: string | undefined;
    /** The port of the real secret hosts: 443, except in the tests, which cannot listen on it. */
    secretHostPort: number;
}
/** Splits "host:port" from a CONNECT request, or returns undefined when it is not valid. */
export declare function parseConnectTarget(target: string): {
    host: string;
    port: number;
} | undefined;
/**
 * Replaces the credentials of a request to a secret host: every header managed by a rule and present in the request
 * receives the real secret, and every other credential header is removed, so that the agent cannot use its own key.
 */
export declare function injectSecrets(headers: IncomingHttpHeaders, rules: [string, SecretRule][], secretValues: Record<string, string>): IncomingHttpHeaders;
/** The decision taken for one connection. */
interface Decision {
    pass: boolean;
    action: ProxyAction;
    reason?: string;
}
/** Decides whether a connection may pass, according to the allowlist and the mode. */
export declare function decide(policy: ProxyPolicy, host: string, port: number): Decision;
/** Builds the proxy server. Call listen() on the result. */
export declare function createProxyServer(options: ProxyOptions): Server;
export {};
