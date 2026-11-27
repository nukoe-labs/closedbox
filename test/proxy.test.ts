import { once } from "node:events";
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect as netConnect, type AddressInfo } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureCertificateAuthority, ensureHostCertificate } from "../src/certs.js";
import type { ProxyEvent } from "../src/events.js";
import { parseAllowRule } from "../src/hosts.js";
import { createProxyServer, decide, injectSecrets, parseConnectTarget, type CertificatePair, type ProxyOptions, type ProxyPolicy } from "../src/proxy.js";
import { main as startProxyMain, readSecretValues } from "../src/proxy-main.js";
import { main as startWhoisMain } from "../src/whois-main.js";
import { PassThrough } from "node:stream";
import { vi } from "vitest";
import { SYSTEM_RUNNER } from "../src/runner.js";
import { makeTemporaryFolder } from "./helpers.js";

const SECRET_HOST = "localhost";
const state: { ca: string; pair: CertificatePair; https: Server; plain: Server; httpsPort: number; plainPort: number } = { ca: "", pair: { key: "", cert: "" }, https: createHttpServer(), plain: createHttpServer(), httpsPort: 0, plainPort: 0 };

/** Answers every request with its method, path and headers, so that the tests can see what reached the real host. */
function echoRequest(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ method: request.method, url: request.url, headers: request.headers }));
}

/** Starts a server on a free port of the loopback address and returns the port. */
async function listenOnFreePort(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

/** Creates the CA, the certificate of the secret host and the two real hosts. */
async function startRealHosts(): Promise<void> {
  const folder = join(makeTemporaryFolder("proxy"), "ca");
  state.ca = await ensureCertificateAuthority(SYSTEM_RUNNER, folder).then(readText);
  state.pair = await ensureHostCertificate(SYSTEM_RUNNER, folder, SECRET_HOST);
  state.https = createHttpsServer({ key: state.pair.key, cert: state.pair.cert }, echoRequest);
  state.plain = createHttpServer(echoRequest);
  state.httpsPort = await listenOnFreePort(state.https);
  state.plainPort = await listenOnFreePort(state.plain);
}

/** Reads a text file. */
async function readText(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

/** Stops the real hosts. */
function stopRealHosts(): void {
  state.https.close();
  state.plain.close();
}

/** Builds a policy for the tests. */
function makePolicy(overrides: Partial<ProxyPolicy>): ProxyPolicy {
  return {
    mode: "enforce",
    allow: [parseAllowRule(`${SECRET_HOST}:${state.httpsPort}`), parseAllowRule(`127.0.0.1:${state.plainPort}`), parseAllowRule(`localhost:${state.plainPort}`), parseAllowRule(SECRET_HOST)],
    secrets: { API_KEY: { host: SECRET_HOST, header: "x-api-key", template: "{value}" } },
    denyDelayMs: 1,
    allowPrivate: true,
    ...overrides,
  };
}

/** Starts a proxy with a policy and returns its port and the events it wrote. */
async function startProxy(policy: ProxyPolicy, extra: Partial<ProxyOptions> = {}): Promise<{ port: number; events: ProxyEvent[]; server: Server }> {
  const events: ProxyEvent[] = [];
  const options: ProxyOptions = { policy, secretValues: { API_KEY: "real-key" }, certificates: { [SECRET_HOST]: state.pair }, emit: pushEvent.bind(undefined, events), upstreamCa: state.ca, secretHostPort: state.httpsPort, ...extra };
  const server = createProxyServer(options);
  const port = await listenOnFreePort(server);
  return { port, events, server };
}

/** Adds an event to a list. */
function pushEvent(events: ProxyEvent[], event: ProxyEvent): void {
  events.push(event);
}

/** Sends a CONNECT request to the proxy and returns the status line and the socket. */
function sendConnect(proxyPort: number, target: string): Promise<{ status: number; socket: import("node:net").Socket }> {
  return new Promise(startConnect.bind(undefined, proxyPort, target));
}

/** Starts a CONNECT request and resolves with its answer. */
function startConnect(proxyPort: number, target: string, resolve: (value: { status: number; socket: import("node:net").Socket }) => void): void {
  const request = httpRequest({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: target });
  request.on("connect", resolveConnect.bind(undefined, resolve));
  request.end();
}

/** Resolves with the status and the socket of a CONNECT answer. */
function resolveConnect(resolve: (value: { status: number; socket: import("node:net").Socket }) => void, response: IncomingMessage, socket: import("node:net").Socket): void {
  resolve({ status: response.statusCode ?? 0, socket });
}

/** Sends an HTTPS request through an open tunnel and returns the echoed request. */
function requestThroughTunnel(socket: import("node:net").Socket, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise(startTunnelRequest.bind(undefined, socket, headers));
}

/** Opens TLS on the tunnel, trusting the local CA, and sends one request. */
function startTunnelRequest(socket: import("node:net").Socket, headers: Record<string, string>, resolve: (value: { status: number; body: string }) => void): void {
  const secure = tlsConnect({ socket, servername: SECRET_HOST, ca: state.ca });
  const request = httpRequest({ createConnection: returnSocket.bind(undefined, secure), host: SECRET_HOST, path: "/v1/messages", method: "POST", headers }, readBody.bind(undefined, resolve));
  request.end("{}");
}

/** Returns the given socket, used to send a request on an existing connection. */
function returnSocket(socket: import("node:net").Socket): import("node:net").Socket {
  return socket;
}

/** Reads the whole body of an answer. */
function readBody(resolve: (value: { status: number; body: string }) => void, response: IncomingMessage): void {
  const chunks: Buffer[] = [];
  response.on("data", pushChunk.bind(undefined, chunks));
  response.on("end", resolveBody.bind(undefined, resolve, response, chunks));
}

/** Adds a chunk to a list. */
function pushChunk(chunks: Buffer[], chunk: Buffer): void {
  chunks.push(chunk);
}

/** Resolves with the status and the body text. */
function resolveBody(resolve: (value: { status: number; body: string }) => void, response: IncomingMessage, chunks: Buffer[]): void {
  resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
}

/** Sends a plain HTTP request to the proxy. */
function sendPlain(proxyPort: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise(startPlain.bind(undefined, proxyPort, path));
}

/** Starts a plain HTTP request to the proxy. */
function startPlain(proxyPort: number, path: string, resolve: (value: { status: number; body: string }) => void): void {
  const request = httpRequest({ host: "127.0.0.1", port: proxyPort, path, headers: { "proxy-connection": "keep-alive" } }, readBody.bind(undefined, resolve));
  request.end();
}

/** Checks the parsing of CONNECT targets. */
function parsesConnectTargets(): void {
  expect(parseConnectTarget("Example.com:443")).toEqual({ host: "example.com", port: 443 });
  expect(parseConnectTarget("[::1]:443")).toEqual({ host: "::1", port: 443 });
  expect(parseConnectTarget("example.com")).toBeUndefined();
}

/** Checks the decisions in enforce and audit modes. */
function decidesInBothModes(): void {
  const policy = makePolicy({ allow: [parseAllowRule("a.example")] });
  expect(decide(policy, "a.example", 443)).toEqual({ pass: true, action: "allowed" });
  expect(decide(policy, "b.example", 443)).toMatchObject({ pass: false, action: "blocked" });
  expect(decide({ ...policy, mode: "audit" }, "b.example", 443)).toMatchObject({ pass: true, reason: "audit: not in the allowlist" });
}

/** Checks that managed headers receive the secret and that every other credential header is removed. */
function injectsOnlyManagedHeaders(): void {
  const rules: [string, { host: string; header: string; template: string }][] = [["API_KEY", { host: "h", header: "x-api-key", template: "{value}" }], ["TOKEN", { host: "h", header: "authorization", template: "Bearer {value}" }], ["ABSENT", { host: "h", header: "api-key", template: "{value}" }]];
  const result = injectSecrets({ "x-api-key": "placeholder", authorization: "Bearer attacker", "content-type": "json" }, rules.slice(0, 1), { API_KEY: "real" });
  expect(result).toEqual({ "x-api-key": "real", "content-type": "json" });
  const both = injectSecrets({ authorization: "Bearer placeholder", "api-key": "x" }, rules, { API_KEY: "real", TOKEN: "tok" });
  expect(both).toEqual({ authorization: "Bearer tok" });
}

/** Checks that a host outside the allowlist is refused and recorded with the source port. */
async function blocksAHostOutsideTheAllowlist(): Promise<void> {
  const proxy = await startProxy(makePolicy({}));
  const answer = await sendConnect(proxy.port, "evil.example:443");
  expect(answer.status).toBe(403);
  expect(proxy.events[0]).toMatchObject({ action: "blocked", host: "evil.example", port: 443 });
  expect(proxy.events[0]?.sourcePort).toBeGreaterThan(0);
  const malformed = await sendConnect(proxy.port, "no-port");
  expect(malformed.status).toBe(400);
  proxy.server.close();
}

/** Checks that the secret reaches the secret host in place of the placeholder, and that the agent key is removed. */
async function injectsTheSecretForTheSecretHost(): Promise<void> {
  const proxy = await startProxy(makePolicy({}));
  const tunnel = await sendConnect(proxy.port, `${SECRET_HOST}:443`);
  expect(tunnel.status).toBe(200);
  const answer = await requestThroughTunnel(tunnel.socket, { "x-api-key": "placeholder", authorization: "Bearer attacker-key", host: SECRET_HOST });
  const echoed = JSON.parse(answer.body) as { headers: Record<string, string> };
  expect(echoed.headers["x-api-key"]).toBe("real-key");
  expect(echoed.headers.authorization).toBeUndefined();
  expect(proxy.events).toContainEqual(expect.objectContaining({ action: "injected", host: SECRET_HOST }));
  proxy.server.close();
}

/** Checks that a Host header that does not match the tunnel is refused inside the opened tunnel. */
async function refusesAHostSwapInsideTheTunnel(): Promise<void> {
  const proxy = await startProxy(makePolicy({}));
  const tunnel = await sendConnect(proxy.port, `${SECRET_HOST}:443`);
  const answer = await requestThroughTunnel(tunnel.socket, { host: "evil.example" });
  expect(answer.status).toBe(403);
  expect(proxy.events).toContainEqual(expect.objectContaining({ action: "blocked", host: "evil.example" }));
  const second = await sendConnect(proxy.port, `${SECRET_HOST}:443`);
  const withoutHost = await sendRawThroughTunnel(second.socket, "GET / HTTP/1.0\r\n\r\n");
  expect(withoutHost).toContain("403");
  proxy.server.close();
}

/** Opens TLS on a tunnel and sends a raw request, then returns the raw answer. */
async function sendRawThroughTunnel(socket: import("node:net").Socket, raw: string): Promise<string> {
  const secure = tlsConnect({ socket, servername: SECRET_HOST, ca: state.ca });
  await once(secure, "secureConnect");
  secure.write(raw);
  const [chunk] = (await once(secure, "data")) as [Buffer];
  return chunk.toString();
}

/** Checks that a client that left before the decision is still recorded with its port, and that a DNS failure is refused. */
async function recordsAClientThatLeftEarly(): Promise<void> {
  const proxy = await startProxy(makePolicy({ allow: [parseAllowRule("closedbox-missing.invalid")] }));
  const socket = netConnect(proxy.port, "127.0.0.1");
  socket.on("error", ignoreError);
  socket.end("CONNECT closedbox-missing.invalid:443 HTTP/1.1\r\nHost: x\r\n\r\n");
  while (proxy.events.length === 0) {
    await new Promise(setImmediate);
  }
  expect(proxy.events[0]).toMatchObject({ action: "blocked", host: "closedbox-missing.invalid" });
  expect(proxy.events[0]?.sourcePort).toBeGreaterThan(0);
  proxy.server.close();
}

/** Ignores an error. */
function ignoreError(): void {
  return undefined;
}

/** Checks the 502 answer when the secret host does not answer. */
async function answersBadGatewayWhenTheSecretHostIsDown(): Promise<void> {
  const proxy = await startProxy(makePolicy({}), { secretHostPort: 1 });
  const tunnel = await sendConnect(proxy.port, `${SECRET_HOST}:443`);
  const answer = await requestThroughTunnel(tunnel.socket, { host: SECRET_HOST });
  expect(answer.status).toBe(502);
  expect(proxy.events).toContainEqual(expect.objectContaining({ action: "failed" }));
  proxy.server.close();
}

/** Checks a plain tunnel to an allowed host, and the refusal of a local address when private addresses are off. */
async function tunnelsToAnAllowedHostAndRefusesPrivateAddresses(): Promise<void> {
  const proxy = await startProxy(makePolicy({}));
  const tunnel = await sendConnect(proxy.port, `127.0.0.1:${state.plainPort}`);
  expect(tunnel.status).toBe(200);
  tunnel.socket.end("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  const [firstChunk] = (await once(tunnel.socket, "data")) as [Buffer];
  expect(firstChunk.toString()).toContain("200 OK");
  const strict = await startProxy(makePolicy({ allowPrivate: false }));
  const refused = await sendConnect(strict.port, `localhost:${state.plainPort}`);
  expect(refused.status).toBe(403);
  expect(strict.events[0]?.reason).toContain("private address");
  const auditStrict = await startProxy(makePolicy({ mode: "audit", allowPrivate: false }));
  const longForm = await sendConnect(auditStrict.port, `[0:0:0:0:0:0:0:1]:${state.plainPort}`);
  expect(longForm.status).toBe(403);
  expect(auditStrict.events[0]?.reason).toContain("private address");
  const closedPort = await startProxy(makePolicy({ allow: [parseAllowRule("127.0.0.1:1")] }));
  const down = await sendConnect(closedPort.port, "127.0.0.1:1");
  expect(down.status).toBe(502);
  proxy.server.close();
  strict.server.close();
  auditStrict.server.close();
  closedPort.server.close();
}

/** Checks plain HTTP: allowed, refused, not absolute, private, audit, and an unreachable host. */
async function handlesPlainHttp(): Promise<void> {
  const proxy = await startProxy(makePolicy({}));
  const allowed = await sendPlain(proxy.port, `http://127.0.0.1:${state.plainPort}/path?q=1`);
  expect(JSON.parse(allowed.body)).toMatchObject({ url: "/path?q=1" });
  expect(JSON.parse(allowed.body).headers["proxy-connection"]).toBeUndefined();
  expect((await sendPlain(proxy.port, "http://evil.example/")).status).toBe(403);
  expect((await sendPlain(proxy.port, "/relative")).status).toBe(400);
  const strict = await startProxy(makePolicy({ allowPrivate: false }));
  expect((await sendPlain(strict.port, `http://localhost:${state.plainPort}/`)).status).toBe(403);
  const audit = await startProxy(makePolicy({ mode: "audit", allow: [] }));
  expect((await sendPlain(audit.port, `http://127.0.0.1:${state.plainPort}/`)).status).toBe(200);
  expect(audit.events[0]?.reason).toContain("audit");
  const down = await startProxy(makePolicy({ allow: [parseAllowRule("127.0.0.1:1"), parseAllowRule("127.0.0.1:80")] }));
  expect((await sendPlain(down.port, "http://127.0.0.1:1/")).status).toBe(502);
  for (const server of [proxy.server, strict.server, audit.server, down.server]) {
    server.close();
  }
}

/** Checks that the proxy container reads the secret values named in the policy, and empty when missing. */
function readsSecretValuesFromTheEnvironment(): void {
  expect(readSecretValues(makePolicy({}), { API_KEY: "v" })).toEqual({ API_KEY: "v" });
  expect(readSecretValues(makePolicy({}), {})).toEqual({ API_KEY: "" });
}

/** Checks the entry points of both containers: the proxy writes its ready line and events, the helper answers ports. */
async function startsFromTheContainerEntryPoint(): Promise<void> {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(recordWrite.bind(undefined, written));
  const configuration = { policy: makePolicy({}), certificates: {} };
  const server = startProxyMain({ CLOSEDBOX_PROXY_CONFIG: JSON.stringify(configuration), API_KEY: "v" }, 0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  await sendConnect(port, "evil.example:443");
  spy.mockRestore();
  server.close();
  expect(written[0]).toContain('"ready":true');
  expect(written[1]).toContain("evil.example");
  const input = new PassThrough();
  const output = new PassThrough();
  startWhoisMain(input, output);
  input.write("1\n");
  const [answer] = (await once(output, "data")) as [Buffer];
  expect(JSON.parse(answer.toString())).toMatchObject({ port: 1 });
}

/** Records a text written on the standard output. */
function recordWrite(written: string[], text: string | Uint8Array): boolean {
  written.push(String(text));
  return true;
}

describe("proxy", describeProxy);

/** Groups the proxy tests. */
function describeProxy(): void {
  beforeAll(startRealHosts);
  afterAll(stopRealHosts);
  it("parses CONNECT targets", parsesConnectTargets);
  it("decides in both modes", decidesInBothModes);
  it("injects only managed headers", injectsOnlyManagedHeaders);
  it("blocks a host outside the allowlist", blocksAHostOutsideTheAllowlist);
  it("injects the secret for the secret host", injectsTheSecretForTheSecretHost);
  it("refuses a host swap inside the tunnel", refusesAHostSwapInsideTheTunnel);
  it("answers 502 when the secret host is down", answersBadGatewayWhenTheSecretHostIsDown);
  it("tunnels to an allowed host and refuses private addresses", tunnelsToAnAllowedHostAndRefusesPrivateAddresses);
  it("handles plain HTTP", handlesPlainHttp);
  it("records a client that left early", recordsAClientThatLeftEarly);
  it("starts from the container entry point", startsFromTheContainerEntryPoint);
  it("reads secret values from the environment", readsSecretValuesFromTheEnvironment);
}
