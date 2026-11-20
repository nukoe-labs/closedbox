import { createProxyServer } from "./proxy.js";
/** Reads the values of the secrets named in the policy from the environment of the proxy container. */
export function readSecretValues(policy, environment) {
    const values = {};
    for (const name of Object.keys(policy.secrets)) {
        values[name] = environment[name] ?? "";
    }
    return values;
}
/** Writes one journal event as a JSON line on the standard output, read by the closedbox command. */
function writeEvent(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
}
/** Writes the line that tells the closedbox command that the proxy listens. */
function announceReady() {
    process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
}
/** The port of the real hosts that receive a secret. */
const HTTPS_PORT = 443;
/** Starts the proxy inside its container, on the given port, and returns the server. */
export function main(environment, port) {
    const configuration = JSON.parse(environment.CLOSEDBOX_PROXY_CONFIG);
    const secretValues = readSecretValues(configuration.policy, environment);
    const options = { policy: configuration.policy, secretValues, certificates: configuration.certificates, emit: writeEvent, upstreamCa: undefined, secretHostPort: HTTPS_PORT };
    return createProxyServer(options).listen(port, "0.0.0.0", announceReady);
}
