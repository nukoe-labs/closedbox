import { formatText, isWormSign, scanDirectory } from "wormsign";

/** What the wormsign scan found before the start. */
export interface ScanOutcome {
  /** Tells whether at least one worm sign (critical or high) was found. */
  blocked: boolean;
  report: string;
}

/** Scans the project folder with wormsign, the same rules as the GitHub scan, before any agent opens it. */
export async function scanProject(projectFolder: string, useColor: boolean): Promise<ScanOutcome> {
  const findings = await scanDirectory(projectFolder);
  const blocked = findings.some(isWormSign);
  const report = findings.length === 0 ? "" : formatText(findings, 1, useColor);
  return { blocked, report };
}
