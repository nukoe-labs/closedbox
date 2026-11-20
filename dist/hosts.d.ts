/** The port used when an allowlist entry gives none: HTTPS. */
export declare const DEFAULT_PORT = 443;
/** One allowlist entry: a host name, or *.domain for every name below that domain, and a port. */
export interface AllowRule {
    host: string;
    port: number;
}
/** Reads one allowlist entry such as "registry.npmjs.org", "*.github.com" or "example.com:8443". */
export declare function parseAllowRule(entry: string): AllowRule;
/** Tells whether the connection to host:port is allowed by at least one rule. */
export declare function isAllowed(rules: AllowRule[], host: string, port: number): boolean;
/** Writes a host name in lower case, without a final dot and without the brackets of an IPv6 address. */
export declare function normalizeHost(host: string): string;
/**
 * Tells whether an IP address belongs to the computer, the local network or the container network,
 * which the proxy never reaches so that the agent cannot attack local services.
 */
export declare function isPrivateAddress(address: string): boolean;
