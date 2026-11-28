import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";

/** One file or folder of the project hidden from the agent. */
export interface MaskedPath {
  /** The path relative to the project folder, with forward slashes. */
  path: string;
  isFolder: boolean;
}

/** The folders never searched: they hold downloaded packages and repository data, not secrets kept by hand. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);

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

/** Tells whether a file name matches one of the patterns. */
function matchesAny(patterns: RegExp[], name: string): boolean {
  return patterns.some(testName, name);
}

/** Tests a name against one pattern. */
function testName(this: string, pattern: RegExp): boolean {
  return pattern.test(this);
}

/**
 * Looks at one entry: records it when it matches, or returns the path of the folder to search next when it is a folder.
 * A symbolic link is skipped: inside the container it points into the container, never to the files of the computer.
 */
function visitEntry(patterns: RegExp[], found: MaskedPath[], relativeFolder: string, entry: Dirent): string | undefined {
  if (entry.isSymbolicLink()) {
    return undefined;
  }
  const relativePath = relativeFolder === "" ? entry.name : `${relativeFolder}/${entry.name}`;
  const isFolder = entry.isDirectory();
  if (matchesAny(patterns, entry.name)) {
    found.push({ path: relativePath, isFolder });
    return undefined;
  }
  return isFolder && !SKIPPED_FOLDERS.has(entry.name) ? relativePath : undefined;
}

/** Searches the entries of one folder, records the matching ones and returns the folders to search next. */
function searchFolder(patterns: RegExp[], found: MaskedPath[], projectFolder: string, relativeFolder: string): string[] {
  const entries = readEntries(join(projectFolder, relativeFolder));
  const nextFolders = entries.map(visitEntry.bind(undefined, patterns, found, relativeFolder));
  return nextFolders.filter(isFolderPath);
}

/** Tells whether a visit returned the path of a folder to search. */
function isFolderPath(path: string | undefined): path is string {
  return path !== undefined;
}

/**
 * Finds the files and folders of the project whose name matches one of the mask patterns, at any depth: a secret kept
 * in a deep folder is as readable as one at the root. The folders are searched one after the other, without recursion,
 * so that a planted tree of nested folders cannot overflow the stack. Symbolic links are not followed.
 */
export function findMaskedPaths(projectFolder: string, patterns: string[]): MaskedPath[] {
  const compiled = patterns.map(patternToRegExp);
  const found: MaskedPath[] = [];
  const foldersToSearch = [""];
  for (const relativeFolder of foldersToSearch) {
    foldersToSearch.push(...searchFolder(compiled, found, projectFolder, relativeFolder));
  }
  return found;
}
