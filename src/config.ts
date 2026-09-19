import os from "node:os";
import path from "node:path";

export interface BridgeConfig {
  projectsRoot: string;
  listenHost: string;
  listenPort: number;
  allowedPeerAddress: string;
  maxReadBytes: number;
  maxResponseBytes: number;
  herdrCommand: string;
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied`);
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HERDR_LISTEN_PORT must be an integer from 1 to 65535");
  }
  return port;
}

function parseMaxReadBytes(value: string | undefined): number {
  if (value === undefined) {
    return 65536;
  }

  const maxReadBytes = Number(value);
  if (!Number.isFinite(maxReadBytes) || !Number.isInteger(maxReadBytes) || maxReadBytes < 1) {
    throw new Error("HERDR_MAX_READ_BYTES must be a finite positive integer");
  }
  return maxReadBytes;
}

function expandHome(value: string, home: string): string {
  return value === "~" || value.startsWith("~/")
    ? path.join(home, value.slice(2))
    : value;
}

export function loadConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  const home = path.resolve(env.HOME || os.homedir());
  const projectsRoot = path.resolve(
    expandHome(env.HERDR_PROJECTS_ROOT || "~/projects", home),
  );

  if (projectsRoot !== home && !projectsRoot.startsWith(`${home}${path.sep}`)) {
    throw new Error("HERDR_PROJECTS_ROOT must be inside HOME");
  }

  const maxReadBytes = parseMaxReadBytes(env.HERDR_MAX_READ_BYTES);
  return {
    projectsRoot,
    listenHost: env.HERDR_LISTEN_HOST?.trim() || "127.0.0.1",
    listenPort: parsePort(env.HERDR_LISTEN_PORT),
    allowedPeerAddress: requiredEnvironment(env, "HERDR_ALLOWED_PEER_ADDRESS"),
    maxReadBytes,
    maxResponseBytes: Math.min(maxReadBytes + 65536, 1048576),
    herdrCommand: env.HERDR_COMMAND?.trim() || "herdr",
  };
}
