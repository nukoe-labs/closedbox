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

const ACTIONS = new Set<string>(["blocked", "allowed", "injected", "failed"]);

/** Reads one JSON line of the proxy journal, or returns undefined when the line is not an event. */
export function parseEvent(line: string): ProxyEvent | undefined {
  try {
    const value = JSON.parse(line) as Partial<ProxyEvent>;
    const isEvent = ACTIONS.has(String(value.action)) && typeof value.host === "string" && typeof value.port === "number";
    if (!isEvent) {
      return undefined;
    }
    return value as ProxyEvent;
  } catch {
    return undefined;
  }
}

/** The words written in front of each action in the live journal. */
const LABELS: Record<ProxyAction, string> = {
  blocked: "BLOCKED ",
  allowed: "allowed ",
  injected: "secret  ",
  failed: "failed  ",
};

/** The terminal colors of each action. */
const COLORS: Record<ProxyAction, string> = {
  blocked: "\u001B[1;31m",
  allowed: "\u001B[32m",
  injected: "\u001B[36m",
  failed: "\u001B[33m",
};

const RESET = "\u001B[0m";

/**
 * Writes one journal line, such as "BLOCKED  evil.example:443  (by node scripts/setup.js)".
 * The process is unknown when the connection closed before it could be found.
 */
export function formatEvent(event: ProxyEvent, command: string | undefined, useColor: boolean): string {
  const label = useColor ? `${COLORS[event.action]}${LABELS[event.action]}${RESET}` : LABELS[event.action];
  const by = command === undefined ? "" : `  (by ${command})`;
  const reason = event.reason === undefined ? "" : `  [${event.reason}]`;
  return `${label} ${event.host}:${event.port}${by}${reason}`;
}
