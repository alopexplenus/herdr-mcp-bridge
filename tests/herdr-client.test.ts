import net from "node:net";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { HerdrClient } from "../src/herdr-client.js";

type Request = { id: number; method: string; params: Record<string, unknown> };

function fakeClient(responses: Record<string, unknown>, requests: Request[] = []) {
  const client = new HerdrClient({
    send: async (line) => {
      const request = JSON.parse(line) as Request;
      requests.push({ ...request, id: Number(request.id) });
      return JSON.stringify({ id: request.id, result: responses[request.method] });
    },
  });
  return { client, requests };
}

describe("HerdrClient", () => {
  test("uses documented target-based agent methods and filters blocked agents", async () => {
    const { client, requests } = fakeClient({
      "agent.list": {
        agents: [
          { id: "a1", name: "builder", agent: "coding", agent_type: "wrong-fallback", project_id: "p1", agent_status: "blocked", waiting_for_input: true, message: "choose", session_topic: "Build feature" },
          { id: "a2", name: "idle", agent: "chat", project_id: "p1", agent_status: "idle", waiting_for_input: false },
        ],
      },
      "agent.get": { id: "a1", agent_status: "blocked" },
      "agent.read": { id: "a1", text: "ready" },
      "agent.prompt": { accepted: true },
    });

    await expect(client.listAgents()).resolves.toEqual([
      { id: "a1", name: "builder", type: "coding", projectId: "p1", status: "blocked", waitingForInput: true, bridgeUptimeSeconds: expect.any(Number), topic: "Build feature", message: "choose" },
      { id: "a2", name: "idle", type: "chat", projectId: "p1", status: "idle", waitingForInput: false, bridgeUptimeSeconds: expect.any(Number) },
    ]);
    await expect(client.listRequests()).resolves.toEqual([
      { requestId: "a1", agentId: "a1", status: "blocked", message: "choose" },
    ]);
    await expect(client.readAgent("a1")).resolves.toEqual({ id: "a1", text: "ready" });
    await expect(client.promptAgent("a1", "build")).resolves.toEqual({ accepted: true });
    expect(requests).toEqual([
      { id: 1, method: "agent.list", params: {} },
      { id: 2, method: "agent.list", params: {} },
      { id: 3, method: "agent.list", params: {} },
      { id: 4, method: "agent.read", params: { target: "a1", source: "recent", format: "text" } },
      { id: 5, method: "agent.list", params: {} },
      { id: 6, method: "agent.prompt", params: { target: "a1", text: "build" } },
    ]);
  });

  test("reads an existing agent with target and preserves the HERDR result shape", async () => {
    const { client, requests } = fakeClient({
      "agent.list": { agents: [{ id: "a1", agent_status: "idle" }] },
      "agent.read": { type: "pane_read", read: { text: "ready" } },
    });

    await expect(client.readAgent("a1")).resolves.toBe("ready");
    expect(requests).toEqual([
      { id: 1, method: "agent.list", params: {} },
      { id: 2, method: "agent.read", params: { target: "a1", source: "recent", format: "text" } },
    ]);
  });

  test("waits until an agent reaches the requested status", async () => {
    let calls = 0;
    const client = new HerdrClient({
      send: async () => JSON.stringify({ id: ++calls, result: { agents: [{ id: "a1", agent_status: calls < 2 ? "working" : "done" }] } }),
    });
    await expect(client.waitForAgent("a1", "done", 1000, 50)).resolves.toMatchObject({ id: "a1", status: "done" });
    expect(calls).toBe(2);
  });

  test("times out while waiting for a status", async () => {
    const client = new HerdrClient({ send: async (line) => {
      const request = JSON.parse(line) as Request;
      return JSON.stringify({ id: request.id, result: { agents: [{ id: "a1", agent_status: "working" }] } });
    } });
    await expect(client.waitForAgent("a1", "done", 100, 50)).rejects.toMatchObject({ code: "WAIT_TIMEOUT" });
  });

  test("accepts current HERDR string response IDs and agent-list envelopes", async () => {
    const client = new HerdrClient({
      send: async () => JSON.stringify({
        id: "cli:agent:list",
        result: {
          type: "agent_list",
          agents: [{
            id: "a1",
            agent: "opencode",
            agent_status: "idle",
            workspace_id: "w1",
            waiting_for_input: false,
          }],
        },
      }),
    });

    await expect(client.listAgents()).resolves.toEqual([{
      id: "a1",
      name: "a1",
      type: "opencode",
      projectId: "w1",
      status: "idle",
      waitingForInput: false,
      bridgeUptimeSeconds: expect.any(Number),
    }]);
  });

  test("caps a HERDR response before accumulating it", async () => {
    const client = new HerdrClient({
      maxResponseBytes: 10,
      send: async () => JSON.stringify({ id: 1, result: { agents: [] } }) + "x".repeat(20),
    });
    await expect(client.listAgents()).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  test("maps request actions to fixed prompt text and escape keys", async () => {
    const { client, requests } = fakeClient({
      "agent.list": { agents: [{ id: "a1", agent_status: "blocked" }] },
      "agent.prompt": { ok: true },
      "agent.send_keys": { ok: true },
    });

    await client.selectRequestOption("a1", 2);
    await client.approveRequest("a1");
    await client.denyRequest("a1");
    await client.dismissRequest("a1");

    expect(requests.slice(1)).toEqual([
      { id: 2, method: "agent.prompt", params: { target: "a1", text: "2" } },
      { id: 3, method: "agent.list", params: {} },
      { id: 4, method: "agent.prompt", params: { target: "a1", text: "approve" } },
      { id: 5, method: "agent.list", params: {} },
      { id: 6, method: "agent.prompt", params: { target: "a1", text: "deny" } },
      { id: 7, method: "agent.list", params: {} },
      { id: 8, method: "agent.send_keys", params: { target: "a1", keys: ["esc"] } },
    ]);
  });

  test("extracts bounded numeric options from structured blocked-agent metadata and enforces them", async () => {
    const { client, requests } = fakeClient({
      "agent.list": {
        agents: [{
          id: "a1",
          agent: "coding",
          agent_status: "blocked",
          message: JSON.stringify({ prompt: "choose", options: [1, 3] }),
          metadata: { options: [1, 3] },
        }],
      },
      "agent.prompt": { ok: true },
    });

    await expect(client.listRequests()).resolves.toEqual([{
      requestId: "a1",
      agentId: "a1",
      status: "blocked",
      message: JSON.stringify({ prompt: "choose", options: [1, 3] }),
      options: [1, 3],
    }]);
    await expect(client.selectRequestOption("a1", 2)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(client.selectRequestOption("a1", 3)).resolves.toEqual({ ok: true });
    expect(requests.at(-1)).toEqual({ id: 4, method: "agent.prompt", params: { target: "a1", text: "3" } });
  });

  test.each([0, 100, -1, 1.5])("rejects direct numeric option %s", async (option) => {
    const { client, requests } = fakeClient({ "agent.list": { agents: [{ id: "a1", agent: "coding", agent_status: "blocked" }] } });
    await expect(client.selectRequestOption("a1", option)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(requests).toEqual([]);
  });

  test("rejects an unknown non-empty ID before operation", async () => {
    const { client } = fakeClient({ "agent.list": { agents: [{ id: "a1", agent_status: "idle" }] } });
    await expect(client.readAgent("missing")).rejects.toMatchObject({ code: "UNKNOWN_AGENT", message: "HERDR agent not found" });
  });

  test("rejects an unknown request ID before sending a structured request action", async () => {
    const { client, requests } = fakeClient({ "agent.list": { agents: [{ id: "a1", agent_status: "blocked" }] } });

    await expect(client.selectRequestOption("missing", 2)).rejects.toMatchObject({
      code: "UNKNOWN_REQUEST",
      message: "HERDR request not found",
    });
    expect(requests).toEqual([{ id: 1, method: "agent.list", params: {} }]);
  });

  test("dismissRequest ignores caller-supplied keys after blocked validation", async () => {
    const { client, requests } = fakeClient({
      "agent.list": { agents: [{ id: "a1", agent_status: "blocked" }] },
      "agent.send_keys": { ok: true },
    });
    await Reflect.apply(client.dismissRequest, client, ["a1", ["ctrl+c"]]);
    expect(requests).toEqual([
      { id: 1, method: "agent.list", params: {} },
      { id: 2, method: "agent.send_keys", params: { target: "a1", keys: ["esc"] } },
    ]);
    expect(client.dismissRequest.length).toBe(1);
  });

  test("sanitizes HERDR errors and malformed responses", async () => {
    const malicious = new HerdrClient({
      send: async () => JSON.stringify({ id: 1, error: { code: "SECRET", message: "/tmp/secret token=abc" } }),
    });
    await expect(malicious.listAgents()).rejects.toMatchObject({ code: "HERDR_ERROR", message: "HERDR request failed" });

    const malformed = new HerdrClient({ send: async () => "not-json" });
    await expect(malformed.listAgents()).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: "HERDR returned an invalid response" });

    const badShape = new HerdrClient({ send: async () => JSON.stringify({ id: 1, result: { agents: "nope" } }) });
    await expect(badShape.listAgents()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    for (const response of [
      { id: 1 },
      { id: 1, error: null },
      { id: 1, error: "failed" },
      { id: 1, error: { code: "FAILED" }, result: { agents: [] } },
    ]) {
      const invalid = new HerdrClient({ send: async () => JSON.stringify(response) });
      await expect(invalid.listAgents()).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: "HERDR returned an invalid response" });
    }
  });

  test("times out a socket that does not respond", async () => {
    const socketPath = path.join("/tmp", `herdr-timeout-${process.pid}.sock`);
    await unlink(socketPath).catch(() => undefined);
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const previousSocketPath = process.env.HERDR_SOCKET_PATH;
    try {
      process.env.HERDR_SOCKET_PATH = socketPath;
      const client = new HerdrClient({ timeoutMs: 20 });
      await expect(client.listAgents()).rejects.toMatchObject({ code: "SOCKET_TIMEOUT", message: "HERDR socket request timed out" });
    } finally {
      if (previousSocketPath === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = previousSocketPath;
      server.close();
      await unlink(socketPath).catch(() => undefined);
    }
  });

  test("reports a missing socket path as a typed HERDR availability error", async () => {
    const previousSocketPath = process.env.HERDR_SOCKET_PATH;
    delete process.env.HERDR_SOCKET_PATH;
    try {
      await expect(new HerdrClient().listAgents()).rejects.toMatchObject({
        code: "HERDR_UNAVAILABLE",
        message: "HERDR socket path is not configured",
      });
    } finally {
      if (previousSocketPath === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = previousSocketPath;
    }
  });

  test("does not expose arbitrary HERDR methods or socket paths", () => {
    const client = new HerdrClient({ send: async () => JSON.stringify({ id: 1, result: {} }) });
    expect("call" in client).toBe(false);
    // @ts-expect-error socketPath is intentionally not part of the public API.
    new HerdrClient({ socketPath: "/tmp/attacker.sock" });
  });
});
