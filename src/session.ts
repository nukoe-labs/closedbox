import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureCertificateAuthority, ensureHostCertificate } from "./certs.js";
import { CONFIG_FILE, DEFAULT_FILE_CONFIG, readFileConfig, resolveSettings, writeConfigText, type FileConfig, type SessionSettings } from "./config.js";
import { createJournal, listAuditHosts, listBlockedHosts, type Journal } from "./journal.js";
import { AGENT_PACKAGES, ensureAgentImage, PROXY_IMAGE } from "./images.js";
import { findMaskedPaths } from "./masks.js";
import { getProfile } from "./profiles.js";
import type { CertificatePair, ProxyMode, ProxyPolicy } from "./proxy.js";
import type { ProxyConfiguration } from "./proxy-main.js";
import type { LineStream, Runner } from "./runner.js";
import { buildAgentArguments, buildAgentEnvironment, buildConnectArguments, buildNetworkArguments, buildProxyArguments, detectRuntime, PACKAGE_MOUNT, sessionNames, type HostUser, type RuntimeName, type SessionPlan } from "./runtime.js";
import { scanProject } from "./scan.js";
import { isTrusted } from "./trust.js";

/** The exit code when wormsign found a worm sign and the agent was not started. */
export const EXIT_WORM_FOUND = 3;
/** The exit code when the session could not start. */
export const EXIT_SETUP_FAILED = 2;
/** How long a refused connection is held open, so that the journal can name the process. */
export const DENY_DELAY_MS = 1500;
/** How long closedbox waits for the proxy to listen. */
export const PROXY_START_TIMEOUT_MS = 20_000;

/** The folders closedbox uses on the computer. */
export interface Paths {
  config: string;
  state: string;
  cache: string;
  /** The compiled closedbox folder, mounted read only in the containers. */
  packageFolder: string;
}

/** Everything a session needs from the outside world, replaceable in tests. */
export interface Context {
  runner: Runner;
  environment: NodeJS.ProcessEnv;
  paths: Paths;
  write: (text: string) => void;
  useColor: boolean;
  isTerminal: boolean;
  /** The user of the person on the computer. */
  user: HostUser;
}

/** What the person asked for on the command line. */
export interface LaunchOptions {
  agent: string;
  argumentsList: string[];
  projectFolder: string;
  mode: ProxyMode;
  extraHosts: string[];
  scan: boolean;
  runtime: string;
  /** Shows the journal live on the terminal even when the agent uses it. */
  liveJournal: boolean;
}

/** Reads closedbox.toml of the project, and refuses a file that the person has not approved. */
export function loadProjectConfig(context: Context, projectFolder: string): FileConfig {
  const configPath = join(projectFolder, CONFIG_FILE);
  if (!existsSync(configPath)) {
    return DEFAULT_FILE_CONFIG;
  }
  const text = readFileSync(configPath, "utf8");
  const config = readFileConfig(text);
  if (!isTrusted(join(context.paths.config, "trusted.json"), projectFolder, text)) {
    throw new Error(`${CONFIG_FILE} is new or changed. A repository can ship one to widen the allowlist.\nRead it, then approve it with: closedbox trust`);
  }
  return config;
}

/** Builds the placeholder given to the agent in place of a secret: the public prefix of the key, then a fixed text. */
export function makePlaceholder(value: string): string {
  const prefix = /^(?:sk-ant-oat01-|sk-ant-api03-|sk-proj-|sk-|ghp_|github_pat_)/u.exec(value)?.[0] ?? "";
  return `${prefix}closedbox-placeholder-the-proxy-adds-the-real-key`;
}

/** Builds the placeholders of the secrets found on the computer; each of them is set, since only those are kept. */
function buildPlaceholders(settings: SessionSettings, environment: NodeJS.ProcessEnv): Record<string, string> {
  const placeholders: Record<string, string> = {};
  for (const name of Object.keys(settings.secrets)) {
    placeholders[name] = makePlaceholder(environment[name] as string);
  }
  return placeholders;
}

/** Creates the certificates of the hosts that receive a secret. */
async function prepareCertificates(context: Context, settings: SessionSettings, caFolder: string): Promise<Record<string, CertificatePair>> {
  const certificates: Record<string, CertificatePair> = {};
  for (const rule of Object.values(settings.secrets)) {
    certificates[rule.host] ??= await ensureHostCertificate(context.runner, caFolder, rule.host);
  }
  return certificates;
}

/** Names the home volume after the agent and the project, so that two projects never share a home folder. */
export function homeVolumeName(agent: string, projectFolder: string): string {
  const digest = createHash("sha256").update(projectFolder).digest("hex").slice(0, 10);
  return `closedbox-home-${agent}-${digest}`;
}

/** Scans the project with wormsign and tells whether the start must stop. */
async function scanBeforeStart(context: Context, options: LaunchOptions, settings: SessionSettings): Promise<boolean> {
  if (!options.scan || !settings.scan) {
    return false;
  }
  const outcome = await scanProject(options.projectFolder, context.useColor);
  if (outcome.report !== "") {
    context.write(outcome.report);
  }
  if (outcome.blocked) {
    context.write("closedbox: the assistant was not started, because the files above would run on their own.");
    context.write("Delete them, or start with --no-scan if you know why they are there.");
  }
  return outcome.blocked;
}

/** The parts of a session prepared before anything starts. */
interface Prepared {
  plan: SessionPlan;
  runtime: RuntimeName;
  certificates: Record<string, CertificatePair>;
}

/** Prepares everything a session needs: settings, scan, engine, certificates, image and plan. */
async function preparePlan(context: Context, options: LaunchOptions): Promise<Prepared | undefined> {
  const profile = getProfile(options.agent);
  const settings = resolveSettings(profile, loadProjectConfig(context, options.projectFolder), options.extraHosts, context.environment);
  if (await scanBeforeStart(context, options, settings)) {
    return undefined;
  }
  const runtime = await detectRuntime(context.runner, options.runtime);
  const caFolder = join(context.paths.config, "ca");
  const caPath = await ensureCertificateAuthority(context.runner, caFolder);
  const certificates = await prepareCertificates(context, settings, caFolder);
  const build = { folder: join(context.paths.cache, "build"), caPath, agentPackages: AGENT_PACKAGES, user: context.user };
  const agentImage = await ensureAgentImage(context.runner, runtime, build);
  const plan = buildPlan(context, options, settings, agentImage);
  return { plan, runtime, certificates };
}

/** Chooses the command and its arguments: the profile command, or for the shell profile the first word of the person. */
export function chooseCommand(profileCommand: string, argumentsList: string[]): { command: string; argumentsList: string[] } {
  if (profileCommand !== "") {
    return { command: profileCommand, argumentsList };
  }
  const [command = "bash", ...rest] = argumentsList;
  return { command, argumentsList: rest };
}

/** Writes the plan of a session from its settings and its image. */
function buildPlan(context: Context, options: LaunchOptions, settings: SessionSettings, agentImage: string): SessionPlan {
  const profile = getProfile(options.agent);
  return {
    id: randomBytes(4).toString("hex"),
    projectFolder: options.projectFolder,
    packageFolder: context.paths.packageFolder,
    agentImage,
    proxyImage: PROXY_IMAGE,
    ...chooseCommand(profile.command, [...profile.arguments, ...options.argumentsList]),
    settings,
    masks: findMaskedPaths(options.projectFolder, settings.masks),
    placeholders: buildPlaceholders(settings, context.environment),
    useTerminal: context.isTerminal,
    homeVolume: homeVolumeName(options.agent, options.projectFolder),
    user: context.user,
  };
}

/** Builds the JSON configuration of the proxy container. */
export function buildProxyConfiguration(plan: SessionPlan, mode: ProxyMode, certificates: Record<string, CertificatePair>): string {
  const policy: ProxyPolicy = { mode, allow: plan.settings.allowRules, secrets: plan.settings.secrets, denyDelayMs: DENY_DELAY_MS, allowPrivate: false };
  const configuration: ProxyConfiguration = { policy, certificates };
  return JSON.stringify(configuration);
}

/** Runs one engine command and throws an error with its message when it fails. */
async function runOrThrow(context: Context, runtime: RuntimeName, argumentsList: string[], environment?: NodeJS.ProcessEnv): Promise<void> {
  const result = await context.runner.run(runtime, argumentsList, environment);
  if (result.code !== 0) {
    throw new Error(`${runtime} ${argumentsList.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`);
  }
}

/** What is needed to follow the proxy output. */
interface ProxyWatch {
  context: Context;
  runtime: RuntimeName;
  plan: SessionPlan;
  journal: Journal;
}

/** Waits until the proxy writes that it listens, or fails after the timeout. */
function waitForProxy(watch: ProxyWatch): Promise<LineStream> {
  return new Promise(followProxyLogs.bind(undefined, watch));
}

/** Follows the proxy output, resolves when it is ready and rejects after the timeout. */
function followProxyLogs(watch: ProxyWatch, resolve: (stream: LineStream) => void, reject: (error: Error) => void): void {
  const timer = setTimeout(reject, PROXY_START_TIMEOUT_MS, new Error("The proxy did not start in time."));
  const state: { stream?: LineStream } = {};
  /** Reads one proxy line and resolves the wait on the ready line. */
  function readLine(line: string): void {
    if (watch.journal.readProxyLine(line) && state.stream !== undefined) {
      clearTimeout(timer);
      resolve(state.stream);
    }
  }
  state.stream = watch.context.runner.stream(watch.runtime, ["logs", "-f", sessionNames(watch.plan.id).proxy], readLine);
}

/** Starts the helper that names the process behind a connection, inside the agent container. */
function startWhois(watch: ProxyWatch, onAnswer: (line: string) => void): LineStream {
  const agent = sessionNames(watch.plan.id).agent;
  return watch.context.runner.stream(watch.runtime, ["exec", "-i", "-u", `${watch.plan.user.uid}`, agent, "node", `${PACKAGE_MOUNT}/bin/whois.js`], onAnswer);
}

/** Creates the network and the proxy, and waits until the proxy listens. */
async function startProxy(watch: ProxyWatch, mode: ProxyMode, certificates: Record<string, CertificatePair>): Promise<LineStream> {
  const { context, runtime, plan } = watch;
  await runOrThrow(context, runtime, buildNetworkArguments(plan));
  const proxyEnvironment = { ...context.environment, CLOSEDBOX_PROXY_CONFIG: buildProxyConfiguration(plan, mode, certificates) };
  await runOrThrow(context, runtime, buildProxyArguments(plan), proxyEnvironment);
  await runOrThrow(context, runtime, buildConnectArguments(plan));
  return waitForProxy(watch);
}

/** Removes the proxy and the network of a session, even when the start failed half way. */
async function cleanUp(context: Context, runtime: RuntimeName, plan: SessionPlan): Promise<void> {
  const names = sessionNames(plan.id);
  await context.runner.run(runtime, ["rm", "-f", names.agent, names.proxy]);
  await context.runner.run(runtime, ["network", "rm", names.network]);
}

/** Writes the line shown before the agent starts. */
function writeBanner(context: Context, options: LaunchOptions, plan: SessionPlan, logPath: string): void {
  const secretCount = Object.keys(plan.settings.secrets).length;
  const websites = options.mode === "audit"
    ? "all allowed for this run, and written down (audit)"
    : `only the ${plan.settings.allowRules.length} approved ones`;
  context.write(`closedbox: starting ${options.agent} in ${options.projectFolder}`);
  context.write(`  files:     this folder only, without ${plan.masks.length} secret files (.env, keys…)`);
  context.write(`  websites:  ${websites}`);
  context.write(`  API keys:  ${secretCount} kept outside the box`);
  context.write(`  log:       ${logPath.replace(homedir(), "~")}  (follow it live with: closedbox watch)`);
}

/** Writes the summary at the end of the session, and the audit allowlist when in audit mode. */
function writeSummary(context: Context, options: LaunchOptions, journal: Journal): void {
  const blockedHosts = listBlockedHosts(journal.events);
  if (blockedHosts.length > 0) {
    context.write(`closedbox: blocked ${blockedHosts.length} website(s): ${blockedHosts.join(", ")}`);
    context.write(`If your project really needs one of them, allow it with: closedbox ${options.agent} --allow <website>`);
  }
  if (options.mode !== "audit") {
    return;
  }
  const auditPath = join(options.projectFolder, "closedbox.audit.toml");
  const header = "Hosts seen in audit mode. Read each one, remove what you do not trust, then rename this file closedbox.toml.";
  writeFileSync(auditPath, writeConfigText(listAuditHosts(journal.events), header));
  context.write(`closedbox: the websites used are listed in ${auditPath}`);
  context.write("Read the list, remove what you do not trust, then rename the file closedbox.toml.");
}

/**
 * Writes one live journal line. The final carriage return brings the cursor back to the first column, because the
 * terminal of an agent started with -t is in raw mode, where a new line alone does not.
 */
function writeLiveLine(context: Context, line: string): void {
  context.write(`${line}\r`);
}

/** Creates the journal of a session, written to a file and, when asked, on the terminal. */
function openJournal(context: Context, options: LaunchOptions, watch: Omit<ProxyWatch, "journal">, logPath: string): Journal {
  const showLive = options.liveJournal || !context.isTerminal;
  const live = showLive ? writeLiveLine.bind(undefined, context) : undefined;
  const fullWatch: { journal?: Journal } & Omit<ProxyWatch, "journal"> = { ...watch };
  const journal = createJournal({ logPath, live, useColor: context.useColor, startWhois: startWhois.bind(undefined, fullWatch as ProxyWatch) });
  fullWatch.journal = journal;
  return journal;
}

/** Starts the agent in its sandbox, waits until it ends, cleans up and returns its exit code. */
export async function launch(context: Context, options: LaunchOptions): Promise<number> {
  const prepared = await preparePlan(context, options);
  if (prepared === undefined) {
    return EXIT_WORM_FOUND;
  }
  const { plan, runtime, certificates } = prepared;
  const logPath = prepareLogPath(context, plan.id);
  const journal = openJournal(context, options, { context, runtime, plan }, logPath);
  writeBanner(context, options, plan, logPath);
  let logs: LineStream | undefined;
  try {
    logs = await startProxy({ context, runtime, plan, journal }, options.mode, certificates);
    const agentEnvironment = { ...context.environment, ...buildAgentEnvironment(plan) };
    return await context.runner.interactive(runtime, buildAgentArguments(plan), agentEnvironment);
  } finally {
    logs?.stop();
    journal.stop();
    await cleanUp(context, runtime, plan);
    writeSummary(context, options, journal);
  }
}

/** Creates the journal folder and points the "latest" file at the journal of this session. */
function prepareLogPath(context: Context, id: string): string {
  const folder = join(context.paths.state, "sessions");
  mkdirSync(folder, { recursive: true });
  const logPath = join(folder, `${id}.log`);
  writeFileSync(logPath, "");
  writeFileSync(join(context.paths.state, "latest"), logPath);
  return logPath;
}
