import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureCertificateAuthority, ensureHostCertificate } from "../src/certs.js";
import { AGENT_PACKAGES, ensureAgentImage, imageTag, writeDockerfile } from "../src/images.js";
import { SYSTEM_RUNNER } from "../src/runner.js";
import { scanProject } from "../src/scan.js";
import { digestText, isTrusted, trustConfig } from "../src/trust.js";
import { createFakeRunner, makeTemporaryFolder } from "./helpers.js";

/** Checks that a configuration is trusted only in its approved version and only for its project. */
function trustsOnlyTheApprovedText(): void {
  const storePath = join(makeTemporaryFolder("trust"), "nested", "trusted.json");
  expect(isTrusted(storePath, "/p", "a")).toBe(false);
  trustConfig(storePath, "/p", "a");
  expect(isTrusted(storePath, "/p", "a")).toBe(true);
  expect(isTrusted(storePath, "/p", "b")).toBe(false);
  expect(isTrusted(storePath, "/q", "a")).toBe(false);
  expect(statSync(storePath).mode & 0o777).toBe(0o600);
  expect(digestText("a")).toHaveLength(64);
}

/** Checks that wormsign stops a trapped project and lets a clean one start. */
async function scansTheProjectWithWormsign(): Promise<void> {
  const project = makeTemporaryFolder("scan");
  await expect(scanProject(project, false)).resolves.toEqual({ blocked: false, report: "" });
  mkdirSync(join(project, ".claude"));
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node .claude/setup.js" }] }] } }));
  const outcome = await scanProject(project, false);
  expect(outcome.blocked).toBe(true);
  expect(outcome.report).toContain("WS001");
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "npm run lint" }] }] } }));
  const noteOnly = await scanProject(project, false);
  expect(noteOnly.blocked).toBe(false);
  expect(noteOnly.report).toContain("WS010");
}

/** Checks that real certificates are made once, with private keys readable by the owner only. */
async function makesRealCertificatesOnce(): Promise<void> {
  const folder = join(makeTemporaryFolder("certs"), "ca");
  const caPath = await ensureCertificateAuthority(SYSTEM_RUNNER, folder);
  expect(readFileSync(caPath, "utf8")).toContain("BEGIN CERTIFICATE");
  expect(statSync(join(folder, "ca.key")).mode & 0o777).toBe(0o600);
  await expect(ensureCertificateAuthority(SYSTEM_RUNNER, folder)).resolves.toBe(caPath);
  const pair = await ensureHostCertificate(SYSTEM_RUNNER, folder, "api.example.com");
  expect(pair.cert).toContain("BEGIN CERTIFICATE");
  await expect(ensureHostCertificate(SYSTEM_RUNNER, folder, "api.example.com")).resolves.toEqual(pair);
  const failing = createFakeRunner({ openssl: { code: 1, stderr: "broken\n" } });
  await expect(ensureCertificateAuthority(failing, join(folder, "other"))).rejects.toThrow("openssl failed (1): broken");
}

/** Checks that the image is built only when missing, and that a failed build is reported. */
async function buildsTheImageOnlyWhenMissing(): Promise<void> {
  const folder = makeTemporaryFolder("image");
  const caPath = join(folder, "ca.crt");
  writeFileSync(caPath, "CA");
  const build = { folder: join(folder, "build"), caPath, agentPackages: AGENT_PACKAGES, user: { uid: 1001, gid: 121 } };
  const present = createFakeRunner();
  await expect(ensureAgentImage(present, "docker", build)).resolves.toMatch(/^closedbox-agent:[0-9a-f]{12}$/u);
  expect(present.calls).toHaveLength(1);
  const missing = createFakeRunner({ "image inspect": { code: 1 } });
  await ensureAgentImage(missing, "podman", build);
  expect(missing.calls[1]?.argumentsList.slice(0, 2)).toEqual(["build", "-t"]);
  expect(readFileSync(join(folder, "build", "Dockerfile"), "utf8")).toContain("update-ca-certificates");
  const broken = createFakeRunner({ "image inspect": { code: 1 }, build: { code: 4 } });
  await expect(ensureAgentImage(broken, "docker", build)).rejects.toThrow("exit code 4");
}

/** Checks the Dockerfile with and without agents, and that the tag follows the CA. */
function writesTheDockerfile(): void {
  const user = { uid: 501, gid: 20 };
  expect(writeDockerfile(AGENT_PACKAGES, user)).toContain("npm install -g @anthropic-ai/claude-code @openai/codex");
  expect(writeDockerfile(AGENT_PACKAGES, user)).toContain("usermod -o -u 501 -g 20 node");
  expect(writeDockerfile("", user)).not.toContain("npm install");
  expect(writeDockerfile("", user)).toMatch(/FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}/u);
  expect(imageTag("a", "ca1")).not.toBe(imageTag("a", "ca2"));
}

/** Checks the real runner: output, exit code, missing program, environment, interactive and streams. */
async function runsRealPrograms(): Promise<void> {
  await expect(SYSTEM_RUNNER.run("node", ["-e", "process.stdout.write('out');process.stderr.write('err');process.exit(3)"])).resolves.toEqual({ code: 3, stdout: "out", stderr: "err" });
  await expect(SYSTEM_RUNNER.run("node", ["-e", "process.stdout.write(process.env.X)"], { ...process.env, X: "y" })).resolves.toMatchObject({ stdout: "y" });
  await expect(SYSTEM_RUNNER.run("closedbox-missing-program", [])).resolves.toMatchObject({ code: 127 });
  await expect(SYSTEM_RUNNER.interactive("node", ["-e", "process.exit(5)"], process.env)).resolves.toBe(5);
  await expect(SYSTEM_RUNNER.run("node", ["-e", "process.kill(process.pid,'SIGKILL')"])).resolves.toMatchObject({ code: 1 });
  const lines = await readStreamLines();
  expect(lines).toEqual(["echo:a"]);
  const missing = await readMissingStream();
  expect(missing).toEqual([""]);
}

/** Starts a stream that echoes its input, sends one line, then stops it. */
function readStreamLines(): Promise<string[]> {
  return new Promise(collectEcho);
}

/** Collects the echo of one line, then stops the stream and sends a line that is ignored. */
function collectEcho(resolve: (lines: string[]) => void): void {
  const lines: string[] = [];
  const stream = SYSTEM_RUNNER.stream("node", ["-e", "process.stdin.on('data',d=>process.stdout.write('echo:'+d))"], receiveLine);
  stream.send("a");
  /** Keeps one line, stops the stream and resolves. */
  function receiveLine(text: string): void {
    lines.push(text);
    stream.stop();
    setTimeout(finish, 100);
  }
  /** Sends a line after the stop, which must be ignored, then resolves. */
  function finish(): void {
    stream.send("ignored");
    resolve(lines);
  }
}

/** Starts a stream of a missing program and collects what it reports. */
function readMissingStream(): Promise<string[]> {
  return new Promise(collectMissing);
}

/** Collects the empty line reported when the program does not exist. */
function collectMissing(resolve: (lines: string[]) => void): void {
  const lines: string[] = [];
  SYSTEM_RUNNER.stream("closedbox-missing-program", [], keepAndResolve);
  /** Keeps the line and resolves once. */
  function keepAndResolve(text: string): void {
    lines.push(text);
    resolve(lines.slice(0, 1));
  }
}

describe("small modules", describeSmallModules);

/** Groups the tests of the small modules. */
function describeSmallModules(): void {
  it("trusts only the approved text", trustsOnlyTheApprovedText);
  it("scans the project with wormsign", scansTheProjectWithWormsign);
  it("makes real certificates once", makesRealCertificatesOnce);
  it("builds the image only when missing", buildsTheImageOnlyWhenMissing);
  it("writes the Dockerfile", writesTheDockerfile);
  it("runs real programs", runsRealPrograms);
}
