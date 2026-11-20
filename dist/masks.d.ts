/** One file or folder of the project hidden from the agent. */
export interface MaskedPath {
    /** The path relative to the project folder, with forward slashes. */
    path: string;
    isFolder: boolean;
}
/** How deep the search goes below the project folder. */
export declare const MASK_SEARCH_DEPTH = 4;
/** Turns a pattern with * into a regular expression that matches a whole file name. */
export declare function patternToRegExp(pattern: string): RegExp;
/** Finds the files and folders of the project whose name matches one of the mask patterns. */
export declare function findMaskedPaths(projectFolder: string, patterns: string[]): MaskedPath[];
