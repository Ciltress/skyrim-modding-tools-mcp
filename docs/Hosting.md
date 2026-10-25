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

**Setting it up.** `npm run setup` does all of this — installs, builds, writes `.env`, registers
the server with Claude Code, Claude Desktop and VS Code ([README](../README.md#setup)). By hand,
the settings go into `.env` in the server's folder, and a client's registration says only how to
start the server — no settings in it. (A client's `env` block would still win over `.env`.)

The settings, run in the server's folder. With Amethyst there are none: the server finds it. With Mod
Organizer, its instance folder — on Windows, in PowerShell:

```powershell
Add-Content .env 'SKYRIM_MO2_INSTANCE=G:\Modding\SkyrimSE-Test' -Encoding utf8
```

on Linux (Mod Organizer under Proton, §5):

```bash
echo 'SKYRIM_MO2_INSTANCE=~/Games/mo2-lint/mo2-skyrim_se-steam' >> .env
```

The Nexus tools want `NEXUS_API_KEY=<your key>` the same way. Then the client — **Claude Code**, for
every folder (`--scope user`: registered for one folder, a server is missing in all others), run in
the server's folder. In PowerShell:

```powershell
claude mcp add --scope user skyrim -- node "$PWD\dist\index.js"
```

On Linux:

```bash
claude mcp add --scope user skyrim -- node "$PWD/dist/index.js"
```

**VS Code**: *MCP: Open User Configuration* from the command palette, then add this — with the path
to your server's folder:

```json
{
  "servers": {
    "skyrim": { "type": "stdio", "command": "node", "args": ["C:/Users/you/skyrim-modding-tools-mcp/dist/index.js"] }
  }
}
```

**Claude Desktop**: *Settings → Developer → Edit Config*, then add this — the same path:

```json
{
  "mcpServers": {
    "skyrim": { "command": "node", "args": ["C:/Users/you/skyrim-modding-tools-mcp/dist/index.js"] }
  }
}
```

A JSON file is read by no shell, so `~` does not work in its `args`: on Linux write
`/home/you/skyrim-modding-tools-mcp/dist/index.js`.

**OpenClaw** reads none of a server's `instructions`, prefixes its tools and, for a local model, hides
them behind its Tool Search; the [OpenClaw plugin](https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin)
serves it the same tools under their own names, with the instructions and the skills. Its `envFile` can be
this server's `.env`. A registration of this server that an earlier setup wrote lists every tool a second
time beside it: `openclaw config unset mcp.servers.skyrim`.

**Paths in settings.** Neither `.env` nor a client's `env` block passes through a shell, so the server
reads every setting that names a file or folder — `SKYRIM_MO2_INSTANCE`, `SKYRIM_AMETHYST_DIR`,
`SKYRIM_WINE_PREFIX`, `SKYRIM_PROJECTS_DIR`, `SKYRIM_CK_DIR`, `SKYRIM_PAPYRUS_COMPILER`,
`SKYRIM_HELPER_PATH` — the way a POSIX shell would, on Windows too
(the core's [`pathSettings.ts`](https://github.com/Ciltress/skyrim-modding-tools-core/blob/main/src/backend/skyrim/pathSettings.ts)):

| Written | Read as |
| --- | --- |
| `~/tools/papyrus-compiler` | that folder in your home folder (`~\…` too, on Windows) |
| `$HOME/…`, `${XDG_DATA_HOME}/…` | the variable's value; one that is not set stops the server at startup, named |
| `${STEAM_LIBRARY:-~/games}/steamapps` | the variable, or the default after `:-` when it is unset or empty |
| `projects`, `../mods` | from the server's own folder, the one `.env` is in |
| `G:\Modding\SkyrimSE-Test`, `C:/Mods/Bob's Armory` | as written: backslashes and quotes are part of the path |

`%USERPROFILE%` is refused with the way to write it, `${USERPROFILE}` or `~`; so is a command, `$(…)`,
which is never run; and on Linux, a Windows path such as `C:\…`.

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
| Linux | Mod Organizer 2 under Proton (`mo2`) | **Experimental**: built from the sources of MO2-LINT, Wine and Proton, tested against laid-out folders, never run on a real setup — see §5 |

The server picks the operating system's side by itself and the mod manager from `SKYRIM_MOD_MANAGER`;
nothing else changes between them — the same tools, the same projects.

HTTP mode is for a client on the same machine that prefers a long-lived server to one it starts
itself — an editor extension, say. Bind it to `127.0.0.1` (`MCP_HTTP_HOST`) unless it really must
be reached from elsewhere, and then put TLS in front of it.

## 4. Setting it up on Linux, with Amethyst

Once, on the machine with the game and Amethyst. Package names are Arch's (CachyOS).

1. **Tools**: `sudo pacman -S --needed nodejs npm git` — Node 24 or newer.
2. **The server**:
   ```bash
   git clone https://github.com/Ciltress/skyrim-modding-tools-mcp ~/skyrim-modding-tools-mcp
   cd ~/skyrim-modding-tools-mcp && npm run setup
   ```
   Setup installs the .NET 10 SDK (which brings ICU; the plugin helper does not start without it)
   through pacman after a yes, builds everything, offers the Papyrus compiler (step 4), says
   what step 3 needs, and registers the server (step 5). By hand: `sudo pacman -S dotnet-sdk`,
   then `npm install && npm run build:helper && npm run build && npm run check:helper`.
3. **Vanilla script sources**, for projects with Papyrus scripts: install *Skyrim Special Edition:
   Creation Kit* in Steam, which puts `Scripts.zip` into the game's `Data`. With nothing deployed in
   Amethyst (Restore), unpack it there: `cd "<game>/Data" && unzip -n Scripts.zip`. Unpacked while a
   profile is deployed, Amethyst would count the files as the game's runtime output and move them to
   its overwrite folder at the next restore.
4. **A Papyrus compiler**: the Creation Kit's is a Windows program. Setup downloads
   [russo-2025's](https://github.com/russo-2025/papyrus-compiler/releases) into the server's `tools`
   folder, where the server looks for it — after `papyrus-compiler` on `PATH`, and before
   `~/tools/papyrus-compiler/papyrus`. By hand, in the server's folder:
   ```bash
   mkdir -p tools && curl -L https://github.com/russo-2025/papyrus-compiler/releases/download/2026.03.15/papyrus-compiler-ubuntu.tar.gz | tar -xz -C tools
   ```
   `SKYRIM_PAPYRUS_COMPILER` names one anywhere else. In rare cases its output differs from the
   Creation Kit's byte for byte, not in behaviour ([research](research/2026-10-15-linux-mo2-and-platform.md) §7).
5. **The client**: setup registers it. By hand — no settings, Amethyst is found by itself:
   ```bash
   claude mcp add --scope user skyrim -- node ~/skyrim-modding-tools-mcp/dist/index.js
   ```
   VS Code and Claude Desktop: §1.1.

The server finds Amethyst by itself — no `SKYRIM_MOD_MANAGER` when Amethyst has Skyrim set up — and its
settings: the Flatpak's under
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
too small for any agent: set `OLLAMA_CONTEXT_LENGTH` (131072 for 128k), or the client's own context
setting. Claude Code pointed at Ollama loads every tool up front; `MCP_PROFILE=core` lists fewer.

- **The model has to make real tool calls.** gemma4:26b and gemma4:e4b do: each passed every task
  of `npm run eval:ollama` — find, read, filter, patch, patch and build — with no failed call. e4b
  fits a 16 GB card whole and answers about twice as fast; 26b took the shortest route more often.
  Code-completion models such as qwen2.5-coder:3b do not: they write the call into the answer as
  text, which no client acts on. Measure a model before relying on it —
  `npm run eval:ollama -- --model <name>` — and see
  the eval record, `docs/research/local-model-evals.md` in the skyrim-modding-tools folder beside this repository, for every model measured so far.
- **Records are edited with the client's file tools.** Claude Code has its own. A client that only
  connects Ollama to MCP servers — ollmcp, oterm — needs a filesystem server beside this one, allowed
  into the projects folder, e.g. `npx -y @modelcontextprotocol/server-filesystem <projects folder>`.
- **Speed.** On a 16 GB RTX 5080, gemma4:26b does not fit: Ollama keeps a quarter of its expert
  weights in system memory, the CPU works on those, and the GPU waits — 30–40% GPU load is what that
  looks like, not a misconfiguration. It generates about 50 tokens/s at a 128k context and 62 at 32k,
  and a tool-using turn takes about 3 s. `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0`
  are worth setting. Loading it takes 30–40 s, and a client asking for another context size reloads it. Measured on
  Ollama 0.40.4; 0.40.6 ran the same eval about 2.5 times slower with gemma4:26b on this card — ~26 against
  ~61 tokens/s in long turns, the prompt cache used as before (round 18 of the eval record, `docs/research/local-model-evals.md` in the skyrim-modding-tools folder beside this repository).

## 5. Setting it up on Linux, with Mod Organizer under Proton

**Experimental.** Built from the sources of MO2-LINT, Wine and Proton
([research](research/2026-10-15-linux-mo2-and-platform.md) §2–4) and tested against laid-out folders;
nobody has run it on a real setup yet, and `healthcheck` says so in its `notes`.

Steps 1–4 of §4 apply as they stand: the tools, the server, the vanilla script sources (Mod Organizer
leaves the game's `Data` alone, so setup unpacks `Scripts.zip` there after a yes), and a Papyrus
compiler. Setup asks for the instance folder, as Linux spells it; or name it at once:

```bash
npm run setup -- --instance ~/Games/mo2-lint/mo2-skyrim_se-steam
```

By hand: the instance into `.env` and the registration without settings, as §1.1 shows.

**The Wine prefix.** Mod Organizer writes Windows paths into `ModOrganizer.ini` — `Z:\home\…`, or
`D:\…` for a second drive. The server follows each drive letter's link in the `dosdevices` folder of
the prefix Mod Organizer runs in. It takes the prefix from `SKYRIM_WINE_PREFIX` (the `pfx` folder, or
the `compatdata/489830` folder that holds it); else, for an instance MO2-LINT installed, the game's own
Proton prefix, found through `~/.config/mo2-lint/state.json`. With neither, only paths on `Z:` are
read, as the root — enough when everything lives under `/`. Jackify and Steam Tinker Launch run Mod
Organizer in a prefix of their own: name it in `SKYRIM_WINE_PREFIX`.

**Close Mod Organizer before deploying.** Mod Organizer holds the profile in memory and writes it back
when it exits. On Windows the server tells a running Mod Organizer to re-read it; under Proton it
cannot yet, so `deployProject` refuses while this instance's Mod Organizer runs. Another instance's
does not matter.

**The first run** goes into a copy of the instance, or a profile nobody plays, with a throwaway project.
