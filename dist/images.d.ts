import type { Runner } from "./runner.js";
/** The base image of the agent, pinned by digest so that a moved tag cannot change what runs. */
export declare const AGENT_BASE_IMAGE = "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee";
/** The image of the proxy, pinned by digest. */
export declare const PROXY_IMAGE = "node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a";
/** The agents installed in the image. */
export declare const AGENT_PACKAGES = "@anthropic-ai/claude-code @openai/codex";
/** Writes the Dockerfile of the agent image. The agents are installed when the image is built, outside the sandbox. */
export declare function writeDockerfile(agentPackages: string): string;
/** Names the image after its Dockerfile and its CA, so that a change of either builds a new image. */
export declare function imageTag(dockerfile: string, caCertificate: string): string;
/** Where and how the agent image is built. */
export interface ImageBuild {
    folder: string;
    caPath: string;
    agentPackages: string;
}
/** Builds the agent image when it does not exist yet, and returns its tag. */
export declare function ensureAgentImage(runner: Runner, runtime: string, build: ImageBuild): Promise<string>;
