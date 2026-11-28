/** One file or folder of the project hidden from the agent. */
export interface MaskedPath {
    /** The path relative to the project folder, with forward slashes. */
    path: string;
    isFolder: boolean;
}
/** Turns a pattern with * into a regular expression that matches a whole file name. */
export declare function patternToRegExp(pattern: string): RegExp;
/**
 * Finds the files and folders of the project whose name matches one of the mask patterns, at any depth: a secret kept
 * in a deep folder is as readable as one at the root. The folders are searched one after the other, without recursion,
 * so that a planted tree of nested folders cannot overflow the stack. Symbolic links are not followed.
 */
export declare function findMaskedPaths(projectFolder: string, patterns: string[]): MaskedPath[];
