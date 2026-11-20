import { describe, expect, it } from "vitest";
import { formatEvent, parseEvent } from "../src/events.js";

/** Checks the reading of journal lines. */
function readsEvents(): void {
  const line = JSON.stringify({ action: "blocked", host: "evil.example", port: 443, sourcePort: 40000 });
  expect(parseEvent(line)).toMatchObject({ action: "blocked", host: "evil.example" });
  expect(parseEvent("not json")).toBeUndefined();
  expect(parseEvent(JSON.stringify({ action: "other", host: "a", port: 1 }))).toBeUndefined();
  expect(parseEvent(JSON.stringify({ action: "allowed", host: 1, port: 1 }))).toBeUndefined();
  expect(parseEvent(JSON.stringify({ action: "allowed", host: "a", port: "1" }))).toBeUndefined();
}

/** Checks the journal lines, with and without the command, the reason and the colors. */
function formatsEvents(): void {
  const event = { action: "blocked" as const, host: "evil.example", port: 443, sourcePort: 1, reason: "not in the allowlist" };
  expect(formatEvent(event, "node scripts/setup.js", false)).toBe("BLOCKED  evil.example:443  (by node scripts/setup.js)  [not in the allowlist]");
  expect(formatEvent({ action: "allowed", host: "a", port: 443, sourcePort: 1 }, undefined, false)).toBe("allowed  a:443");
  expect(formatEvent({ action: "injected", host: "a", port: 443, sourcePort: 1 }, undefined, true)).toContain("\u001B[36m");
  expect(formatEvent({ action: "failed", host: "a", port: 443, sourcePort: 1 }, undefined, true)).toContain("failed");
}

describe("events", describeEvents);

/** Groups the event tests. */
function describeEvents(): void {
  it("reads events", readsEvents);
  it("formats events", formatsEvents);
}
