import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMaskedPaths, patternToRegExp } from "../src/masks.js";
import { DEFAULT_MASKS } from "../src/config.js";
import { makeTemporaryFolder } from "./helpers.js";

/** Checks that secrets are found at every depth and in every folder but node_modules and .git, folders included, and that links are skipped. */
function findsSecretFiles(): void {
  const project = makeTemporaryFolder("masks");
  mkdirSync(join(project, "app", "config", "deep", "deeper", "deepest"), { recursive: true });
  mkdirSync(join(project, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(project, ".aws"));
  writeFileSync(join(project, ".env"), "A=1");
  writeFileSync(join(project, "app", ".env.local"), "A=1");
  writeFileSync(join(project, "app", "config", "server.pem"), "key");
  writeFileSync(join(project, "app", "config", "deep", "deeper", "deepest", ".env"), "deep");
  mkdirSync(join(project, "vendor", "bundle"), { recursive: true });
  mkdirSync(join(project, "dist"));
  mkdirSync(join(project, ".git", "modules"), { recursive: true });
  writeFileSync(join(project, "vendor", "bundle", ".env"), "A=1");
  writeFileSync(join(project, "dist", "id_rsa"), "key");
  writeFileSync(join(project, ".git", "modules", ".env"), "skipped");
  writeFileSync(join(project, "node_modules", "pkg", ".env"), "skipped");
  writeFileSync(join(project, "README.md"), "# readme");
  symlinkSync(join(project, ".env"), join(project, "link.pem"));
  const found = findMaskedPaths(project, DEFAULT_MASKS);
  expect(found).toEqual(expect.arrayContaining([
    { path: ".env", isFolder: false },
    { path: ".aws", isFolder: true },
    { path: "app/.env.local", isFolder: false },
    { path: "app/config/server.pem", isFolder: false },
    { path: "app/config/deep/deeper/deepest/.env", isFolder: false },
    { path: "vendor/bundle/.env", isFolder: false },
    { path: "dist/id_rsa", isFolder: false },
  ]));
  expect(found).toHaveLength(7);
  expect(findMaskedPaths(join(project, "missing"), DEFAULT_MASKS)).toEqual([]);
}

/** Checks that a very deep tree of folders is searched to its end without recursion. */
function searchesAVeryDeepTree(): void {
  const project = makeTemporaryFolder("masks-deep");
  const levels = Array.from({ length: 300 }, returnLevel);
  mkdirSync(join(project, ...levels), { recursive: true });
  writeFileSync(join(project, ...levels, ".npmrc"), "token");
  expect(findMaskedPaths(project, DEFAULT_MASKS)).toEqual([{ path: `${levels.join("/")}/.npmrc`, isFolder: false }]);
}

/** Gives the name of one level of the deep tree. */
function returnLevel(): string {
  return "d";
}

/** Checks the conversion of patterns. */
function convertsPatterns(): void {
  expect(patternToRegExp(".env.*").test(".env.local")).toBe(true);
  expect(patternToRegExp(".env.*").test("xenv.local")).toBe(false);
  expect(patternToRegExp("id_rsa*").test("id_rsa.pub")).toBe(true);
}

describe("masks", describeMasks);

/** Groups the mask tests. */
function describeMasks(): void {
  it("finds secret files", findsSecretFiles);
  it("searches a very deep tree", searchesAVeryDeepTree);
  it("converts patterns", convertsPatterns);
}
