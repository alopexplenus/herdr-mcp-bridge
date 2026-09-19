# HERDR MCP Bridge

This service exposes a constrained MCP Streamable HTTP endpoint backed by the local HERDR socket.

> **Experimental and single-user:** This project is intended for personal, trusted-local use. The bridge accepts MCP requests only from its configured trusted Nginx peer.

## Start

Build and start the service with `npm run build && npm run start`. The process loads its configuration from the environment, binds exactly to `HERDR_LISTEN_HOST` and `HERDR_LISTEN_PORT`, and closes the HTTP server on `SIGINT` or `SIGTERM`.

Install dependencies first with `npm install`. Node.js 22 or later is required.

## Configuration

- `HERDR_ALLOWED_PEER_ADDRESS` is required and must be the exact Tailscale address of the trusted Nginx peer.
- `HERDR_PROJECTS_ROOT` defaults to `~/projects` and must remain inside `HOME`.
- `HERDR_LISTEN_HOST` defaults to `127.0.0.1`.
- `HERDR_LISTEN_PORT` defaults to `8787`.
- `HERDR_MAX_READ_BYTES` defaults to `65536`.
- HERDR responses are capped at `min(HERDR_MAX_READ_BYTES + 65536, 1048576)` bytes.
- `HERDR_COMMAND` defaults to `herdr`.
- `HERDR_SOCKET_PATH` identifies the running HERDR Unix socket and is required when a tool is called.

The HERDR user and bridge process must have access to the same running HERDR socket. The bridge does not launch or manage HERDR.

For local use, keep `HERDR_LISTEN_HOST` set to its default `127.0.0.1`. If the service is placed behind a reverse proxy or made reachable beyond the local machine, use HTTPS and protect the entire deployment with appropriate network controls. Do not send the client secret or bearer tokens over plain HTTP.

## Endpoints

- `GET /health` returns `{ "status": "ok" }` and does not query or expose agent data.
- `GET /health` is available for private service checks.
- `POST /mcp` accepts MCP Streamable HTTP only from the configured peer.

The bridge does not implement OAuth. Cloudflare Access authenticates the public client connection, Nginx is the only trusted peer, and the bridge enforces the peer boundary on the private Tailscale hop.

## Supported tools

`list_projects`, `list_agents`, `read_agent`, `list_requests`, `select_request_option`, `approve_request`, `deny_request`, `dismiss_request`, and `prompt_agent`.

Agent reads and prompt text are bounded. Request actions validate IDs and blocked-request state through HERDR. Request option selection accepts only numeric options `1` through `99`, and when HERDR supplies a structured option list, the selected value must be listed. Approve, deny, and dismiss always send the fixed `approve`, `deny`, and `esc` actions.
