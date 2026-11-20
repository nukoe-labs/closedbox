/** What the proxy did with one connection. */
export type ProxyAction = "blocked" | "allowed" | "injected" | "failed";
/** One line of the proxy journal. */
export interface ProxyEvent {
    action: ProxyAction;
    host: string;
    port: number;
    /** The TCP port of the agent side, used to find the process that opened the connection. */
    sourcePort: number;
    /** Why the connection was blocked or failed, when it was. */
    reason?: string;
}
/** Reads one JSON line of the proxy journal, or returns undefined when the line is not an event. */
export declare function parseEvent(line: string): ProxyEvent | undefined;
/**
 * Writes one journal line, such as "BLOCKED  evil.example:443  (by node scripts/setup.js)".
 * The process is unknown when the connection closed before it could be found.
 */
export declare function formatEvent(event: ProxyEvent, command: string | undefined, useColor: boolean): string;
