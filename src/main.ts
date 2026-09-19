import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig, type BridgeConfig } from "./config.js";
import { HerdrClient } from "./herdr-client.js";
import { createBridgeServer, closeBridgeServer } from "./server.js";
import type { ToolClient } from "./tools.js";

export async function startBridge(config: BridgeConfig, client: ToolClient = new HerdrClient({ maxResponseBytes: config.maxResponseBytes })): Promise<http.Server> {
  const server = createBridgeServer(client, config);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listenPort, config.listenHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server;
}

export async function run(): Promise<void> {
  const server = await startBridge(loadConfig(process.env));
  const shutdown = () => {
    void closeBridgeServer(server).catch(() => undefined);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run();
}
