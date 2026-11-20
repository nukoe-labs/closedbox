import type { Server } from "node:http";
import { createProxyServer, type CertificatePair, type ProxyPolicy } from "./proxy.js";
import type { ProxyEvent } from "./events.js";

/** The configuration given to the proxy container in the STILLSUIT_PROXY_CONFIG variable. */
export interface ProxyConfiguration {
  policy: ProxyPolicy;
  certificates: Record<string, CertificatePair>;
}

/** Reads the values of the secrets named in the policy from the environment of the proxy container. */
export function readSecretValues(policy: ProxyPolicy, environment: NodeJS.ProcessEnv): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of Object.keys(policy.secrets)) {
    values[name] = environment[name] ?? "";
  }
  return values;
}

/** Writes one journal event as a JSON line on the standard output, read by the stillsuit command. */
function writeEvent(event: ProxyEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Writes the line that tells the stillsuit command that the proxy listens. */
function announceReady(): void {
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
}

/** The port of the real hosts that receive a secret. */
const HTTPS_PORT = 443;

/** Starts the proxy inside its container, on the given port, and returns the server. */
export function main(environment: NodeJS.ProcessEnv, port: number): Server {
  const configuration = JSON.parse(environment.STILLSUIT_PROXY_CONFIG as string) as ProxyConfiguration;
  const secretValues = readSecretValues(configuration.policy, environment);
  const options = { policy: configuration.policy, secretValues, certificates: configuration.certificates, emit: writeEvent, upstreamCa: undefined, secretHostPort: HTTPS_PORT };
  return createProxyServer(options).listen(port, "0.0.0.0", announceReady);
}
