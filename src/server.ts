import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BridgeConfig } from "./config.js";
import { createMcpServer } from "./tools.js";
import type { ToolClient } from "./tools.js";
import { NO_ARGUMENT_TOOL_NAMES, TOOL_NAMES, toolContracts, type ToolName } from "./tool-contract.js";

export function createBridgeServer(client: ToolClient, config: BridgeConfig, log: (line: string) => void = () => undefined): http.Server {
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer> }>();
  const server = http.createServer(async (req, res) => {
    try {
      req.setTimeout(30_000);
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) }));
        return;
      }
      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (!authorized(req.socket.remoteAddress, config.allowedPeerAddress)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (req.method === "GET" && typeof req.headers["mcp-session-id"] !== "string") {
        res.writeHead(404);
        res.end();
        return;
      }

      let parsedBody: Record<string, any> | undefined;
      try {
        parsedBody = await readJsonBody(req, res);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request_body_too_large" }));
          return;
        }
        throw error;
      }
      if (parsedBody === undefined) return;
      const validation = invalidToolCall(parsedBody);
      if (validation) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsedBody.id, result: validation }));
        return;
      }

      const sessionId = req.headers["mcp-session-id"];
      let session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (!session) {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
      const mcp = createMcpServer(client, config);
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await mcp.connect(transport);
      session = { transport, server: mcp };
      if (transport.sessionId) sessions.set(transport.sessionId, session);
      }
      if (!session && req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }
      log(`mcp ${req.method} ${req.url}`);
      await session.transport.handleRequest(req, res, parsedBody);
      if (session.transport.sessionId) sessions.set(session.transport.sessionId, session);
    } catch (error) {
      log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal_server_error" }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
  server.requestTimeout = 30_000;
  shutdowns.set(server, async () => {
    await Promise.allSettled([...sessions.values()].map(({ server: mcp }) => mcp.close()));
    sessions.clear();
  });
  return server;
}

export function closeBridgeServer(server: http.Server): Promise<void> {
  return (async () => {
    await shutdowns.get(server)?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  })();
}

const shutdowns = new WeakMap<http.Server, () => Promise<void>>();

const MAX_REQUEST_BODY_BYTES = 1048576;
class BodyTooLarge extends Error {}

async function readJsonBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, any> | undefined> {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isInteger(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    throw new BodyTooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BODY_BYTES) {
      req.resume();
      throw new BodyTooLarge();
    }
    chunks.push(buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
    return body;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_json" }));
    return undefined;
  }
}

function invalidToolCall(body: Record<string, any>) {
  if (body.method !== "tools/call" || !isRecord(body.params) || typeof body.params.name !== "string") return undefined;
  const name = body.params.name;
  if (!TOOL_NAMES.includes(name as ToolName)) {
    return toolError("UNKNOWN_TOOL", `Unknown tool ${name}`);
  }

  if (!Object.prototype.hasOwnProperty.call(body.params, "arguments")) {
    if (NO_ARGUMENT_TOOL_NAMES.has(name as ToolName)) body.params.arguments = {};
    else return toolError("INVALID_INPUT", `Invalid arguments for tool ${name}`);
  }

  const args = body.params.arguments;
  const contract = toolContracts[name as ToolName];
  if (!isRecord(args) || !contract.safeParse(args).success) {
    return toolError("INVALID_INPUT", `Invalid arguments for tool ${name}`);
  }
  return undefined;
}

function toolError(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message }) }],
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authorized(remoteAddress: string | undefined, allowedPeerAddress: string): boolean {
  return remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress === "::ffff:127.0.0.1"
    || remoteAddress === allowedPeerAddress
    || remoteAddress === `::ffff:${allowedPeerAddress}`;
}
