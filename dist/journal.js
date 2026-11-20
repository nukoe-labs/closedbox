import { appendFileSync } from "node:fs";
import { formatEvent, parseEvent } from "./events.js";
/** How long the journal waits for the name of the process before writing a line without it. */
export const ATTRIBUTION_TIMEOUT_MS = 3000;
/** Writes one event to the log file and, when asked, on the terminal. */
function writeEvent(state, event, command) {
    appendFileSync(state.options.logPath, `${new Date().toISOString()} ${formatEvent(event, command, false)}\n`);
    state.options.live?.(formatEvent(event, command, state.options.useColor));
}
/** Writes an event that is still waiting for its process name, without the name. */
function writeWithoutCommand(state, event) {
    state.waiting.delete(event.sourcePort);
    writeEvent(state, event, undefined);
}
/** Reads one answer of the helper and writes the event that waited for it. */
function readWhoisAnswer(state, line) {
    try {
        const answer = JSON.parse(line);
        const pending = state.waiting.get(answer.port);
        if (pending === undefined) {
            return;
        }
        clearTimeout(pending.timer);
        state.waiting.delete(answer.port);
        writeEvent(state, pending.event, answer.command);
    }
    catch {
        return;
    }
}
/** Asks the helper which process opened the connection of an event, and writes the event when it answers. */
function attribute(state, event) {
    state.whois ??= state.options.startWhois(readWhoisAnswer.bind(undefined, state));
    const timer = setTimeout(writeWithoutCommand, ATTRIBUTION_TIMEOUT_MS, state, event);
    state.waiting.set(event.sourcePort, { event, timer });
    state.whois.send(String(event.sourcePort));
}
/** Reads one proxy line: the ready signal, an event, or anything else, which is ignored. */
function readProxyLine(state, line) {
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
function stopJournal(state) {
    for (const pending of [...state.waiting.values()]) {
        clearTimeout(pending.timer);
        writeWithoutCommand(state, pending.event);
    }
    state.whois?.stop();
}
/** Creates the journal of one session. */
export function createJournal(options) {
    const state = { options, events: [], waiting: new Map(), whois: undefined };
    return { readProxyLine: readProxyLine.bind(undefined, state), events: state.events, stop: stopJournal.bind(undefined, state) };
}
/** Lists the hosts that were let through only because of audit mode, as host or host:port allowlist entries. */
export function listAuditHosts(events) {
    const hosts = events.filter(isAuditPass).map(toAllowEntry);
    return [...new Set(hosts)].sort();
}
/** Tells whether an event was let through only because of audit mode. */
function isAuditPass(event) {
    return event.action === "allowed" && event.reason?.startsWith("audit") === true;
}
/** Writes an event as an allowlist entry, without the port when it is 443. */
function toAllowEntry(event) {
    return event.port === 443 ? event.host : `${event.host}:${event.port}`;
}
/** Lists the blocked hosts once each, for the summary written at the end of the session. */
export function listBlockedHosts(events) {
    const hosts = events.filter(isBlocked).map(toAllowEntry);
    return [...new Set(hosts)].sort();
}
/** Tells whether an event is a blocked connection. */
function isBlocked(event) {
    return event.action === "blocked";
}
