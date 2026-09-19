import net from "node:net";

export interface AgentSummary {
  id: string;
  name: string;
  projectId: string;
  type: string;
  status: string;
  waitingForInput: boolean;
  bridgeUptimeSeconds: number;
  message?: string;
  metadata?: Record<string, string>;
  options?: number[];
}

export interface HerdrClientOptions {
  send?: (line: string) => Promise<string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class HerdrError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HerdrError";
    this.code = code;
  }
}

type HerdrResponse = { id: number | string; result?: unknown; error?: unknown };

const METHOD_NAMES = {
  listAgents: "agent.list",
  readAgent: "agent.read",
  promptAgent: "agent.prompt",
  sendKeys: "agent.send_keys",
} as const;

function socketRequest(socketPath: string, line: string, timeoutMs: number, maxResponseBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setTimeout(timeoutMs);
    let buffer = "";
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(buffer.trim());
    };
    timer = setTimeout(() => finish(new HerdrError("SOCKET_TIMEOUT", "HERDR socket request timed out")), timeoutMs);

    socket.once("error", (error) => finish(new HerdrError("SOCKET_ERROR", "HERDR socket unavailable")));
    socket.once("timeout", () => finish(new HerdrError("SOCKET_TIMEOUT", "HERDR socket request timed out")));
    socket.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(buffer, "utf8") + chunk.byteLength > maxResponseBytes) {
        finish(new HerdrError("RESPONSE_TOO_LARGE", "HERDR response exceeded the configured limit"));
        return;
      }
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline >= 0) finish();
    });
    socket.once("close", () => {
      if (!settled) finish(new HerdrError("SOCKET_CLOSED", "HERDR socket closed without a response"));
    });
    socket.once("connect", () => socket.end(`${line}\n`));
  });
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string") throw new HerdrError("INVALID_ARGUMENT", "HERDR argument is invalid");
  if (!value.trim()) throw new HerdrError("INVALID_ARGUMENT", `${label} must not be empty`);
  return value;
}

export class HerdrClient {
  private nextId = 1;
  private readonly send: (line: string) => Promise<string>;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly startedAt = Date.now();

  constructor(options: HerdrClientOptions = {}) {
    if (options.send) {
      this.send = options.send;
      this.timeoutMs = options.timeoutMs ?? 5000;
      this.maxResponseBytes = options.maxResponseBytes ?? 1048576;
      return;
    }
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1048576;
    this.send = async (line) => {
      const socketPath = process.env.HERDR_SOCKET_PATH;
      if (!socketPath) throw new HerdrError("HERDR_UNAVAILABLE", "HERDR socket path is not configured");
      return socketRequest(socketPath, line, this.timeoutMs, this.maxResponseBytes);
    };
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = String(this.nextId++);
    let response: unknown;
    try {
      let timer: NodeJS.Timeout;
      const responseText = await Promise.race([
        this.send(JSON.stringify({ id, method, params })),
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new HerdrError("SOCKET_TIMEOUT", "HERDR socket request timed out")), this.timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (Buffer.byteLength(responseText, "utf8") > this.maxResponseBytes) {
        throw new HerdrError("RESPONSE_TOO_LARGE", "HERDR response exceeded the configured limit");
      }
      response = JSON.parse(responseText);
    } catch (error) {
      if (error instanceof HerdrError) throw error;
      throw new HerdrError("INVALID_RESPONSE", "HERDR returned an invalid response");
    }
    if (!isResponse(response) || (typeof response.id === "number" ? response.id !== Number(id) : response.id !== id && !response.id.startsWith("cli:"))) {
      throw new HerdrError("INVALID_RESPONSE", "HERDR returned an invalid response");
    }
    if (response.error !== undefined && response.error !== null && isRecord(response.error) && "code" in response.error) {
      throw new HerdrError("HERDR_ERROR", "HERDR request failed");
    }
    return response.result;
  }

  async listAgents(): Promise<AgentSummary[]> {
    const result = await this.#request(METHOD_NAMES.listAgents, {});
    if (!isRecord(result) || !Array.isArray(result.agents)) {
      throw new HerdrError("INVALID_RESPONSE", "HERDR returned an invalid response");
    }
    return result.agents.map((agent) => parseAgent(agent, Math.floor((Date.now() - this.startedAt) / 1000)));
  }

  async readAgent(agentId: string): Promise<unknown> {
    const target = await this.#agentTarget(agentId);
    const result = await this.#request(METHOD_NAMES.readAgent, { target, source: "recent", format: "text" });
    if (isRecord(result) && isRecord(result.read) && typeof result.read.text === "string") return result.read.text;
    return result;
  }

  async listRequests(): Promise<Array<Record<string, unknown>>> {
    return (await this.listAgents())
      .filter((agent) => agent.status === "blocked")
      .map((agent) => ({
        requestId: agent.id,
        agentId: agent.id,
        status: agent.status,
        ...(agent.message ? { message: agent.message } : {}),
        ...(agent.options ? { options: agent.options } : {}),
      }));
  }

  async selectRequestOption(requestId: string, option: number): Promise<unknown> {
    if (!Number.isInteger(option) || option < 1 || option > 99) throw new HerdrError("INVALID_ARGUMENT", "option must be an integer from 1 through 99");
    const agent = await this.#blockedTarget(requestId);
    if (agent.options && !agent.options.includes(option)) throw new HerdrError("INVALID_ARGUMENT", "option is not available for this request");
    const target = agent.id;
    return this.#request(METHOD_NAMES.promptAgent, { target, text: String(option) });
  }

  async approveRequest(requestId: string): Promise<unknown> {
    return this.#request(METHOD_NAMES.promptAgent, { target: (await this.#blockedTarget(requestId)).id, text: "approve" });
  }

  async denyRequest(requestId: string): Promise<unknown> {
    return this.#request(METHOD_NAMES.promptAgent, { target: (await this.#blockedTarget(requestId)).id, text: "deny" });
  }

  async dismissRequest(requestId: string): Promise<unknown> {
    return this.#request(METHOD_NAMES.sendKeys, { target: (await this.#blockedTarget(requestId)).id, keys: ["esc"] });
  }

  async promptAgent(agentId: string, text: string): Promise<unknown> {
    return this.#request(METHOD_NAMES.promptAgent, { target: await this.#agentTarget(agentId), text });
  }

  async #agentTarget(id: string): Promise<string> {
    const target = nonEmpty(id, "agentId");
    if (!(await this.listAgents()).some((agent) => agent.id === target)) {
      throw new HerdrError("UNKNOWN_AGENT", "HERDR agent not found");
    }
    return target;
  }

  async #blockedTarget(id: string): Promise<AgentSummary> {
    const target = nonEmpty(id, "requestId");
    const agent = (await this.listAgents()).find((candidate) => candidate.id === target);
    if (!agent) throw new HerdrError("UNKNOWN_REQUEST", "HERDR request not found");
    if (agent.status !== "blocked") throw new HerdrError("REQUEST_NOT_BLOCKED", "HERDR request is not blocked");
    return agent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResponse(value: unknown): value is HerdrResponse {
  if (!isRecord(value) || !(Number.isInteger(value.id) || typeof value.id === "string")) return false;
  const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  const hasResult = Object.prototype.hasOwnProperty.call(value, "result");
  return hasError ? isRecord(value.error) && !hasResult : hasResult;
}

function parseAgent(value: unknown, bridgeUptimeSeconds: number): AgentSummary {
  if (!isRecord(value) || (typeof value.id !== "string" && typeof value.pane_id !== "string") || typeof value.agent_status !== "string") {
    throw new HerdrError("INVALID_RESPONSE", "HERDR returned an invalid response");
  }
  const id = typeof value.id === "string" ? value.id : value.pane_id as string;
  const projectId = typeof value.project_id === "string" ? value.project_id : typeof value.projectId === "string" ? value.projectId : typeof value.workspace_id === "string" ? value.workspace_id : "";
  const type = typeof value.agent === "string" ? value.agent : typeof value.agent_type === "string" ? value.agent_type : typeof value.type === "string" ? value.type : "unknown";
  const waitingForInput = typeof value.waiting_for_input === "boolean" ? value.waiting_for_input : typeof value.waitingForInput === "boolean" ? value.waitingForInput : value.agent_status === "blocked";
  const message = typeof value.message === "string" ? value.message : undefined;
  const metadata: Record<string, string> | undefined = isRecord(value.metadata)
    ? Object.entries(value.metadata).filter(([key, item]) => key.length <= 64 && typeof item === "string" && item.length <= 256).slice(0, 16)
      .reduce<Record<string, string>>((result, [key, item]) => {
        if (typeof item === "string") result[key] = item;
        return result;
      }, {})
    : undefined;
  const name = typeof value.name === "string" ? value.name : id;
  const options = parseOptions(value.options) ?? parseOptions(isRecord(value.metadata) ? value.metadata.options : undefined) ?? parseMessageOptions(value.message);
  return { id, name, type, projectId, status: value.agent_status, waitingForInput, bridgeUptimeSeconds, ...(message ? { message } : {}), ...(metadata && Object.keys(metadata).length ? { metadata } : {}), ...(options ? { options } : {}) };
}

function parseMessageOptions(message: unknown): number[] | undefined {
  if (isRecord(message)) return parseOptions(message.options);
  if (typeof message !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(message);
    return isRecord(parsed) ? parseOptions(parsed.options) : undefined;
  } catch {
    return undefined;
  }
}

function parseOptions(value: unknown): number[] | undefined {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(candidate)) return undefined;
  const options = [...new Set(candidate.filter((item): item is number => Number.isInteger(item) && item >= 1 && item <= 99))].slice(0, 99);
  return options.length ? options : undefined;
}
