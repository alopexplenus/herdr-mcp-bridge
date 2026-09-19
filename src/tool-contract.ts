import { z } from "zod";

const id = z.string().trim().min(1);
const noArguments = z.object({}).strict();
const requestId = { requestId: id };

export const TOOL_NAMES = [
  "list_projects",
  "list_agents",
  "read_agent",
  "list_requests",
  "select_request_option",
  "approve_request",
  "deny_request",
  "dismiss_request",
  "prompt_agent",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const NO_ARGUMENT_TOOL_NAMES = new Set<ToolName>([
  "list_projects",
  "list_agents",
  "list_requests",
]);

export const toolContracts = {
  list_projects: noArguments,
  list_agents: noArguments,
  read_agent: z.object({ agentId: id }).strict(),
  list_requests: noArguments,
  select_request_option: z.object({ ...requestId, option: z.number().int().min(1).max(99) }).strict(),
  approve_request: z.object(requestId).strict(),
  deny_request: z.object(requestId).strict(),
  dismiss_request: z.object(requestId).strict(),
  prompt_agent: z.object({ agentId: id, text: z.string().trim().min(1).max(4000) }).strict(),
} as const;
