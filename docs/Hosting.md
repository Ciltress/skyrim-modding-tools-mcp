# Hosting: stdio, Streamable HTTP and Docker

How to run this server, for whoever operates it. The code is [`src/server.ts`](../src/server.ts)
(`run()` and `runHttp()`) and [`src/lib/http.ts`](../src/lib/http.ts).

## 1. Two transports

| | stdio (default) | Streamable HTTP (`MCP_TRANSPORT=http`) |
| --- | --- | --- |
| Started by | the MCP client, one process per client | an operator, one long-lived process |
| Serves | one user | many, each with their own session |
| Credential | the environment of the process | each caller's own bearer token |
| Connects the backend | eagerly, at startup | once per MCP session, on `initialize` |

### 1.1 stdio

The client starts `node dist/index.js` and speaks MCP over its stdin and stdout. The server connects
the backend **before** the transport, so a wrong credential or an unreachable backend fails at startup
with a diagnosis on stderr rather than on the first tool call.

**stdout is the protocol channel.** Anything written there that is not a protocol frame corrupts the
stream for every tool at once — so the logger writes to stderr, dotenv is loaded `quiet`, and
`npm run smoke` fails the build if anything else reaches stdout.

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["C:/path/to/mcp-template/dist/index.js"],
      "env": { "MCP_PROFILE": "all" }
    }
  }
}
```

The client's `env` block wins over `.env`.

### 1.2 Streamable HTTP

`MCP_TRANSPORT=http` serves the SDK's Streamable HTTP transport at `/mcp`. HTTP changes *who
connects*, not what a session can do: every caller authenticates with **its own bearer token**, sent
as `Authorization: Bearer <token>`. That token becomes that session's identity towards the backend —
`createBackend(env, { bearerToken })` builds one backend per session — so two people connecting at
once get two independent sessions, never one shared credential.

```json
{
  "mcpServers": {
    "my-server": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

| Variable | Effect |
| --- | --- |
| `MCP_TRANSPORT=http` | Switches from stdio to Streamable HTTP. |
| `MCP_HTTP_PORT` | Port to listen on. Default `3000`. |
| `MCP_HTTP_HOST` | Address to bind. Default `0.0.0.0`; `127.0.0.1` serves this machine only. |
| `MCP_HTTP_ALLOWED_ORIGINS` | Browser origins allowed to call `/mcp`, comma-separated; `*` allows any. Empty (default) serves none. |
| `MCP_HTTP_ALLOWED_HOSTS` | `Host` values answered to, comma-separated. Empty (default) accepts any. |
| `MCP_HTTP_RATE_LIMIT` | Requests per minute per session. `0` (default) is off. |

<!-- TEMPLATE: how your backend validates the token. The example backend accepts the tokens named in
     EXAMPLE_ACCEPTED_TOKENS and refuses everything when it is unset; a real backend forwards the token
     to the API it wraps, which is the authority on whether it is valid. -->

The example backend accepts exactly the tokens listed in `EXAMPLE_ACCEPTED_TOKENS`, and **nobody** when
it is unset. A real backend should forward the caller's token to the API it wraps and let that API
decide — the server holds no credential of its own in HTTP mode.

## 2. The gates in front of a session

In this order, each before the next is reached:

1. **Origin allow-list.** A browser page on any origin can make the browser resolve a name it
   controls to `127.0.0.1` and post to whatever listens there — DNS rebinding. Binding to loopback is
   therefore not an access control, and a reverse proxy cannot help because the request never passes
   through it. What the page cannot forge is the `Origin` header, so that is checked: a request with
   an `Origin` not in `MCP_HTTP_ALLOWED_ORIGINS` gets `403`. Requests with **no** `Origin` pass —
   those are every MCP client that is not a web page. An allowed origin is echoed in
   `Access-Control-Allow-Origin` (never `*`, which a browser refuses on credentialed requests), and
   `OPTIONS` preflights are answered before the rate limit.
2. **Host allow-list.** Defence in depth for the rebinding case where the attacker's name, not
   yours, resolved to this server: `MCP_HTTP_ALLOWED_HOSTS` names the hosts it answers to, with any
   port. Leave it empty behind a proxy that already rewrites `Host`.
3. **Rate limit.** A token bucket per session — one agent in a loop looks exactly like healthy
   traffic from the front and can take a shared backend down for everyone. Not a replacement for the
   proxy's limit, which sees addresses rather than sessions. Over it: `429` with `Retry-After`.
4. **Credential.** No bearer token on `initialize`: `401` before any backend traffic. A token the
   backend refuses: `401` with the backend's own message.

### 2.1 A session is bound to its token

A session id is a routing key, not a credential — the MCP specification says not to authenticate by
it. Every request of a session must present the same bearer token that opened it; another token, or
none, is refused with `401`. Only a digest of the token is kept.

### 2.2 TLS

Terminate TLS in front of the server — a reverse proxy or an ingress — as for any internal HTTP
service. Bearer tokens must not cross a network in clear text.

## 3. Docker

```bash
docker build -t mcp-template .

# stdio: the client runs the container and talks to it over stdin/stdout
docker run -i --rm mcp-template

# HTTP: a long-lived service
docker run --rm -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
  -e EXAMPLE_ACCEPTED_TOKENS=change-me \
  mcp-template
```

[`docker-compose.yml`](../docker-compose.yml) runs the HTTP form. The image copies `docs/`, `skills/`
and `AGENTS.md` beside `dist/` on purpose: guides and skills are read from disk at runtime, and an
image without them answers every `readServerGuide`, `readSkill` and resource read with a
file-not-found while looking perfectly healthy otherwise. `skills/Development` is a git submodule —
build from a `--recurse-submodules` clone or the image ships without it.

Configuration belongs in `docker run --env-file` or the client's `env` block, never in a layer:
`.dockerignore` keeps `.env` and key material out of the build context.
