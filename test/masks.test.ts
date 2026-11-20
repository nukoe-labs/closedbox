import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMaskedPaths, patternToRegExp } from "../src/masks.js";
import { DEFAULT_MASKS } from "../src/config.js";
import { makeTemporaryFolder } from "./helpers.js";

/** Checks that secrets are found at every depth, folders included, and that heavy folders and links are skipped. */
function findsSecretFiles(): void {
  const project = makeTemporaryFolder("masks");
  mkdirSync(join(project, "app", "config", "deep", "deeper", "deepest"), { recursive: true });
  mkdirSync(join(project, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(project, ".aws"));
  writeFileSync(join(project, ".env"), "A=1");
  writeFileSync(join(project, "app", ".env.local"), "A=1");
  writeFileSync(join(project, "app", "config", "server.pem"), "key");
  writeFileSync(join(project, "app", "config", "deep", "deeper", "deepest", ".env"), "too deep");
  writeFileSync(join(project, "node_modules", "pkg", ".env"), "skipped");
  writeFileSync(join(project, "README.md"), "# readme");
  symlinkSync(join(project, ".env"), join(project, "link.pem"));
  const found = findMaskedPaths(project, DEFAULT_MASKS);
  expect(found).toEqual(expect.arrayContaining([
    { path: ".env", isFolder: false },
    { path: ".aws", isFolder: true },
    { path: "app/.env.local", isFolder: false },
    { path: "app/config/server.pem", isFolder: false },
  ]));
  expect(found).toHaveLength(4);
  expect(findMaskedPaths(join(project, "missing"), DEFAULT_MASKS)).toEqual([]);
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
  it("converts patterns", convertsPatterns);
}
