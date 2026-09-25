# HERDR MCP Bridge

This service exposes a constrained MCP Streamable HTTP endpoint backed by the local HERDR socket. It is intended for a single trusted user and does not launch or manage HERDR.

## Tested Use Cases


### 1. Local usage
Run the bridge on the same machine as HERDR. The bridge listens on loopback, while the MCP client connects to `http://127.0.0.1:8787/mcp`. The client agent can run inside HERDR itself.


```sh
npm install
npm run build

export HERDR_SOCKET_PATH=/path/to/herdr.sock
export HERDR_LISTEN_HOST=127.0.0.1
export HERDR_LISTEN_PORT=8787
npm run start

```
Configure the client's MCP server URL as:

```text
http://127.0.0.1:8787/mcp
```

`HERDR_SOCKET_PATH` must point to the socket used by the running HERDR process. The bridge accepts local requests without an additional proxy.

### 2. Claude Mobile through a public HTTPS endpoint

This is particularly useful because it lets you interact with your agentic setup in a seamless voice conversation while AFK.

Bring your own OAuth. I tested with <https://github.com/sigbit/mcp-auth-proxy>
```sh

export HERDR_ALLOWED_PEER_ADDRESS=x.x.x.x # proxy address
export HERDR_SOCKET_PATH=/path/to/herdr.sock
export HERDR_LISTEN_HOST=127.0.0.1
export HERDR_LISTEN_PORT=8787
npm run start
```

The proxy terminates HTTPS and authenticates Claude Mobile; the bridge remains private on loopback. Configure the proxy's upstream as:

```
http://x.x.x.x:8787/mcp
```

Expose the proxy's HTTPS URL to Claude Mobile, for example:

```text
https://mcp.example.com/mcp
```


Do not expose port `HERDR_LISTEN_PORT` directly to the internet. The public endpoint must use HTTPS and the proxy must protect the complete `/mcp` path. The bridge has no OAuth or TLS implementation of its own.

The process loads configuration from the environment and closes the HTTP server on `SIGINT` or `SIGTERM`.

## Configuration

- `HERDR_SOCKET_PATH` identifies the running HERDR Unix socket and is required when a tool is called.
- `HERDR_ALLOWED_PEER_ADDRESS` is required. It must be the source address of the trusted remote proxy. Localhost connections are allowed regardless of this config.
- `HERDR_PROJECTS_ROOT` defaults to `~/projects` and must remain inside `HOME`.
- `HERDR_LISTEN_HOST` defaults to `127.0.0.1`.
- `HERDR_LISTEN_PORT` defaults to `8787`.
- `HERDR_MAX_READ_BYTES` defaults to `65536`.
- `HERDR_COMMAND` defaults to `herdr`.

HERDR and the bridge process must have access to the same running HERDR socket. HERDR responses are capped at `min(HERDR_MAX_READ_BYTES + 65536, 1048576)` bytes.

## Endpoints

- `GET /health` returns a private service health response and does not query agent data.
- `POST /mcp` accepts MCP Streamable HTTP requests from localhost or the configured trusted peer.

## Supported Tools

`list_projects`, `list_agents`, `read_agent`, `list_requests`, `select_request_option`, `approve_request`, `deny_request`, `dismiss_request`, `prompt_agent`, and `wait_for_agent`.

Agent reads and prompt text are bounded. `wait_for_agent` polls status until the requested state or a bounded timeout. Agent summaries preserve technical IDs and include a `topic` field when HERDR supplies session-topic metadata. Request actions validate IDs and blocked-request state through HERDR. Request option selection accepts numeric options from `1` through `99`; when HERDR supplies a structured option list, the selected value must be listed.
