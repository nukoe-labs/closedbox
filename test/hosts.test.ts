import { describe, expect, it } from "vitest";
import { isAllowed, isPrivateAddress, normalizeHost, parseAllowRule } from "../src/hosts.js";

/** Checks the accepted allowlist entries. */
function readsAllowRules(): void {
  expect(parseAllowRule(" Registry.NPMJS.org ")).toEqual({ host: "registry.npmjs.org", port: 443 });
  expect(parseAllowRule("*.github.com")).toEqual({ host: "*.github.com", port: 443 });
  expect(parseAllowRule("example.com:8080")).toEqual({ host: "example.com", port: 8080 });
  expect(parseAllowRule("10.0.0.1:80")).toEqual({ host: "10.0.0.1", port: 80 });
}

/** Checks that wrong entries are refused. */
function refusesWrongRules(): void {
  expect(parseAllowRule.bind(undefined, "exa mple.com")).toThrow("not a host name");
  expect(parseAllowRule.bind(undefined, "https://example.com/path")).toThrow("is an address: give the host name only");
  expect(parseAllowRule.bind(undefined, "example.com/path")).toThrow("is an address");
  expect(parseAllowRule.bind(undefined, "example.com:0")).toThrow("wrong port");
  expect(parseAllowRule.bind(undefined, "example.com:70000")).toThrow("wrong port");
  expect(parseAllowRule.bind(undefined, "[::1]:443")).toThrow("not a host name");
}

/** Checks exact names, wildcard domains, ports and look-alike domains. */
function matchesHosts(): void {
  const rules = [parseAllowRule("api.example.com"), parseAllowRule("*.github.com"), parseAllowRule("plain.example:80")];
  expect(isAllowed(rules, "API.example.com.", 443)).toBe(true);
  expect(isAllowed(rules, "api.example.com", 80)).toBe(false);
  expect(isAllowed(rules, "codeload.github.com", 443)).toBe(true);
  expect(isAllowed(rules, "github.com", 443)).toBe(false);
  expect(isAllowed(rules, "evilgithub.com", 443)).toBe(false);
  expect(isAllowed(rules, "plain.example", 80)).toBe(true);
}

/** Checks the private and public addresses, in IPv4 and IPv6. */
function recognizesPrivateAddresses(): void {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    expect(isPrivateAddress(address), address).toBe(true);
  }
  for (const address of ["1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
    expect(isPrivateAddress(address), address).toBe(false);
  }
  expect(normalizeHost("[::1]")).toBe("::1");
}

describe("hosts", describeHosts);

/** Groups the host tests. */
function describeHosts(): void {
  it("reads allow rules", readsAllowRules);
  it("refuses wrong rules", refusesWrongRules);
  it("matches hosts", matchesHosts);
  it("recognizes private addresses", recognizesPrivateAddresses);
}
