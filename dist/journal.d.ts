import { type ProxyEvent } from "./events.js";
import type { LineStream } from "./runner.js";
/** How long the journal waits for the name of the process before writing a line without it. */
export declare const ATTRIBUTION_TIMEOUT_MS = 3000;
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
/** Creates the journal of one session. */
export declare function createJournal(options: JournalOptions): Journal;
/** Lists the hosts that were let through only because of audit mode, as host or host:port allowlist entries. */
export declare function listAuditHosts(events: ProxyEvent[]): string[];
/** Lists the blocked hosts once each, for the summary written at the end of the session. */
export declare function listBlockedHosts(events: ProxyEvent[]): string[];
