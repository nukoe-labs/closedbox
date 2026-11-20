import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureCertificateAuthority, ensureHostCertificate } from "./certs.js";
import { CONFIG_FILE, DEFAULT_FILE_CONFIG, readFileConfig, resolveSettings, writeConfigText } from "./config.js";
import { createJournal, listAuditHosts, listBlockedHosts } from "./journal.js";
import { AGENT_PACKAGES, ensureAgentImage, PROXY_IMAGE } from "./images.js";
import { findMaskedPaths } from "./masks.js";
import { getProfile } from "./profiles.js";
import { buildAgentArguments, buildAgentEnvironment, buildConnectArguments, buildNetworkArguments, buildProxyArguments, detectRuntime, PACKAGE_MOUNT, sessionNames } from "./runtime.js";
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
/** Reads closedbox.toml of the project, and refuses a file that the person has not approved. */
export function loadProjectConfig(context, projectFolder) {
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
export function makePlaceholder(value) {
    const prefix = /^(?:sk-ant-oat01-|sk-ant-api03-|sk-proj-|sk-|ghp_|github_pat_)/u.exec(value)?.[0] ?? "";
    return `${prefix}closedbox-placeholder-the-proxy-adds-the-real-key`;
}
/** Builds the placeholders of the secrets found on the computer; each of them is set, since only those are kept. */
function buildPlaceholders(settings, environment) {
    const placeholders = {};
    for (const name of Object.keys(settings.secrets)) {
        placeholders[name] = makePlaceholder(environment[name]);
    }
    return placeholders;
}
/** Creates the certificates of the hosts that receive a secret. */
async function prepareCertificates(context, settings, caFolder) {
    const certificates = {};
    for (const rule of Object.values(settings.secrets)) {
        certificates[rule.host] ??= await ensureHostCertificate(context.runner, caFolder, rule.host);
    }
    return certificates;
}
/** Names the home volume after the agent and the project, so that two projects never share a home folder. */
export function homeVolumeName(agent, projectFolder) {
    const digest = createHash("sha256").update(projectFolder).digest("hex").slice(0, 10);
    return `closedbox-home-${agent}-${digest}`;
}
/** Scans the project with wormsign and tells whether the start must stop. */
async function scanBeforeStart(context, options, settings) {
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
/** Prepares everything a session needs: settings, scan, engine, certificates, image and plan. */
async function preparePlan(context, options) {
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
export function chooseCommand(profileCommand, argumentsList) {
    if (profileCommand !== "") {
        return { command: profileCommand, argumentsList };
    }
    const [command = "bash", ...rest] = argumentsList;
    return { command, argumentsList: rest };
}
/** Writes the plan of a session from its settings and its image. */
function buildPlan(context, options, settings, agentImage) {
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
export function buildProxyConfiguration(plan, mode, certificates) {
    const policy = { mode, allow: plan.settings.allowRules, secrets: plan.settings.secrets, denyDelayMs: DENY_DELAY_MS, allowPrivate: false };
    const configuration = { policy, certificates };
    return JSON.stringify(configuration);
}
/** Runs one engine command and throws an error with its message when it fails. */
async function runOrThrow(context, runtime, argumentsList, environment) {
    const result = await context.runner.run(runtime, argumentsList, environment);
    if (result.code !== 0) {
        throw new Error(`${runtime} ${argumentsList.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`);
    }
}
/** Waits until the proxy writes that it listens, or fails after the timeout. */
function waitForProxy(watch) {
    return new Promise(followProxyLogs.bind(undefined, watch));
}
/** Follows the proxy output, resolves when it is ready and rejects after the timeout. */
function followProxyLogs(watch, resolve, reject) {
    const timer = setTimeout(reject, PROXY_START_TIMEOUT_MS, new Error("The proxy did not start in time."));
    const state = {};
    /** Reads one proxy line and resolves the wait on the ready line. */
    function readLine(line) {
        if (watch.journal.readProxyLine(line) && state.stream !== undefined) {
            clearTimeout(timer);
            resolve(state.stream);
        }
    }
    state.stream = watch.context.runner.stream(watch.runtime, ["logs", "-f", sessionNames(watch.plan.id).proxy], readLine);
}
/** Starts the helper that names the process behind a connection, inside the agent container. */
function startWhois(watch, onAnswer) {
    const agent = sessionNames(watch.plan.id).agent;
    return watch.context.runner.stream(watch.runtime, ["exec", "-i", "-u", `${watch.plan.user.uid}`, agent, "node", `${PACKAGE_MOUNT}/bin/whois.js`], onAnswer);
}
/** Creates the network and the proxy, and waits until the proxy listens. */
async function startProxy(watch, mode, certificates) {
    const { context, runtime, plan } = watch;
    await runOrThrow(context, runtime, buildNetworkArguments(plan));
    const proxyEnvironment = { ...context.environment, CLOSEDBOX_PROXY_CONFIG: buildProxyConfiguration(plan, mode, certificates) };
    await runOrThrow(context, runtime, buildProxyArguments(plan), proxyEnvironment);
    await runOrThrow(context, runtime, buildConnectArguments(plan));
    return waitForProxy(watch);
}
/** Removes the proxy and the network of a session, even when the start failed half way. */
async function cleanUp(context, runtime, plan) {
    const names = sessionNames(plan.id);
    await context.runner.run(runtime, ["rm", "-f", names.agent, names.proxy]);
    await context.runner.run(runtime, ["network", "rm", names.network]);
}
/** Writes the line shown before the agent starts. */
function writeBanner(context, options, plan, logPath) {
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
function writeSummary(context, options, journal) {
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
function writeLiveLine(context, line) {
    context.write(`${line}\r`);
}
/** Creates the journal of a session, written to a file and, when asked, on the terminal. */
function openJournal(context, options, watch, logPath) {
    const showLive = options.liveJournal || !context.isTerminal;
    const live = showLive ? writeLiveLine.bind(undefined, context) : undefined;
    const fullWatch = { ...watch };
    const journal = createJournal({ logPath, live, useColor: context.useColor, startWhois: startWhois.bind(undefined, fullWatch) });
    fullWatch.journal = journal;
    return journal;
}
/** Starts the agent in its sandbox, waits until it ends, cleans up and returns its exit code. */
export async function launch(context, options) {
    const prepared = await preparePlan(context, options);
    if (prepared === undefined) {
        return EXIT_WORM_FOUND;
    }
    const { plan, runtime, certificates } = prepared;
    const logPath = prepareLogPath(context, plan.id);
    const journal = openJournal(context, options, { context, runtime, plan }, logPath);
    writeBanner(context, options, plan, logPath);
    let logs;
    try {
        logs = await startProxy({ context, runtime, plan, journal }, options.mode, certificates);
        const agentEnvironment = { ...context.environment, ...buildAgentEnvironment(plan) };
        return await context.runner.interactive(runtime, buildAgentArguments(plan), agentEnvironment);
    }
    finally {
        logs?.stop();
        journal.stop();
        await cleanUp(context, runtime, plan);
        writeSummary(context, options, journal);
    }
}
/** Creates the journal folder and points the "latest" file at the journal of this session. */
function prepareLogPath(context, id) {
    const folder = join(context.paths.state, "sessions");
    mkdirSync(folder, { recursive: true });
    const logPath = join(folder, `${id}.log`);
    writeFileSync(logPath, "");
    writeFileSync(join(context.paths.state, "latest"), logPath);
    return logPath;
}
