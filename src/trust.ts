import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The approved closedbox.toml files, by project folder, with the digest of the approved text. */
type TrustStore = Record<string, string>;

/** Computes the digest of a configuration text. */
export function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Reads the list of approved configurations, or an empty list when there is none yet. */
function readStore(storePath: string): TrustStore {
  if (!existsSync(storePath)) {
    return {};
  }
  return JSON.parse(readFileSync(storePath, "utf8")) as TrustStore;
}

/**
 * Tells whether this exact closedbox.toml was approved for this project. A repository can ship its own closedbox.toml
 * to widen the allowlist, so a new or changed file is never used before the person approves it.
 */
export function isTrusted(storePath: string, projectFolder: string, configText: string): boolean {
  const store = readStore(storePath);
  return store[projectFolder] === digestText(configText);
}

/** Records that the person approved this closedbox.toml for this project. */
export function trustConfig(storePath: string, projectFolder: string, configText: string): void {
  const store = readStore(storePath);
  store[projectFolder] = digestText(configText);
  mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}
