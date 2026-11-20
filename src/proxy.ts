import { lookup } from "node:dns/promises";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import type { ProxyAction, ProxyEvent } from "./events.js";
import { isAllowed, isPrivateAddress, normalizeHost, type AllowRule } from "./hosts.js";
import type { SecretRule } from "./profiles.js";

/** "enforce" blocks every host outside the allowlist; "audit" lets everything through and records it. */
export type ProxyMode = "enforce" | "audit";

/** The rules the proxy applies, sent to the proxy container as JSON. */
export interface ProxyPolicy {
  mode: ProxyMode;
  allow: AllowRule[];
  secrets: Record<string, SecretRule>;
  /** How long a refused connection is held open, so that the process that opened it can be found. */
  denyDelayMs: number;
  /** Lets the proxy reach local addresses; only the tests turn it on. */
  allowPrivate: boolean;
}

/** A certificate and its private key, in PEM. */
export interface CertificatePair {
  key: string;
  cert: string;
}

/** Everything the proxy needs, apart from the policy. */
export interface ProxyOptions {
  policy: ProxyPolicy;
  /** The real secret values, by environment variable name. They never leave the proxy. */
  secretValues: Record<string, string>;
  /** The certificates presented to the agent for the hosts that receive a secret. */
  certificates: Record<string, CertificatePair>;
  emit: (event: ProxyEvent) => void;
  /** The certificate authorities trusted for the real hosts; undefined means the system ones. */
  upstreamCa: string | undefined;
  /** The port of the real secret hosts: 443, except in the tests, which cannot listen on it. */
  secretHostPort: number;
}

/** The headers that carry credentials; the proxy removes those it does not manage before reaching a secret host. */
const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "api-key", "proxy-authorization"];

/** The headers that only concern the hop between the agent and the proxy. */
const HOP_HEADERS = ["proxy-connection", "proxy-authorization", "connection", "keep-alive"];

const HTTP_PORT = 80;
const HTTPS_PORT = 443;

/** Returns the target of a request received by the server; Node sets it on every such request. */
function readTarget(request: IncomingMessage): string {
  return request.url as string;
}

/** Splits "host:port" from a CONNECT request, or returns undefined when it is not valid. */
export function parseConnectTarget(target: string): { host: string; port: number } | undefined {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/u.exec(target);
  if (match === null) {
    return undefined;
  }
  return { host: normalizeHost(match[1] as string), port: Number(match[2]) };
}

/** Lists the secret rules that send a secret to one host, with their variable name. */
function findSecretsForHost(policy: ProxyPolicy, host: string): [string, SecretRule][] {
  const rules: [string, SecretRule][] = [];
  for (const [name, rule] of Object.entries(policy.secrets)) {
    if (rule.host === host) {
      rules.push([name, rule]);
    }
  }
  return rules;
}

/**
 * Replaces the credentials of a request to a secret host: every header managed by a rule and present in the request
 * receives the real secret, and every other credential header is removed, so that the agent cannot use its own key.
 */
export function injectSecrets(headers: IncomingHttpHeaders, rules: [string, SecretRule][], secretValues: Record<string, string>): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = { ...headers };
  const managedHeaders = new Set<string>();
  for (const [name, rule] of rules) {
    const value = secretValues[name];
    if (value !== undefined && headers[rule.header] !== undefined) {
      result[rule.header] = rule.template.replace("{value}", value);
      managedHeaders.add(rule.header);
    }
  }
  const removedHeaders = CREDENTIAL_HEADERS.filter(isNotIn, managedHeaders);
  return omitHeaders(result, removedHeaders);
}

/** Tells whether a header name is not in the set given as this. */
function isNotIn(this: Set<string>, header: string): boolean {
  return !this.has(header);
}

/** Returns a copy of the headers without the named ones. */
function omitHeaders(headers: IncomingHttpHeaders, names: string[]): IncomingHttpHeaders {
  const kept = Object.entries(headers).filter(hasNameOutside, names);
  return Object.fromEntries(kept) as IncomingHttpHeaders;
}

/** Tells whether a header entry has a name outside of the list given as this. */
function hasNameOutside(this: string[], entry: [string, unknown]): boolean {
  return !this.includes(entry[0]);
}

/** Removes the headers that only concern the hop to the proxy. */
function removeHopHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return omitHeaders(headers, HOP_HEADERS);
}

/** The decision taken for one connection. */
interface Decision {
  pass: boolean;
  action: ProxyAction;
  reason?: string;
}

/** Decides whether a connection may pass, according to the allowlist and the mode. */
export function decide(policy: ProxyPolicy, host: string, port: number): Decision {
  if (isAllowed(policy.allow, host, port)) {
    return { pass: true, action: "allowed" };
  }
  if (policy.mode === "audit") {
    return { pass: true, action: "allowed", reason: "audit: not in the allowlist" };
  }
  return { pass: false, action: "blocked", reason: "not in the allowlist" };
}

/** Finds the address of a host and refuses addresses of the computer or of the local network. */
async function resolvePublicAddress(policy: ProxyPolicy, host: string): Promise<string> {
  const { address } = await lookup(host);
  if (isPrivateAddress(address) && !policy.allowPrivate) {
    throw new Error(`private address ${address}`);
  }
  return address;
}

/** Builds the proxy server. Call listen() on the result. */
export function createProxyServer(options: ProxyOptions): Server {
  const server = createServer(handlePlainRequest.bind(undefined, options));
  server.on("connect", handleConnect.bind(undefined, options));
  return server;
}

/** Writes a journal event with the source port of the agent connection; Node keeps it once the request is read. */
function emitEvent(options: ProxyOptions, socket: Socket, details: Omit<ProxyEvent, "sourcePort">): void {
  options.emit({ ...details, sourcePort: socket.remotePort as number });
}

/** Refuses a CONNECT request after the hold delay, so that the process that opened it can be found meanwhile. */
function refuseTunnel(options: ProxyOptions, clientSocket: Duplex, status: string): void {
  setTimeout(writeAndClose, options.policy.denyDelayMs, clientSocket, `HTTP/1.1 ${status}\r\nContent-Length: 0\r\n\r\n`);
}

/** Writes a last message on a socket and closes it. */
function writeAndClose(socket: Duplex, message: string): void {
  socket.end(message);
}

/** Handles a CONNECT request: refused, tunneled to the real host, or opened to inject a secret. */
function handleConnect(options: ProxyOptions, request: IncomingMessage, clientSocket: Duplex): void {
  clientSocket.on("error", clientSocket.destroy.bind(clientSocket, undefined));
  const target = parseConnectTarget(readTarget(request));
  if (target === undefined) {
    clientSocket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const decision = decide(options.policy, target.host, target.port);
  const reasonPart = decision.reason === undefined ? {} : { reason: decision.reason };
  if (!decision.pass) {
    emitEvent(options, request.socket, { action: "blocked", ...target, ...reasonPart });
    refuseTunnel(options, clientSocket, "403 Forbidden");
    return;
  }
  const certificate = options.certificates[target.host];
  if (certificate !== undefined && target.port === HTTPS_PORT) {
    openInjectingTunnel(options, clientSocket, certificate);
    return;
  }
  void openTunnel(options, request, clientSocket, { ...target, ...reasonPart });
}

/** Connects the agent to the real host and copies the bytes in both directions, without reading them. */
async function openTunnel(options: ProxyOptions, request: IncomingMessage, clientSocket: Duplex, target: { host: string; port: number; reason?: string }): Promise<void> {
  try {
    const address = await resolvePublicAddress(options.policy, target.host);
    const upstream = connect(target.port, address);
    upstream.on("connect", startTunnel.bind(undefined, clientSocket, upstream));
    upstream.on("error", closeOnError.bind(undefined, clientSocket));
    emitEvent(options, request.socket, { action: "allowed", ...target });
  } catch (error) {
    emitEvent(options, request.socket, { action: "blocked", host: target.host, port: target.port, reason: (error as Error).message });
    refuseTunnel(options, clientSocket, "403 Forbidden");
  }
}

/** Answers the agent that the tunnel is open, then links both sockets. */
function startTunnel(clientSocket: Duplex, upstream: Socket): void {
  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  upstream.pipe(clientSocket);
  clientSocket.pipe(upstream);
}

/** Closes the agent socket when the real host cannot be reached. */
function closeOnError(clientSocket: Duplex): void {
  clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
}

/** Opens TLS towards the agent with the local certificate of the host, then reads its requests to inject the secret. */
function openInjectingTunnel(options: ProxyOptions, clientSocket: Duplex, certificate: CertificatePair): void {
  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  const tlsSocket = new TLSSocket(clientSocket, { isServer: true, key: certificate.key, cert: certificate.cert });
  tlsSocket.on("error", tlsSocket.destroy.bind(tlsSocket, undefined));
  const injectingServer = createServer(forwardWithSecret.bind(undefined, options, clientSocket as Socket));
  injectingServer.emit("connection", tlsSocket);
}

/** Sends one request of the agent to the real secret host, with the real secret in place of the placeholder. */
function forwardWithSecret(options: ProxyOptions, sourceSocket: Socket, request: IncomingMessage, response: ServerResponse): void {
  const host = normalizeHost((request.headers.host ?? "").replace(/:\d+$/u, ""));
  const rules = findSecretsForHost(options.policy, host);
  if (!(host in options.certificates)) {
    emitEvent(options, sourceSocket, { action: "blocked", host, port: HTTPS_PORT, reason: "host header does not match the tunnel" });
    response.writeHead(403).end();
    return;
  }
  const headers = removeHopHeaders(injectSecrets(request.headers, rules, options.secretValues));
  const upstreamOptions = { host, port: options.secretHostPort, method: request.method as string, path: readTarget(request), headers, servername: host, ca: options.upstreamCa };
  const upstream = httpsRequest(upstreamOptions, copyResponse.bind(undefined, response));
  upstream.on("error", answerBadGateway.bind(undefined, { options, sourceSocket, host }, response));
  request.pipe(upstream);
  emitEvent(options, sourceSocket, { action: "injected", host, port: HTTPS_PORT });
}

/** Copies the answer of the real host to the agent, status, headers and body. */
function copyResponse(response: ServerResponse, upstreamResponse: IncomingMessage): void {
  response.writeHead(upstreamResponse.statusCode as number, upstreamResponse.headers);
  upstreamResponse.pipe(response);
}

/** Answers 502 to the agent and records the failure when the real host cannot be reached, before any answer started. */
function answerBadGateway(origin: { options: ProxyOptions; sourceSocket: Socket; host: string }, response: ServerResponse, error: Error): void {
  emitEvent(origin.options, origin.sourceSocket, { action: "failed", host: origin.host, port: HTTPS_PORT, reason: error.message });
  response.writeHead(502).end();
}

/** Handles a plain HTTP request sent to the proxy, such as GET http://host/path. */
function handlePlainRequest(options: ProxyOptions, request: IncomingMessage, response: ServerResponse): void {
  const url = readAbsoluteUrl(readTarget(request));
  if (url === undefined) {
    response.writeHead(400).end("closedbox: this is a proxy, send absolute URLs.\n");
    return;
  }
  const host = normalizeHost(url.hostname);
  const port = Number(url.port === "" ? HTTP_PORT : url.port);
  const decision = decide(options.policy, host, port);
  const reasonPart = decision.reason === undefined ? {} : { reason: decision.reason };
  emitEvent(options, request.socket, { action: decision.action, host, port, ...reasonPart });
  if (!decision.pass) {
    setTimeout(answerForbidden, options.policy.denyDelayMs, response, host);
    return;
  }
  void forwardPlainRequest(options, request, response, { url, port });
}

/** Reads an absolute http:// URL, or returns undefined for anything else. */
function readAbsoluteUrl(text: string): URL | undefined {
  if (!text.startsWith("http://")) {
    return undefined;
  }
  return new URL(text);
}

/** Answers 403 with a short explanation for the agent. */
function answerForbidden(response: ServerResponse, host: string): void {
  response.writeHead(403, { "content-type": "text/plain" }).end(`closedbox: ${host} is not in the allowlist.\n`);
}

/** Sends a plain HTTP request to the real host, after checking that its address is public. */
async function forwardPlainRequest(options: ProxyOptions, request: IncomingMessage, response: ServerResponse, target: { url: URL; port: number }): Promise<void> {
  const { url, port } = target;
  try {
    const address = await resolvePublicAddress(options.policy, url.hostname);
    const headers = removeHopHeaders(request.headers);
    const upstreamOptions = { host: address, port, method: request.method as string, path: `${url.pathname}${url.search}`, headers };
    const upstream = httpRequest(upstreamOptions, copyResponse.bind(undefined, response));
    upstream.on("error", answerBadGateway.bind(undefined, { options, sourceSocket: request.socket, host: url.hostname }, response));
    request.pipe(upstream);
  } catch (error) {
    emitEvent(options, request.socket, { action: "blocked", host: url.hostname, port: HTTP_PORT, reason: (error as Error).message });
    answerForbidden(response, url.hostname);
  }
}
