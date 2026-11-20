import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** The base image of the agent, pinned by digest so that a moved tag cannot change what runs. */
export const AGENT_BASE_IMAGE = "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee";
/** The image of the proxy, pinned by digest. */
export const PROXY_IMAGE = "node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a";
/** The agents installed in the image. */
export const AGENT_PACKAGES = "@anthropic-ai/claude-code @openai/codex";
/**
 * Writes the Dockerfile of the agent image. The agents are installed when the image is built, outside the sandbox, and
 * the user of the image takes the numbers of the person, so that the project files keep their owner.
 */
export function writeDockerfile(agentPackages, user) {
    const installAgents = agentPackages === "" ? "" : `RUN npm install -g ${agentPackages} && npm cache clean --force\n`;
    const matchUser = `RUN groupmod -o -g ${user.gid} node && usermod -o -u ${user.uid} -g ${user.gid} node && chown -R node:node /home/node\n`;
    return `FROM ${AGENT_BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl python3 ripgrep procps dnsutils \\
 && rm -rf /var/lib/apt/lists/*
${installAgents}${matchUser}COPY closedbox-ca.crt /usr/local/share/ca-certificates/closedbox.crt
RUN update-ca-certificates
USER node
WORKDIR /workspace
`;
}
/** Names the image after its Dockerfile and its CA, so that a change of either builds a new image. */
export function imageTag(dockerfile, caCertificate) {
    const digest = createHash("sha256").update(dockerfile).update(caCertificate).digest("hex").slice(0, 12);
    return `closedbox-agent:${digest}`;
}
/** Builds the agent image when it does not exist yet, and returns its tag. */
export async function ensureAgentImage(runner, runtime, build) {
    const dockerfile = writeDockerfile(build.agentPackages, build.user);
    const tag = imageTag(dockerfile, readFileSync(build.caPath, "utf8"));
    const inspection = await runner.run(runtime, ["image", "inspect", tag]);
    if (inspection.code === 0) {
        return tag;
    }
    mkdirSync(build.folder, { recursive: true });
    writeFileSync(join(build.folder, "Dockerfile"), dockerfile);
    copyFileSync(build.caPath, join(build.folder, "closedbox-ca.crt"));
    const code = await runner.interactive(runtime, ["build", "-t", tag, build.folder], process.env);
    if (code !== 0) {
        throw new Error(`The agent image could not be built (exit code ${code}).`);
    }
    return tag;
}
