import { formatText, isWormSign, scanDirectory } from "wormsign";
/** Scans the project folder with wormsign, the same rules as the GitHub scan, before any agent opens it. */
export async function scanProject(projectFolder, useColor) {
    const findings = await scanDirectory(projectFolder);
    const blocked = findings.some(isWormSign);
    const report = findings.length === 0 ? "" : formatText(findings, 1, useColor);
    return { blocked, report };
}
