import http from "node:http";
import { describe, expect, test } from "vitest";
import { closeBridgeServer, createBridgeServer } from "../src/server.js";
import type { BridgeConfig } from "../src/config.js";

const config: BridgeConfig = {
  projectsRoot: "/home/bridge/projects",
  listenHost: "127.0.0.1",
  listenPort: 0,
  allowedPeerAddress: "127.0.0.1",
  maxReadBytes: 128,
  maxResponseBytes: 65664,
  herdrCommand: "herdr",
};

const client = {
  listAgents: async () => [], readAgent: async () => ({}), listRequests: async () => [],
  selectRequestOption: async () => ({}), approveRequest: async () => ({}),
  denyRequest: async () => ({}), dismissRequest: async () => ({}), promptAgent: async () => ({}),
};

function request(server: http.Server, path: string, options: { method?: string; body?: string } = {}): Promise<number> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server is not listening");
  return new Promise((resolve, reject) => {
    const method = options.method ?? (options.body ? "POST" : "GET");
    const headers = method === "POST"
      ? { accept: "application/json, text/event-stream", "content-type": "application/json" }
      : { accept: "text/event-stream" };
    const req = http.request({ host: "127.0.0.1", port: address.port, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    if (options.body) req.end(options.body); else req.end();
  });
}

test("allows requests from the configured peer", async () => {
  const server = createBridgeServer(client, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(await request(server, "/health")).toBe(200);
    expect(await request(server, "/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    })).toBe(200);
  } finally {
    await closeBridgeServer(server);
  }
});

test("returns not found for sessionless GET /mcp", async () => {
  const server = createBridgeServer(client, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(await request(server, "/mcp")).toBe(404);
  } finally {
    await closeBridgeServer(server);
  }
});
