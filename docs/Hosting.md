# Hosting: stdio and Streamable HTTP

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
    "skyrim": {
      "command": "node",
      "args": ["C:/path/to/skyrim-modding-tools-mcp/dist/index.js"],
      "env": { "SKYRIM_MO2_INSTANCE": "G:/Modding/SkyrimSE-Test" }
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

The server accepts exactly the tokens listed in `SKYRIM_ACCEPTED_TOKENS`, and **nobody** when it is
unset. There is no remote API behind it to ask: the backend is a Mod Organizer instance on this
machine, so the token list is the whole authority. Every session shares one plugin helper and one
load order — the instance is one instance, whoever asks.

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

## 3. Where it runs

On the Windows machine that holds the Mod Organizer instance, beside the game. It reads the
instance's files, the game's plugins and the Creation Kit's compiler from disk, and runs the .NET
plugin helper next to itself — none of which a container can reach. There is therefore no image.

HTTP mode is for a client on the same machine that prefers a long-lived server to one it starts
itself — an editor extension, say. Bind it to `127.0.0.1` (`MCP_HTTP_HOST`) unless it really must
be reached from elsewhere, and then put TLS in front of it.
