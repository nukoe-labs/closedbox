import type { SessionSettings } from "./config.js";
import type { MaskedPath } from "./masks.js";
import type { Runner } from "./runner.js";

/** The container engines stillsuit can drive. */
export type RuntimeName = "docker" | "podman";

/** The address of the proxy as seen from the agent container. */
export const PROXY_ALIAS = "stillsuit-proxy";
export const PROXY_PORT = 3128;
/** The project folder inside the container. */
export const WORKSPACE = "/workspace";
/** Where the compiled stillsuit files are mounted, read only, in both containers. */
export const PACKAGE_MOUNT = "/opt/stillsuit";
/** The CA file path inside the agent image. */
export const CA_IN_IMAGE = "/usr/local/share/ca-certificates/stillsuit.crt";
/** An address reserved for documentation (RFC 5737): DNS queries sent there go nowhere. */
export const BLACKHOLE_DNS = "192.0.2.1";
/** The user of the proxy container, which reads no file of the person. */
const PROXY_USER = "1000:1000";

/** Finds a container engine: the one asked for, or Docker then Podman. Apple container has no internal network yet. */
export async function detectRuntime(runner: Runner, wanted: string): Promise<RuntimeName> {
  const candidates: RuntimeName[] = wanted === "podman" || wanted === "docker" ? [wanted] : ["docker", "podman"];
  for (const candidate of candidates) {
    const result = await runner.run(candidate, ["info", "--format", "{{.ServerVersion}}"]);
    if (result.code === 0) {
      return candidate;
    }
  }
  throw new Error("No running container engine found. Start Docker (or OrbStack, Colima, Rancher Desktop) or Podman, then try again.");
}

/** A user and group number on the computer. */
export interface HostUser {
  uid: number;
  gid: number;
}

/** The names and settings of one session. */
export interface SessionPlan {
  id: string;
  projectFolder: string;
  /** The compiled stillsuit folder on the computer. */
  packageFolder: string;
  agentImage: string;
  proxyImage: string;
  command: string;
  argumentsList: string[];
  settings: SessionSettings;
  masks: MaskedPath[];
  /** The environment variables given to the agent with a placeholder value, by name. */
  placeholders: Record<string, string>;
  useTerminal: boolean;
  /** The user of the person on the computer, so that the agent can read and write the project files. */
  user: HostUser;
  /** The volume kept as the home folder of the agent, one per agent and per project, so that projects never share it. */
  homeVolume: string;
}

/** Returns the names of the network and containers of a session. */
export function sessionNames(id: string): { network: string; proxy: string; agent: string } {
  return { network: `stillsuit-net-${id}`, proxy: `stillsuit-proxy-${id}`, agent: `stillsuit-agent-${id}` };
}

/** The options that take every privilege away from a container. */
const HARDENING = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges"];

/** Builds the arguments that create the internal network: containers on it have no route out. */
export function buildNetworkArguments(plan: SessionPlan): string[] {
  return ["network", "create", "--internal", "--label", `stillsuit.session=${plan.id}`, sessionNames(plan.id).network];
}

/** Builds the arguments that start the proxy, the only container with a route to the Internet. */
export function buildProxyArguments(plan: SessionPlan): string[] {
  const names = sessionNames(plan.id);
  const secretArguments = Object.keys(plan.settings.secrets).flatMap(toEnvironmentArgument);
  const limits = ["--memory", "256m", "--pids-limit", "256", "--read-only", "--user", PROXY_USER];
  const mount = ["-v", `${plan.packageFolder}:${PACKAGE_MOUNT}:ro`];
  const labels = ["--label", `stillsuit.session=${plan.id}`];
  const environment = ["-e", "STILLSUIT_PROXY_CONFIG", ...secretArguments];
  return ["run", "-d", "--rm", "--name", names.proxy, ...labels, ...HARDENING, ...limits, ...mount, ...environment, plan.proxyImage, "node", `${PACKAGE_MOUNT}/bin/proxy.js`];
}

/** Builds "-e NAME": the value is read from the environment of the engine command, never written on its command line. */
function toEnvironmentArgument(name: string): string[] {
  return ["-e", name];
}

/** Builds the arguments that attach the proxy to the internal network under its alias. */
export function buildConnectArguments(plan: SessionPlan): string[] {
  const names = sessionNames(plan.id);
  return ["network", "connect", "--alias", PROXY_ALIAS, names.network, names.proxy];
}

/** Builds the mount that hides one masked path: an empty file over a file, an empty folder over a folder. */
function buildMaskArguments(masked: MaskedPath): string[] {
  const target = `${WORKSPACE}/${masked.path}`;
  if (masked.isFolder) {
    return ["--mount", `type=tmpfs,destination=${target},tmpfs-size=1m`];
  }
  return ["--mount", `type=bind,source=/dev/null,target=${target},readonly`];
}

/** Tells whether a masked path can be written in a --mount option, which splits on commas and quotes. */
export function isMountablePath(masked: MaskedPath): boolean {
  return !/[,"]/u.test(masked.path);
}

/** Lists the environment of the agent: the proxy address, the CA for every language, and the placeholders. */
export function buildAgentEnvironment(plan: SessionPlan): Record<string, string> {
  const proxyUrl = `http://${PROXY_ALIAS}:${PROXY_PORT}`;
  const caBundle = "/etc/ssl/certs/ca-certificates.crt";
  return {
    HTTPS_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    http_proxy: proxyUrl,
    NO_PROXY: "",
    no_proxy: "",
    NODE_EXTRA_CA_CERTS: CA_IN_IMAGE,
    SSL_CERT_FILE: caBundle,
    REQUESTS_CA_BUNDLE: caBundle,
    CODEX_CA_CERTIFICATE: caBundle,
    NODE_USE_ENV_PROXY: "1",
    NODE_OPTIONS: "--disable-warning=UNDICI-EHPA",
    STILLSUIT: "1",
    ...plan.placeholders,
  };
}

/** Builds the arguments that start the agent on the internal network, with the project folder as the only mount. */
export function buildAgentArguments(plan: SessionPlan): string[] {
  const names = sessionNames(plan.id);
  const terminal = plan.useTerminal ? ["-it"] : ["-i"];
  const network = ["--network", names.network, "--dns", BLACKHOLE_DNS, "--hostname", "stillsuit"];
  const limits = ["--memory", plan.settings.memory, "--pids-limit", "4096", "--user", `${plan.user.uid}:${plan.user.gid}`];
  const mounts = ["-v", `${plan.projectFolder}:${WORKSPACE}`, "-w", WORKSPACE, "-v", `${plan.homeVolume}:/home/node`, "-v", `${plan.packageFolder}:${PACKAGE_MOUNT}:ro`];
  const maskMounts = plan.masks.filter(isMountablePath).flatMap(buildMaskArguments);
  const environment = Object.keys(buildAgentEnvironment(plan)).flatMap(toEnvironmentArgument);
  const labels = ["--label", `stillsuit.session=${plan.id}`];
  const start = ["run", "--rm", ...terminal, "--name", names.agent, ...labels];
  return [...start, ...network, ...HARDENING, ...limits, ...mounts, ...maskMounts, ...environment, plan.agentImage, plan.command, ...plan.argumentsList];
}
