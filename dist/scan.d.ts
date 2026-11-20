/** What the wormsign scan found before the start. */
export interface ScanOutcome {
    /** Tells whether at least one worm sign (critical or high) was found. */
    blocked: boolean;
    report: string;
}
/** Scans the project folder with wormsign, the same rules as the GitHub scan, before any agent opens it. */
export declare function scanProject(projectFolder: string, useColor: boolean): Promise<ScanOutcome>;
