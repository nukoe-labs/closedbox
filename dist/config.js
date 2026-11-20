import { parseAllowRule } from "./hosts.js";
import { GITHUB_HOSTS, REGISTRY_HOSTS } from "./profiles.js";
import { parseToml } from "./toml.js";
/** The name of the configuration file read at the root of the project. */
export const CONFIG_FILE = "stillsuit.toml";
/** The files hidden from the agent by default, even inside the project folder. */
export const DEFAULT_MASKS = [".env", ".env.*", "*.pem", "*.key", "id_rsa*", "id_ed25519*", ".npmrc", ".pypirc", ".netrc", ".aws", ".ssh", ".docker", ".kube"];
/** The settings used when the project has no stillsuit.toml. */
export const DEFAULT_FILE_CONFIG = { allow: [], github: false, mask: [], scan: true, memory: "4g", secrets: {} };
/** Returns the table at a name, or an empty table when the file does not have it. */
function readTable(table, name) {
    const value = table[name];
    if (value === undefined) {
        return {};
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new RangeError(`${CONFIG_FILE}: [${name}] must be a table.`);
    }
    return value;
}
/** Reads a list of texts, or returns the default when the key is missing. */
function readTextList(table, key, fallback) {
    const value = table[key];
    if (value === undefined) {
        return fallback;
    }
    const isTextList = Array.isArray(value) && value.every(isText);
    if (!isTextList) {
        throw new RangeError(`${CONFIG_FILE}: ${key} must be a list of quoted texts.`);
    }
    return value;
}
/** Tells whether a TOML value is a text. */
function isText(value) {
    return typeof value === "string";
}
/** Reads a value of an expected type, or returns the default when the key is missing. */
function readScalar(table, key, fallback) {
    const value = table[key];
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== typeof fallback) {
        throw new RangeError(`${CONFIG_FILE}: ${key} must be a ${typeof fallback}.`);
    }
    return value;
}
/** Reads one [secrets.NAME] table into a secret rule. */
function readSecretRule(name, value) {
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new RangeError(`${CONFIG_FILE}: [secrets.${name}] must be a table.`);
    }
    const host = readScalar(value, "host", "");
    if (host === "") {
        throw new RangeError(`${CONFIG_FILE}: [secrets.${name}] needs a host.`);
    }
    const header = readScalar(value, "header", "authorization").toLowerCase();
    const template = readScalar(value, "template", "Bearer {value}");
    return { host: parseAllowRule(host).host, header, template };
}
/** Reads every [secrets.NAME] table. */
function readSecrets(table) {
    const secrets = {};
    for (const [name, value] of Object.entries(table)) {
        secrets[name] = readSecretRule(name, value);
    }
    return secrets;
}
/** Reads the text of stillsuit.toml into a checked configuration. */
export function readFileConfig(text) {
    const root = parseToml(text);
    const network = readTable(root, "network");
    const files = readTable(root, "files");
    const scan = readTable(root, "scan");
    const container = readTable(root, "container");
    return {
        allow: readTextList(network, "allow", DEFAULT_FILE_CONFIG.allow),
        github: readScalar(network, "github", DEFAULT_FILE_CONFIG.github),
        mask: readTextList(files, "mask", DEFAULT_FILE_CONFIG.mask),
        scan: readScalar(scan, "wormsign", DEFAULT_FILE_CONFIG.scan),
        memory: readScalar(container, "memory", DEFAULT_FILE_CONFIG.memory),
        secrets: readSecrets(readTable(root, "secrets")),
    };
}
/** Keeps the secret rules whose environment variable is set on the computer. */
function keepPresentSecrets(rules, environment) {
    const present = {};
    for (const [name, rule] of Object.entries(rules)) {
        const value = environment[name];
        if (value !== undefined && value !== "") {
            present[name] = rule;
        }
    }
    return present;
}
/** Lists the hosts allowed for a session, without duplicates, in a stable order. */
export function listAllowedHosts(profile, config, extraHosts) {
    const githubHosts = config.github ? GITHUB_HOSTS : [];
    const allHosts = [...profile.allow, ...REGISTRY_HOSTS, ...githubHosts, ...config.allow, ...extraHosts];
    return [...new Set(allHosts)];
}
/** Builds the settings of one session. */
export function resolveSettings(profile, config, extraHosts, environment) {
    const hosts = listAllowedHosts(profile, config, extraHosts);
    const secretRules = { ...config.secrets, ...profile.secrets };
    return {
        allowRules: hosts.map(parseAllowRule),
        secrets: keepPresentSecrets(secretRules, environment),
        masks: [...new Set([...DEFAULT_MASKS, ...config.mask])],
        scan: config.scan,
        memory: config.memory,
    };
}
/** Writes a list of texts as a TOML list, one item per line. */
function writeTomlList(items) {
    const lines = items.map(quoteTomlItem);
    return `[\n${lines.join("\n")}\n]`;
}
/** Writes one list item as a quoted TOML text followed by a comma. */
function quoteTomlItem(item) {
    return `  ${JSON.stringify(item)},`;
}
/** Writes a commented stillsuit.toml that allows the given hosts on top of the agent profile. */
export function writeConfigText(extraHosts, header) {
    return `# ${header}
# Reference: https://github.com/nukoe-labs/stillsuit#configuration

[network]
# Hosts allowed on top of the agent profile and the package registries.
allow = ${writeTomlList(extraHosts)}
# Set to true to allow git clone, git fetch and downloads from GitHub.
github = false

[files]
# Files and folders of the project hidden from the agent, on top of .env, keys and cloud credentials.
mask = []

[scan]
# Scan the project with wormsign before starting the agent.
wormsign = true
`;
}
