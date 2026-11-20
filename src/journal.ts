import { appendFileSync } from "node:fs";
import { formatEvent, parseEvent, type ProxyEvent } from "./events.js";
import type { LineStream } from "./runner.js";

/** How long the journal waits for the name of the process before writing a line without it. */
export const ATTRIBUTION_TIMEOUT_MS = 3000;

/** Where the journal writes, and how it finds the process behind a connection. */
export interface JournalOptions {
  logPath: string;
  /** Writes a colored line on the terminal, when the journal is shown live. */
  live: ((line: string) => void) | undefined;
  useColor: boolean;
  /** Starts the helper that names the process behind a source port; it answers JSON lines. */
  startWhois: (onAnswer: (line: string) => void) => LineStream;
}

/** The journal of one session: it receives the proxy lines, names the processes and keeps the events. */
export interface Journal {
  /** Reads one line written by the proxy. Returns true for the line that says the proxy is ready. */
  readProxyLine: (line: string) => boolean;
  events: ProxyEvent[];
  stop: () => void;
}

/** The inner state of a journal. */
interface JournalState {
  options: JournalOptions;
  events: ProxyEvent[];
  waiting: Map<number, { event: ProxyEvent; timer: NodeJS.Timeout }>;
  whois: LineStream | undefined;
}

/** Writes one event to the log file and, when asked, on the terminal. */
function writeEvent(state: JournalState, event: ProxyEvent, command: string | undefined): void {
  appendFileSync(state.options.logPath, `${new Date().toISOString()} ${formatEvent(event, command, false)}\n`);
  state.options.live?.(formatEvent(event, command, state.options.useColor));
}

/** Writes an event that is still waiting for its process name, without the name. */
function writeWithoutCommand(state: JournalState, event: ProxyEvent): void {
  state.waiting.delete(event.sourcePort);
  writeEvent(state, event, undefined);
}

/** Reads one answer of the helper and writes the event that waited for it. */
function readWhoisAnswer(state: JournalState, line: string): void {
  try {
    const answer = JSON.parse(line) as { port: number; command?: string };
    const pending = state.waiting.get(answer.port);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    state.waiting.delete(answer.port);
    writeEvent(state, pending.event, answer.command);
  } catch {
    return;
  }
}

/** Asks the helper which process opened the connection of an event, and writes the event when it answers. */
function attribute(state: JournalState, event: ProxyEvent): void {
  state.whois ??= state.options.startWhois(readWhoisAnswer.bind(undefined, state));
  const timer = setTimeout(writeWithoutCommand, ATTRIBUTION_TIMEOUT_MS, state, event);
  state.waiting.set(event.sourcePort, { event, timer });
  state.whois.send(String(event.sourcePort));
}

/** Reads one proxy line: the ready signal, an event, or anything else, which is ignored. */
function readProxyLine(state: JournalState, line: string): boolean {
  if (line.includes('"ready":true')) {
    return true;
  }
  const event = parseEvent(line);
  if (event === undefined) {
    return false;
  }
  state.events.push(event);
  const isNewConnection = event.sourcePort > 0 && !state.waiting.has(event.sourcePort);
  if (isNewConnection) {
    attribute(state, event);
    return false;
  }
  writeEvent(state, event, undefined);
  return false;
}

/** Writes every event still waiting, then stops the helper. */
function stopJournal(state: JournalState): void {
  for (const pending of [...state.waiting.values()]) {
    clearTimeout(pending.timer);
    writeWithoutCommand(state, pending.event);
  }
  state.whois?.stop();
}

/** Creates the journal of one session. */
export function createJournal(options: JournalOptions): Journal {
  const state: JournalState = { options, events: [], waiting: new Map(), whois: undefined };
  return { readProxyLine: readProxyLine.bind(undefined, state), events: state.events, stop: stopJournal.bind(undefined, state) };
}

/** Lists the hosts that were let through only because of audit mode, as host or host:port allowlist entries. */
export function listAuditHosts(events: ProxyEvent[]): string[] {
  const hosts = events.filter(isAuditPass).map(toAllowEntry);
  return [...new Set(hosts)].sort();
}

/** Tells whether an event was let through only because of audit mode. */
function isAuditPass(event: ProxyEvent): boolean {
  return event.action === "allowed" && event.reason?.startsWith("audit") === true;
}

/** Writes an event as an allowlist entry, without the port when it is 443. */
function toAllowEntry(event: ProxyEvent): string {
  return event.port === 443 ? event.host : `${event.host}:${event.port}`;
}

/** Lists the blocked hosts once each, for the summary written at the end of the session. */
export function listBlockedHosts(events: ProxyEvent[]): string[] {
  const hosts = events.filter(isBlocked).map(toAllowEntry);
  return [...new Set(hosts)].sort();
}

/** Tells whether an event is a blocked connection. */
function isBlocked(event: ProxyEvent): boolean {
  return event.action === "blocked";
}
