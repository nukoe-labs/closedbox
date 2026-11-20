import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";

/** One file or folder of the project hidden from the agent. */
export interface MaskedPath {
  /** The path relative to the project folder, with forward slashes. */
  path: string;
  isFolder: boolean;
}

/** The folders never searched: they are large and are not where secrets are kept by hand. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "vendor", ".venv", "target", "dist"]);

/** How deep the search goes below the project folder. */
export const MASK_SEARCH_DEPTH = 4;

/** Turns a pattern with * into a regular expression that matches a whole file name. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "u");
}

/** Reads the entries of a folder, or nothing when it cannot be read. */
function readEntries(folder: string): Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The state shared while searching the project. */
interface Search {
  root: string;
  patterns: RegExp[];
  found: MaskedPath[];
}

/** Tells whether a file name matches one of the patterns. */
function matchesAny(patterns: RegExp[], name: string): boolean {
  return patterns.some(testName, name);
}

/** Tests a name against one pattern. */
function testName(this: string, pattern: RegExp): boolean {
  return pattern.test(this);
}

/**
 * Looks at one entry: records it when it matches, or searches inside it when it is a folder. A symbolic link is skipped:
 * inside the container it points into the container, never to the files of the computer.
 */
function visitEntry(search: Search, relativeFolder: string, depth: number, entry: Dirent): void {
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
function searchFolder(search: Search, relativeFolder: string, depth: number): void {
  const entries = readEntries(join(search.root, relativeFolder));
  for (const entry of entries) {
    visitEntry(search, relativeFolder, depth, entry);
  }
}

/** Finds the files and folders of the project whose name matches one of the mask patterns. */
export function findMaskedPaths(projectFolder: string, patterns: string[]): MaskedPath[] {
  const search: Search = { root: projectFolder, patterns: patterns.map(patternToRegExp), found: [] };
  searchFolder(search, "", 1);
  return search.found;
}
