import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** The name of the local certificate authority file, trusted only inside the agent image. */
export const CA_CERTIFICATE = "ca.crt";
const CA_KEY = "ca.key";
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_FOLDER_MODE = 0o700;
const EC_KEY = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-pkeyopt", "ec_param_enc:named_curve", "-nodes"];
/** Runs openssl and throws an error with its message when it fails. */
async function runOpenssl(runner, argumentsList) {
    const result = await runner.run("openssl", argumentsList);
    if (result.code !== 0) {
        throw new Error(`openssl failed (${result.code}): ${result.stderr.trim()}`);
    }
}
/**
 * Creates the local certificate authority once. Its certificate is added to the agent image so that the proxy can
 * read the requests sent to the hosts that receive a secret. It is never added to the trust store of the computer.
 */
export async function ensureCertificateAuthority(runner, folder) {
    mkdirSync(folder, { recursive: true, mode: PRIVATE_FOLDER_MODE });
    const certificatePath = join(folder, CA_CERTIFICATE);
    const keyPath = join(folder, CA_KEY);
    if (existsSync(certificatePath) && existsSync(keyPath)) {
        return certificatePath;
    }
    const subject = ["-subj", "/CN=closedbox local CA (sandbox only)"];
    const extensions = ["-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"];
    await runOpenssl(runner, ["req", "-x509", "-sha256", ...EC_KEY, "-keyout", keyPath, "-out", certificatePath, "-days", "3650", ...subject, ...extensions]);
    chmodSync(keyPath, PRIVATE_FILE_MODE);
    return certificatePath;
}
/** Writes the extension file of a server certificate for one host. */
function writeExtensionFile(folder, host) {
    const extensionPath = join(folder, `${host}.ext`);
    writeFileSync(extensionPath, `subjectAltName=DNS:${host}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    return extensionPath;
}
/** Creates, once, the certificate that the proxy shows to the agent for one host that receives a secret. */
export async function ensureHostCertificate(runner, folder, host) {
    const keyPath = join(folder, `${host}.key`);
    const certificatePath = join(folder, `${host}.crt`);
    if (!existsSync(certificatePath)) {
        const requestPath = join(folder, `${host}.csr`);
        await runOpenssl(runner, ["req", "-new", ...EC_KEY, "-keyout", keyPath, "-out", requestPath, "-subj", `/CN=${host}`]);
        chmodSync(keyPath, PRIVATE_FILE_MODE);
        const caFiles = ["-CA", join(folder, CA_CERTIFICATE), "-CAkey", join(folder, CA_KEY), "-CAcreateserial"];
        await runOpenssl(runner, ["x509", "-req", "-sha256", "-in", requestPath, ...caFiles, "-out", certificatePath, "-days", "825", "-extfile", writeExtensionFile(folder, host)]);
    }
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certificatePath, "utf8") };
}
