import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_TIMEOUT_MS, createJournal, listAuditHosts, listBlockedHosts } from "../src/journal.js";
import type { LineStream } from "../src/runner.js";
import { makeTemporaryFolder } from "./helpers.js";

/** A fake helper that remembers the ports asked and lets the test answer them. */
function createFakeWhois(): { start: (onAnswer: (line: string) => void) => LineStream; asked: string[]; answer: (line: string) => void; stopped: boolean[] } {
  const fake = { asked: [] as string[], stopped: [] as boolean[], answer: ignoreLine as (line: string) => void, start: startFake };
  /** Starts the fake helper. */
  function startFake(onAnswer: (line: string) => void): LineStream {
    fake.answer = onAnswer;
    return { send: rememberPort, stop: rememberStop };
  }
  /** Remembers a port asked. */
  function rememberPort(line: string): void {
    fake.asked.push(line);
  }
  /** Remembers that the helper was stopped. */
  function rememberStop(): void {
    fake.stopped.push(true);
  }
  return fake;
}

/** Ignores a line. */
function ignoreLine(): void {
  return undefined;
}

/** Builds a proxy line on port 443. */
function line(action: string, host: string, sourcePort: number, reason?: string): string {
  return JSON.stringify({ action, host, port: 443, sourcePort, reason });
}

/** Checks the ready line, attribution, answers in any order, timeouts and the final flush. */
function namesTheProcessOfEachConnection(): void {
  vi.useFakeTimers();
  const logPath = join(makeTemporaryFolder("journal"), "session.log");
  const shown: string[] = [];
  const whois = createFakeWhois();
  const journal = createJournal({ logPath, live: pushTo.bind(undefined, shown), useColor: false, startWhois: whois.start });
  expect(journal.readProxyLine('{"ready":true}')).toBe(true);
  expect(journal.readProxyLine("noise")).toBe(false);
  journal.readProxyLine(line("blocked", "evil.example", 40000, "not in the allowlist"));
  journal.readProxyLine(line("injected", "api.anthropic.com", 40001));
  journal.readProxyLine(line("injected", "api.anthropic.com", 40001));
  journal.readProxyLine(line("allowed", "pypi.org", 0));
  journal.readProxyLine(line("allowed", "slow.example", 40002));
  journal.readProxyLine(line("allowed", "never.example", 40003));
  expect(whois.asked).toEqual(["40000", "40001", "40002", "40003"]);
  whois.answer(JSON.stringify({ port: 40000, command: "node scripts/setup.js" }));
  whois.answer(JSON.stringify({ port: 49999, command: "unknown" }));
  whois.answer("not json");
  vi.advanceTimersByTime(ATTRIBUTION_TIMEOUT_MS);
  journal.stop();
  vi.useRealTimers();
  expect(shown).toContain("BLOCKED  evil.example:443  (by node scripts/setup.js)  [not in the allowlist]");
  expect(shown).toContain("allowed  slow.example:443");
  expect(shown.filter(isInjected)).toHaveLength(2);
  expect(readFileSync(logPath, "utf8")).toContain("evil.example:443");
  expect(journal.events).toHaveLength(6);
  expect(whois.stopped).toEqual([true]);
}

/** Checks that the journal writes the waiting events when it stops before any answer. */
function flushesWaitingEventsOnStop(): void {
  const logPath = join(makeTemporaryFolder("journal"), "session.log");
  const whois = createFakeWhois();
  const journal = createJournal({ logPath, live: undefined, useColor: true, startWhois: whois.start });
  journal.readProxyLine(line("blocked", "evil.example", 40000));
  journal.stop();
  expect(readFileSync(logPath, "utf8")).toContain("BLOCKED  evil.example:443");
  createJournal({ logPath, live: undefined, useColor: false, startWhois: whois.start }).stop();
}

/** Tells whether a journal line is an injection. */
function isInjected(text: string): boolean {
  return text.startsWith("secret");
}

/** Adds a line to a list. */
function pushTo(list: string[], text: string): void {
  list.push(text);
}

/** Checks the lists written in the summary and in the audit file. */
function listsAuditAndBlockedHosts(): void {
  const events = [
    { action: "allowed" as const, host: "b.example", port: 443, sourcePort: 1, reason: "audit: not in the allowlist" },
    { action: "allowed" as const, host: "a.example", port: 8080, sourcePort: 1, reason: "audit: not in the allowlist" },
    { action: "allowed" as const, host: "b.example", port: 443, sourcePort: 2, reason: "audit: not in the allowlist" },
    { action: "allowed" as const, host: "known.example", port: 443, sourcePort: 3 },
    { action: "blocked" as const, host: "evil.example", port: 443, sourcePort: 4 },
  ];
  expect(listAuditHosts(events)).toEqual(["a.example:8080", "b.example"]);
  expect(listBlockedHosts(events)).toEqual(["evil.example"]);
}

describe("journal", describeJournal);

/** Groups the journal tests. */
function describeJournal(): void {
  it("names the process of each connection", namesTheProcessOfEachConnection);
  it("flushes waiting events on stop", flushesWaitingEventsOnStop);
  it("lists audit and blocked hosts", listsAuditAndBlockedHosts);
}
