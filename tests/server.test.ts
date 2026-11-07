import http from "node:http";
import { describe, expect, test } from "vitest";
import { closeBridgeServer, createBridgeServer } from "../src/server.js";
import type { BridgeConfig } from "../src/config.js";

const SECRET = "0123456789abcdef0123456789abcdef";

const config: BridgeConfig = {
  projectsRoot: "/home/bridge/projects",
  listenHost: "127.0.0.1",
  listenPort: 0,
  allowedPeerAddress: "127.0.0.1",
  sharedSecret: SECRET,
  maxReadBytes: 128,
  maxResponseBytes: 65664,
};

const client = {
  listAgents: async () => [], readAgent: async () => ({}), listRequests: async () => [],
  selectRequestOption: async () => ({}), approveRequest: async () => ({}),
    denyRequest: async () => ({}), dismissRequest: async () => ({}), promptAgent: async () => ({}), waitForAgent: async () => ({ id: "a", name: "a", projectId: "p", type: "t", status: "idle", waitingForInput: false, bridgeUptimeSeconds: 0 }),
};

function request(server: http.Server, path: string, options: { method?: string; body?: string; authorization?: string | null } = {}): Promise<number> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server is not listening");
  return new Promise((resolve, reject) => {
    const method = options.method ?? (options.body ? "POST" : "GET");
    const authorization = options.authorization === undefined ? `Bearer ${SECRET}` : options.authorization;
    const headers: Record<string, string> = method === "POST"
      ? { accept: "application/json, text/event-stream", "content-type": "application/json" }
      : { accept: "text/event-stream" };
    if (authorization !== null) headers.authorization = authorization;
    const req = http.request({ host: "127.0.0.1", port: address.port, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    if (options.body) req.end(options.body); else req.end();
  });
}

test("allows requests from localhost and the configured peer with the bearer secret", async () => {
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

const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });

test.each([
  ["no header", null],
  ["empty header", ""],
  ["wrong secret", "Bearer wrong"],
  ["secret without scheme", SECRET],
  ["wrong scheme", `Basic ${SECRET}`],
  ["secret with a suffix", `Bearer ${SECRET}x`],
  ["secret with a prefix cut off", `Bearer ${SECRET.slice(1)}`],
  ["bearer with nothing after it", "Bearer "],
])("rejects /mcp with %s", async (_name, authorization) => {
  const server = createBridgeServer(client, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(await request(server, "/mcp", { method: "POST", body: initialize, authorization })).toBe(401);
    expect(await request(server, "/mcp", { method: "GET", authorization })).toBe(401);
    expect(await request(server, "/mcp", { method: "DELETE", authorization })).toBe(401);
  } finally {
    await closeBridgeServer(server);
  }
});

test("accepts the bearer scheme in any case", async () => {
  const server = createBridgeServer(client, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(await request(server, "/mcp", { method: "POST", body: initialize, authorization: `bearer ${SECRET}` })).toBe(200);
  } finally {
    await closeBridgeServer(server);
  }
});

test("health stays open without a bearer secret", async () => {
  const server = createBridgeServer(client, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(await request(server, "/health", { authorization: null })).toBe(200);
  } finally {
    await closeBridgeServer(server);
  }
});

test("a rejected request never reaches the tools", async () => {
  let called = false;
  const spy = { ...client, listAgents: async () => { called = true; return []; } };
  const server = createBridgeServer(spy, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_agents", arguments: {} } });
    expect(await request(server, "/mcp", { method: "POST", body, authorization: null })).toBe(401);
    expect(called).toBe(false);
  } finally {
    await closeBridgeServer(server);
  }
});
