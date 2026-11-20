import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
/** Computes the digest of a configuration text. */
export function digestText(text) {
    return createHash("sha256").update(text).digest("hex");
}
/** Reads the list of approved configurations, or an empty list when there is none yet. */
function readStore(storePath) {
    if (!existsSync(storePath)) {
        return {};
    }
    return JSON.parse(readFileSync(storePath, "utf8"));
}
/**
 * Tells whether this exact closedbox.toml was approved for this project. A repository can ship its own closedbox.toml
 * to widen the allowlist, so a new or changed file is never used before the person approves it.
 */
export function isTrusted(storePath, projectFolder, configText) {
    const store = readStore(storePath);
    return store[projectFolder] === digestText(configText);
}
/** Records that the person approved this closedbox.toml for this project. */
export function trustConfig(storePath, projectFolder, configText) {
    const store = readStore(storePath);
    store[projectFolder] = digestText(configText);
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}
