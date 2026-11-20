/** Computes the digest of a configuration text. */
export declare function digestText(text: string): string;
/**
 * Tells whether this exact closedbox.toml was approved for this project. A repository can ship its own closedbox.toml
 * to widen the allowlist, so a new or changed file is never used before the person approves it.
 */
export declare function isTrusted(storePath: string, projectFolder: string, configText: string): boolean;
/** Records that the person approved this closedbox.toml for this project. */
export declare function trustConfig(storePath: string, projectFolder: string, configText: string): void;
