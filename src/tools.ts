import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HerdrError, type HerdrClient } from "./herdr-client.js";
import { discoverProjects } from "./project-discovery.js";
import type { BridgeConfig } from "./config.js";
import { toolContracts } from "./tool-contract.js";

export interface ToolClient {
  listAgents: HerdrClient["listAgents"];
  readAgent: HerdrClient["readAgent"];
  listRequests: HerdrClient["listRequests"];
  selectRequestOption: (requestId: string, option: number) => Promise<unknown>;
  approveRequest: HerdrClient["approveRequest"];
  denyRequest: HerdrClient["denyRequest"];
  dismissRequest: HerdrClient["dismissRequest"];
  promptAgent: HerdrClient["promptAgent"];
  waitForAgent: HerdrClient["waitForAgent"];
}

export function createToolHandlers(client: ToolClient, config: BridgeConfig) {
  return {
    list_projects: async () => discoverProjects(config.projectsRoot, await client.listAgents()),
    list_agents: () => client.listAgents(),
    read_agent: async ({ agentId }: { agentId: string }) => boundedRead(agentId, await client.readAgent(agentId), config.maxReadBytes),
    list_requests: () => client.listRequests(),
    select_request_option: ({ requestId, option }: { requestId: string; option: number }) => client.selectRequestOption(requestId, option),
    approve_request: ({ requestId }: { requestId: string }) => client.approveRequest(requestId),
    deny_request: ({ requestId }: { requestId: string }) => client.denyRequest(requestId),
    dismiss_request: ({ requestId }: { requestId: string }) => client.dismissRequest(requestId),
    prompt_agent: ({ agentId, text }: { agentId: string; text: string }) => client.promptAgent(agentId, text),
    wait_for_agent: ({ agentId, status, timeoutMs, pollIntervalMs }: { agentId: string; status: string; timeoutMs?: number; pollIntervalMs?: number }) => client.waitForAgent(agentId, status, timeoutMs, pollIntervalMs),
  };
}

export function createMcpServer(client: ToolClient, config: BridgeConfig): McpServer {
  const server = new McpServer({ name: "herdr-mcp-bridge", version: "0.1.0" });
  const handlers = createToolHandlers(client, config);
  register(server, "list_projects", "List discovered projects and their agents.", toolContracts.list_projects, handlers.list_projects);
  register(server, "list_agents", "List available HERDR agents.", toolContracts.list_agents, handlers.list_agents);
  register(server, "read_agent", "Read bounded output from an existing agent.", toolContracts.read_agent, handlers.read_agent);
  register(server, "list_requests", "List blocked HERDR requests.", toolContracts.list_requests, handlers.list_requests);
  register(server, "select_request_option", "Select an option on a blocked request.", toolContracts.select_request_option, handlers.select_request_option);
  register(server, "approve_request", "Approve a blocked request.", toolContracts.approve_request, handlers.approve_request);
  register(server, "deny_request", "Deny a blocked request.", toolContracts.deny_request, handlers.deny_request);
  register(server, "dismiss_request", "Dismiss a blocked request.", toolContracts.dismiss_request, handlers.dismiss_request);
  register(server, "prompt_agent", "Send bounded prompt text to an existing agent.", toolContracts.prompt_agent, handlers.prompt_agent);
  register(server, "wait_for_agent", "Wait for an agent to reach a requested status.", toolContracts.wait_for_agent, handlers.wait_for_agent);
  return server;
}

function register(
  server: McpServer,
  name: string,
  description: string,
  contract: any,
  handler: (args: any) => unknown,
) {
  server.registerTool(name, { description, inputSchema: contract } as any, async (args: any): Promise<any> => {
    try {
      const parsed = contract.safeParse(args);
      if (!parsed.success) {
        return validationError(name);
      }
      const result = await handler(parsed.data as never);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const safe = error instanceof HerdrError ? { code: error.code, message: error.message } : { code: "INTERNAL_ERROR", message: "HERDR operation failed" };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(safe) }] };
    }
  });
}

function validationError(name: string) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code: "INVALID_INPUT", message: `Invalid arguments for tool ${name}` }) }],
  };
}

function boundedRead(agentId: string, value: unknown, maxBytes: number): { agentId: string; output: string; truncated: boolean } {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = Buffer.from(serialized, "utf8");
  if (bytes.byteLength <= maxBytes) return { agentId, output: serialized, truncated: false };
  let output = bytes.subarray(0, maxBytes).toString("utf8");
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, -1);
  }
  return { agentId, output, truncated: true };
}
