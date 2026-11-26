import { isIP } from "node:net";

/** The port used when an allowlist entry gives none: HTTPS. */
export const DEFAULT_PORT = 443;

/** One allowlist entry: a host name, or *.domain for every name below that domain, and a port. */
export interface AllowRule {
  host: string;
  port: number;
}

const HOST_NAME = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HIGHEST_PORT = 65_535;

/** Reads a port written as text and checks that it is a valid TCP port. */
function readPort(text: string, entry: string): number {
  const port = Number(text);
  const isValidPort = Number.isInteger(port) && port >= 1 && port <= HIGHEST_PORT;
  if (!isValidPort) {
    throw new RangeError(`"${entry}" has a wrong port: use a number from 1 to 65535.`);
  }
  return port;
}

/** Reads one allowlist entry such as "registry.npmjs.org", "*.github.com" or "example.com:8443". */
export function parseAllowRule(entry: string): AllowRule {
  const lowerEntry = entry.trim().toLowerCase();
  if (lowerEntry.includes("/")) {
    throw new RangeError(`"${entry}" is an address: give the host name only, for example example.com.`);
  }
  const separator = lowerEntry.lastIndexOf(":");
  const hasPort = separator > 0 && !lowerEntry.includes("]");
  const host = hasPort ? lowerEntry.slice(0, separator) : lowerEntry;
  const port = hasPort ? readPort(lowerEntry.slice(separator + 1), entry) : DEFAULT_PORT;
  const isValidHost = HOST_NAME.test(host) || isIP(host) !== 0;
  if (!isValidHost) {
    throw new RangeError(`"${entry}" is not a host name, a *.domain pattern or an IP address.`);
  }
  return { host, port };
}

/** Tells whether a host name is covered by one rule host, exactly or below a *.domain pattern. */
function hostMatches(ruleHost: string, host: string): boolean {
  if (ruleHost.startsWith("*.")) {
    return host.endsWith(ruleHost.slice(1));
  }
  return ruleHost === host;
}

/** Tells whether the connection to host:port is allowed by at least one rule. */
export function isAllowed(rules: AllowRule[], host: string, port: number): boolean {
  const lowerHost = normalizeHost(host);
  for (const rule of rules) {
    const isMatch = rule.port === port && hostMatches(rule.host, lowerHost);
    if (isMatch) {
      return true;
    }
  }
  return false;
}

/** Writes a host name in lower case, without a final dot and without the brackets of an IPv6 address. */
export function normalizeHost(host: string): string {
  const lowerHost = host.toLowerCase().replace(/\.$/u, "");
  return lowerHost.replace(/^\[(.*)\]$/u, "$1");
}

const PRIVATE_IPV4 = [/^10\./u, /^127\./u, /^0\./u, /^169\.254\./u, /^192\.168\./u, /^172\.(?:1[6-9]|2\d|3[01])\./u, /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u];
const PRIVATE_IPV6 = [/^::1?$/u, /^f[cd]/u, /^fe[89ab]/u, /^::ffff:/u];

/** Tells whether a text matches a pattern, used to test an address against a list of patterns. */
function matchesPattern(this: string, pattern: RegExp): boolean {
  return pattern.test(this);
}

/**
 * Tells whether an IP address belongs to the computer, the local network or the container network,
 * which the proxy never reaches so that the agent cannot attack local services.
 */
export function isPrivateAddress(address: string): boolean {
  const lowerAddress = address.toLowerCase();
  if (isIP(lowerAddress) === 4) {
    return PRIVATE_IPV4.some(matchesPattern, lowerAddress);
  }
  return PRIVATE_IPV6.some(matchesPattern, lowerAddress);
}
