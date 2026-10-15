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

On the machine that holds the game and the mod manager, beside them. It reads the instance's files,
the game's plugins and a Papyrus compiler from disk, and runs the .NET plugin helper next to itself
— none of which a container reaches without bind-mounting all of it at identical paths, and none can
see a running mod manager. There is therefore no image yet ([ADR-0007](adr/0007-operating-system-and-mod-manager-are-separate-seams.md)).

| System | Mod manager (`SKYRIM_MOD_MANAGER`) | Status |
| --- | --- | --- |
| Windows | Mod Organizer 2 (`mo2`, the default) | Verified against a test instance |
| Linux | Amethyst Mod Manager (`amethyst`) | Built from Amethyst 2.5.4's source and tested against its layout; first live run pending |
| Linux | Mod Organizer 2 under Proton | **Not supported yet**: its `ModOrganizer.ini` holds Windows paths that need translating |

The server picks the operating system's side by itself and the mod manager from `SKYRIM_MOD_MANAGER`;
nothing else changes between them — the same tools, the same projects.

HTTP mode is for a client on the same machine that prefers a long-lived server to one it starts
itself — an editor extension, say. Bind it to `127.0.0.1` (`MCP_HTTP_HOST`) unless it really must
be reached from elsewhere, and then put TLS in front of it.

## 4. Setting it up on Linux, with Amethyst

Once, on the machine with the game and Amethyst. Package names are Arch's (CachyOS).

1. **Tools**: `sudo pacman -S nodejs npm dotnet-sdk git git-lfs` — Node 24 or newer, and the .NET 10
   SDK, which brings ICU; the plugin helper does not start without it.
2. **The server**:
   ```bash
   git clone <repository> ~/skyrim-modding-tools-mcp && cd ~/skyrim-modding-tools-mcp
   npm install && npm run build:helper && npm run build && npm run check:helper
   ```
3. **Vanilla script sources**, for projects with Papyrus scripts: install *Skyrim Special Edition:
   Creation Kit* in Steam, which puts `Scripts.zip` into the game's `Data`. With nothing deployed in
   Amethyst (Restore), unpack it there: `cd "<game>/Data" && unzip -n Scripts.zip`. Unpacked while a
   profile is deployed, Amethyst would count the files as the game's runtime output and move them to
   its overwrite folder at the next restore.
4. **A Papyrus compiler**: the Creation Kit's is a Windows program. Unpack
   `papyrus-compiler-ubuntu.tar.gz` from [russo-2025/papyrus-compiler](https://github.com/russo-2025/papyrus-compiler/releases)
   — say to `~/tools/papyrus-compiler` — and name its executable in `SKYRIM_PAPYRUS_COMPILER`. In rare
   cases its output differs from the Creation Kit's byte for byte, not in behaviour
   ([research](research/2026-10-15-linux-mo2-and-platform.md) §7).
5. **The client** — Claude Code, for one:
   ```bash
   claude mcp add skyrim -e SKYRIM_MOD_MANAGER=amethyst \
     -e SKYRIM_PAPYRUS_COMPILER=$HOME/tools/papyrus-compiler/papyrus-compiler \
     -- node $HOME/skyrim-modding-tools-mcp/dist/index.js
   ```

The server finds Amethyst's settings by itself — the Flatpak's under
`~/.var/app/io.github.Amethyst.ModManager/config/AmethystModManager`, a native install's under
`~/.config/AmethystModManager` (`SKYRIM_AMETHYST_DIR` for anywhere else) — and follows the profile
selected in Amethyst. `healthcheck` shows what it found.

**Amethyst open or closed.** `deployProject` writes the mod and its plugin into Amethyst's profile,
adding only lines Amethyst has not seen, which it keeps. Then:

- with Amethyst **closed**, the server runs Amethyst's own deploy
  (`flatpak run --command=amethyst-mod-manager-cli io.github.Amethyst.ModManager deploy 489830 <profile>`),
  which restores and redeploys the whole profile;
- with Amethyst **open**, the answer asks for **Refresh**, then **Deploy** in Amethyst — deploying
  behind its window would race it.

A redeploy writes the mod's files in place, so the hard links Amethyst put into `Data` show the new
plugin at once; a file that is new to the mod needs a Deploy.

**Creation Kit work.** The Creation Kit runs in the game's Proton prefix (Amethyst's Creation Kit
wizard) and saves into the deployed `Data`. Saved over Amethyst's link, the plugin is a file of its
own there: `deployProject` refuses to overwrite it, `pullProject` reads it back into the project, and
the next deploy removes it so it no longer hides the mod's.

**The first run on a setup someone plays** goes into a throwaway Amethyst profile (say `mcp-test`)
with a throwaway project. Amethyst's deploy switches the game's `Data` to that profile; afterwards,
select the usual profile and press Deploy once.

**Local models through Ollama.** Below 24 GiB of video memory Ollama defaults to a 4k-token context,
too small for any agent: set `OLLAMA_CONTEXT_LENGTH` (131072 for 128k). Claude Code pointed at Ollama
loads every tool up front; `MCP_PROFILE=core` lists fewer.
