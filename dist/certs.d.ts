import type { CertificatePair } from "./proxy.js";
import type { Runner } from "./runner.js";
/** The name of the local certificate authority file, trusted only inside the agent image. */
export declare const CA_CERTIFICATE = "ca.crt";
/**
 * Creates the local certificate authority once. Its certificate is added to the agent image so that the proxy can
 * read the requests sent to the hosts that receive a secret. It is never added to the trust store of the computer.
 */
export declare function ensureCertificateAuthority(runner: Runner, folder: string): Promise<string>;
/** Creates, once, the certificate that the proxy shows to the agent for one host that receives a secret. */
export declare function ensureHostCertificate(runner: Runner, folder: string, host: string): Promise<CertificatePair>;
