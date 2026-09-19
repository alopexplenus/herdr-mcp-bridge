import { describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_NAMES, toolContracts } from "../src/tool-contract.js";
import { createMcpServer, createToolHandlers } from "../src/tools.js";
import type { BridgeConfig } from "../src/config.js";

const config: BridgeConfig = {
  projectsRoot: "/home/bridge/projects",
  listenHost: "127.0.0.1",
  listenPort: 8787,
  allowedPeerAddress: "127.0.0.1",
  maxReadBytes: 8,
  maxResponseBytes: 65544,
  herdrCommand: "herdr",
};

describe("MCP tool contracts", () => {
  test("exposes exactly the nine allowlisted tools", () => {
    expect(TOOL_NAMES).toEqual([
      "list_projects",
      "list_agents",
      "read_agent",
      "list_requests",
      "select_request_option",
      "approve_request",
      "deny_request",
      "dismiss_request",
      "prompt_agent",
    ]);
    expect(TOOL_NAMES.some((name) => /shell|pane|key|lifecycle/i.test(name))).toBe(false);
  });

  test("publishes only the allowlisted tools through tools/list", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      listAgents: async () => [], readAgent: async () => ({}), listRequests: async () => [],
      selectRequestOption: async () => ({}), approveRequest: async () => ({}), denyRequest: async () => ({}),
      dismissRequest: async () => ({}), promptAgent: async () => ({}),
    }, config);
    const client = new Client({ name: "contract-test", version: "1" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
      expect(result.tools.map((tool) => tool.name).some((name) => /shell|pane|key|lifecycle/i.test(name))).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("advertises strict input schemas for every tool", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      listAgents: async () => [], readAgent: async () => ({}), listRequests: async () => [],
      selectRequestOption: async () => ({}), approveRequest: async () => ({}), denyRequest: async () => ({}),
      dismissRequest: async () => ({}), promptAgent: async () => ({}),
    }, config);
    const client = new Client({ name: "schema-test", version: "1" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("requires IDs for every mutation and keeps dismiss request to one ID", () => {
    for (const name of ["select_request_option", "approve_request", "deny_request", "dismiss_request"] as const) {
      expect(() => toolContracts[name].parse({})).toThrow();
      expect(() => toolContracts[name].parse({ requestId: "req-1", option: 2, extra: true })).toThrow();
    }
    expect(toolContracts.dismiss_request.parse({ requestId: "req-1" })).toEqual({ requestId: "req-1" });
    expect(toolContracts.prompt_agent.parse({ agentId: "agent-1", text: "hello" })).toEqual({ agentId: "agent-1", text: "hello" });
  });

  test("bounds prompt text", () => {
    expect(() => toolContracts.prompt_agent.parse({ agentId: "agent-1", text: "x".repeat(4001) })).toThrow();
    expect(() => toolContracts.prompt_agent.parse({ agentId: "agent-1", text: "   " })).toThrow();
  });

  test("accepts only numeric request options from 1 through 99", () => {
    expect(toolContracts.select_request_option.parse({ requestId: "req-1", option: 2 })).toEqual({ requestId: "req-1", option: 2 });
    expect(() => toolContracts.select_request_option.parse({ requestId: "req-1", option: 0 })).toThrow();
    expect(() => toolContracts.select_request_option.parse({ requestId: "req-1", option: 100 })).toThrow();
    expect(() => toolContracts.select_request_option.parse({ requestId: "req-1", option: "yes" })).toThrow();
    expect(() => toolContracts.select_request_option.parse({ requestId: "req-1", option: 2, metadata: { label: "yes" } })).toThrow();
    expect(() => toolContracts.select_request_option.parse({ requestId: "req-1", option: 2, extra: "nope" })).toThrow();
  });

  test("rejects arbitrary arguments on read_agent", () => {
    expect(() => toolContracts.read_agent.parse({ agentId: "agent-1", extra: true })).toThrow();
    expect(toolContracts.read_agent.parse({ agentId: "agent-1" })).toEqual({ agentId: "agent-1" });
  });

  test("bounds read_agent output while preserving the agent ID", async () => {
    const handlers = createToolHandlers({
      listAgents: async () => [],
      readAgent: async () => ({ output: "0123456789" }),
      listRequests: async () => [],
      selectRequestOption: async () => ({}),
      approveRequest: async () => ({}),
      denyRequest: async () => ({}),
      dismissRequest: async () => ({}),
      promptAgent: async () => ({}),
    }, config);
    await expect(handlers.read_agent({ agentId: "agent-1" })).resolves.toEqual({ agentId: "agent-1", output: '{"output', truncated: true });
  });

  test("bounds multibyte read output after UTF-8 encoding", async () => {
    const handlers = createToolHandlers({
      listAgents: async () => [],
      readAgent: async () => "😀😀",
      listRequests: async () => [],
      selectRequestOption: async () => ({}),
      approveRequest: async () => ({}),
      denyRequest: async () => ({}),
      dismissRequest: async () => ({}),
      promptAgent: async () => ({}),
    }, { ...config, maxReadBytes: 5 });

    const result = await handlers.read_agent({ agentId: "agent-1" });
    expect(result).toEqual({ agentId: "agent-1", output: "😀", truncated: true });
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(5);
  });

});
