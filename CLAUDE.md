# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A TypeScript (Node >= 22, ESM) service that exposes a constrained MCP Streamable HTTP endpoint (`POST /mcp`, plus `GET /health`) backed by a running HERDR process's Unix socket. It is for a single trusted user. It does not launch or manage HERDR, and it has no TLS or OAuth of its own. Remote clients (e.g. Claude Mobile) reach it through an external HTTPS/OAuth proxy, whose address is set in `HERDR_ALLOWED_PEER_ADDRESS`. Environment variables are documented in README.md.

## Commands

```sh
npm run build                         # tsc -> dist/ (includes tests; entry is dist/src/main.js)
npm run check                         # type-check only
npm test                              # vitest run
npx vitest run tests/tools.test.ts    # single file
npx vitest run -t "allows requests"   # single test by name
npm start                             # loads .env if present (cp .env.example .env)
```

`HERDR_ALLOWED_PEER_ADDRESS` is required at startup even for local-only use.

## Architecture

Request flow: `main.ts` → `server.ts` (HTTP + auth + pre-validation) → `tools.ts` (MCP tool registration) → `herdr-client.ts` (newline-delimited JSON-RPC over the HERDR socket).

- **`tool-contract.ts`** is the single source of the tool names and zod input schemas. Arguments are validated twice. `server.ts#invalidToolCall` checks `tools/call` bodies *before* the MCP SDK sees them and returns a tool-error result itself. For no-argument tools it also injects `arguments: {}` when they are missing. `tools.ts#register` then re-validates with `safeParse`.
- **Auth** (`server.ts#authorized`): loopback addresses are always allowed. Otherwise the socket's remote address must equal `allowedPeerAddress` (or its `::ffff:` form). No headers or tokens are checked.
- **Sessions**: one `McpServer` + `StreamableHTTPServerTransport` per MCP session, kept in an in-memory map keyed by `mcp-session-id`. `closeBridgeServer` closes them all.
- **Errors**: handlers throw `HerdrError(code, message)`. `register` turns these into `{isError, content:[{text: JSON{code,message}}]}`, and any other error becomes a generic `INTERNAL_ERROR`. Don't let raw HERDR responses leak through error messages.
- **HERDR client**:
  - Each call opens a new socket connection, writes one JSON line, and reads until the first newline. Responses are size-capped by `maxResponseBytes`.
  - HERDR methods used: `agent.list`, `agent.read`, `agent.prompt`, `agent.send_keys`.
  - `parseAgent` normalizes several alternative field spellings (`id`/`pane_id`, `project_id`/`projectId`/`workspace_id`, topic in metadata, and so on) into `AgentSummary`.
- **"Requests" are not a separate HERDR concept.** A request is an agent with `status === "blocked"`, and `requestId` is the agent ID. approve/deny/select send text via `agent.prompt` (`"approve"`, `"deny"`, `"<n>"`). dismiss sends the `esc` key. Every action first re-lists agents to check that the target exists and is blocked.
- **`project-discovery.ts`** lists the directories under `projectsRoot` and matches agents to them by `agent.projectId === dirName`. `HERDR_PROJECTS_ROOT` has no default: when it is unset, `list_projects` fails with `PROJECTS_NOT_CONFIGURED` rather than listing anything. There is no location restriction on the root, only the requirement that it be set explicitly.

## Gotchas

- `HerdrClient` reads `HERDR_SOCKET_PATH` from `process.env` on each call, not from `BridgeConfig`. This is deliberate: a test asserts that `socketPath` is not a constructor option.
- Adding a tool means touching several places: `TOOL_NAMES`, `toolContracts`, and possibly `NO_ARGUMENT_TOOL_NAMES` in `tool-contract.ts`; `ToolClient`, `createToolHandlers`, and `createMcpServer` in `tools.ts`; a method on `HerdrClient`; the fake clients in the tests (e.g. `tests/server.test.ts`); and the tool list in README.md.
- Tests inject a fake transport via `new HerdrClient({ send })` or a fake `ToolClient`. They never need a real HERDR socket.
- Imports use `.js` extensions (NodeNext resolution).
