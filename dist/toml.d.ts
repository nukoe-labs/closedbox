/** A value read from a TOML file: a text, a number, a boolean, a list or a table. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
/** A TOML table: names linked to values. */
export interface TomlTable {
    [key: string]: TomlValue;
}
/** The error thrown when a line of the file does not follow the supported TOML subset. */
export declare class TomlError extends Error {
    /** Builds the error with the line number, so that the person can find the mistake. */
    constructor(lineNumber: number, reason: string);
}
/** Reads one value: a text, a boolean, a whole number or a list. */
export declare function readValue(text: string, lineNumber: number): TomlValue;
/**
 * Reads the subset of TOML used by stillsuit.toml: tables, dotted tables, quoted texts, booleans,
 * whole numbers and lists, with comments.
 */
export declare function parseToml(text: string): TomlTable;
