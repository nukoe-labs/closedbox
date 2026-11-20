import { readdirSync } from "node:fs";
import { join } from "node:path";
/** The folders never searched: they are large and are not where secrets are kept by hand. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "vendor", ".venv", "target", "dist"]);
/** How deep the search goes below the project folder. */
export const MASK_SEARCH_DEPTH = 4;
/** Turns a pattern with * into a regular expression that matches a whole file name. */
export function patternToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "u");
}
/** Reads the entries of a folder, or nothing when it cannot be read. */
function readEntries(folder) {
    try {
        return readdirSync(folder, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
/** Tells whether a file name matches one of the patterns. */
function matchesAny(patterns, name) {
    return patterns.some(testName, name);
}
/** Tests a name against one pattern. */
function testName(pattern) {
    return pattern.test(this);
}
/**
 * Looks at one entry: records it when it matches, or searches inside it when it is a folder. A symbolic link is skipped:
 * inside the container it points into the container, never to the files of the computer.
 */
function visitEntry(search, relativeFolder, depth, entry) {
    if (entry.isSymbolicLink()) {
        return;
    }
    const relativePath = relativeFolder === "" ? entry.name : `${relativeFolder}/${entry.name}`;
    const isFolder = entry.isDirectory();
    if (matchesAny(search.patterns, entry.name)) {
        search.found.push({ path: relativePath, isFolder });
        return;
    }
    const mustSearchInside = isFolder && !SKIPPED_FOLDERS.has(entry.name) && depth < MASK_SEARCH_DEPTH;
    if (mustSearchInside) {
        searchFolder(search, relativePath, depth + 1);
    }
}
/** Searches one folder of the project. Symbolic links are not followed. */
function searchFolder(search, relativeFolder, depth) {
    const entries = readEntries(join(search.root, relativeFolder));
    for (const entry of entries) {
        visitEntry(search, relativeFolder, depth, entry);
    }
}
/** Finds the files and folders of the project whose name matches one of the mask patterns. */
export function findMaskedPaths(projectFolder, patterns) {
    const search = { root: projectFolder, patterns: patterns.map(patternToRegExp), found: [] };
    searchFolder(search, "", 1);
    return search.found;
}
