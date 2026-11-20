const ACTIONS = new Set(["blocked", "allowed", "injected", "failed"]);
/** Reads one JSON line of the proxy journal, or returns undefined when the line is not an event. */
export function parseEvent(line) {
    try {
        const value = JSON.parse(line);
        const isEvent = ACTIONS.has(String(value.action)) && typeof value.host === "string" && typeof value.port === "number";
        if (!isEvent) {
            return undefined;
        }
        return value;
    }
    catch {
        return undefined;
    }
}
/** The words written in front of each action in the live journal. */
const LABELS = {
    blocked: "BLOCKED ",
    allowed: "allowed ",
    injected: "secret  ",
    failed: "failed  ",
};
/** The terminal colors of each action. */
const COLORS = {
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
export function formatEvent(event, command, useColor) {
    const label = useColor ? `${COLORS[event.action]}${LABELS[event.action]}${RESET}` : LABELS[event.action];
    const by = command === undefined ? "" : `  (by ${command})`;
    const reason = event.reason === undefined ? "" : `  [${event.reason}]`;
    return `${label} ${event.host}:${event.port}${by}${reason}`;
}
