# AGENTS.md

Guidance for AI agents working **on this repository**. If you are an agent _using_ the running server,
you want the guide `tools` instead (`readServerGuide {"guide":"tools"}`).

## What this is

An MCP server for Skyrim Special Edition modding with a mod manager — Mod Organizer 2 on Windows, or
Amethyst on Linux: it looks records up across an instance's load order, and builds mods kept as text
projects into plugins deployed to that instance. It is the complete product: every tool there is, for any MCP
client.

**The tools are not here.** Everything they do — the backend, the one list of tools, the plugin helper, the
skills, the router and the `tools` guide, profiles, the response budget, the capability gate — is the core,
[skyrim-modding-tools-core](https://github.com/Ciltress/skyrim-modding-tools-core), a repository of its own
beside this one ([its ADR-0009](https://github.com/Ciltress/skyrim-modding-tools-core/blob/main/docs/adr/0009-the-core-is-its-own-package.md)).
The OpenClaw plugin serves the same core. **Core-first:** a change to a tool, an answer, a guide or a skill is
made in the core, never only here; read the core's `AGENTS.md` for its conventions before changing one.

What is this server's own:

- the MCP side: stdio and Streamable HTTP, routing from `getTools()`, connect/retry/latch, the gate and the
  response budget applied in `serializeResult()`, `healthcheck`, the resources, the instructions;
- `PRODUCT` ([`src/lib/serverInfo.ts`](src/lib/serverInfo.ts)): what the core needs to know of this server —
  its name (the resources' URI scheme), its version (told to Nexus), its folder (`projects/`, `.env`, `tools/`)
  and the guides it serves, in their order;
- `npm run setup`, which installs, builds, writes `.env`, registers the server with the MCP clients — OpenClaw
  among them — and runs a healthcheck;
- its tool reference, its two guides (`hosting`, `agents`), and its research notes.

The vocabulary is in the core's `CONTEXT.md`; use its words — *mod*, *plugin*, *record*, *FormID*,
*instance*, *project*, *patch* — in code, docs and messages alike.

## Read these first

| Document | When you need it |
| --- | --- |
| **[`docs/Tool-Reference.md`](docs/Tool-Reference.md)** | Every tool with its arguments, as this server serves them, **generated** from `getTools()` by `npm run docs:tools`. Never edit it by hand. |
| **[`docs/Hosting.md`](docs/Hosting.md)** | stdio vs. Streamable HTTP, the per-session bearer token, the origin/host allow-lists, the rate limit, where it runs. Read it before touching `runHttp()` or `src/lib/http.ts`. |
| **The core's `docs/Tool-Router.md` and `docs/MCP-Tools.md`** | Intent to tool, and how the tools behave: the architecture, profiles, the response budget, the gate, the error model, troubleshooting, how to extend. Served here as the guides `router` and `tools`. |
| **`docs/research` beside this repository**, in the skyrim-modding-tools folder that holds it, the core and the OpenClaw plugin | What was found out before deciding: engines, Nexus, Mod Organizer's file formats, the Spriggit spike, and the local-model eval rounds. Not in this repository. |

They are kept accurate deliberately — treat a contradiction between a doc and the code as a bug in one
of them, and fix it rather than working around it.

**The guides are served to clients at runtime**, so they are part of the product, not side notes: as
MCP resources under `<scheme>://guides/…`, and through the `readServerGuide` tool. This server's list is
`PRODUCT.guides`; to add a guide of its own, add an entry there. The skills are the core's, served the same way.

## Layout

```
src/
  index.ts                 entry point only: loads .env (quietly), builds the server, runs it
  server.ts                the MCP server: routing from getTools(), connect/retry/latch, the gate,
                           serializeResult, healthcheck, resources, stdio vs. Streamable HTTP, and the
                           core's ToolError made the McpError a client reads
  lib/serverInfo.ts        PROJECT_ROOT, SERVER_INFO, RESOURCE_SCHEME and PRODUCT, from package.json
  lib/http.ts              the HTTP transport's gates: origins, hosts, bearer tokens, the rate limit
  setup/main.ts            npm run setup, a second program: prerequisites, the helper (built in the core's
                           folder), .env, the Papyrus compiler, script sources, client registration, a
                           healthcheck — asking only what readConfiguration() cannot find
  setup/system.ts          setup's own operating-system seam: starting programs, package managers,
                           Claude Desktop's and Mod Organizer's folders
  setup/envFile.ts, registration.ts, mo2Instances.ts, compiler.ts   what setup writes and runs
  __tests__/               vitest suites, all offline; the doubles come from skyrim-modding-tools-core/testing
projects/                  the user's projects (mods as text); created on first use
scripts/generate-tool-docs.mjs   writes docs/Tool-Reference.md; run after changing any getTools()
scripts/smoke.mjs                drives the built server over stdio; fails on anything but frames on stdout
scripts/eval-ollama.mjs          runs fixed modding tasks with a local model through Ollama and scores them
scripts/eval-openclaw.mjs        the same tasks through OpenClaw on the user's own configuration (--client openclaw)
```

The core is `node_modules/skyrim-modding-tools-core`, installed from a tag of its GitHub repository and
built there by its `prepare` script (allowed in package.json's `allowScripts`). A new core release is a new
tag: `npm install "skyrim-modding-tools-core@git+https://github.com/Ciltress/skyrim-modding-tools-core.git#vX.Y.Z"`
and `npm approve-scripts skyrim-modding-tools-core`, then drop the old pin from `allowScripts`. To try a core
change here before it is tagged, `npm install ../skyrim-modding-tools-core` links the checkout beside this
one — put the tag back before you commit.

## Conventions that matter

- **Never write to stdout.** The server speaks MCP over stdio; anything on stdout that is not a
  protocol frame corrupts the stream and breaks every tool at once. Use the logger, which writes to
  stderr. A dependency can do it too — dotenv 17 did, which is why `index.ts` loads it `quiet` —
  and `npm run smoke` is what catches that kind.
- **The tools are the core's.** A tool, its definition, its answers and its errors are changed in the core
  (its `AGENTS.md`), then this server rebuilt and its reference regenerated. Nothing here builds a tool's
  envelope; `serializeResult()` passes the core's through, and a `ToolError` becomes an `McpError` with the
  same code and message in `handleError()`.
- **Every tool declares its `annotations`** — the core's contract tests hold every tool to it, and
  `server.test.ts` checks the same on the wire.
- **Answers have a ceiling, enforced centrally.** `serializeResult()` is the single funnel every
  answer passes through, so the core's `responseBudget.ts` covers a tool added tomorrow without being told.
- **The profile decides what is listed _and_ what is routed.** A tool outside the profile is not
  callable, so `readonly` genuinely cannot write.
- **Retry only what was refused before it ran, and only once.** `isSessionExpired()` answers true
  only for errors that prove nothing was applied. A credential the backend refused is latched and
  never retried — for a password, retries lock the account.
- **The tool reference is generated; regenerate it.** After a change to any `getTools()` in the core, run
  `npm run build && npm run docs:tools` here. `toolDocs.test.ts` fails on a stale reference.
- **server.json declares every variable the server reads**, here and in the core's build;
  `serverManifest.test.ts` holds the two together.

## Working on this repo

```bash
npm run setup          # what a modder runs: install, build, .env, registration, healthcheck
npm install
npm run build:helper   # the core's helper, built in its folder (needs the .NET 10 SDK)
npm run build          # tsc -> dist/
npm test               # vitest, fully offline
npx tsc --noEmit       # type check only
npm run docs:tools     # regenerate docs/Tool-Reference.md (after a build)
npm run smoke          # drive the built server over stdio
npm run check:helper   # start the core's built helper once
```

`npm install` replaces the core's folder, and the helper built in it with it: build the helper again after.

Before you call something done: `npx tsc --noEmit` clean, `npm test` green, `npm run build &&
npm run docs:tools` leaving the reference unchanged, and `npm run smoke` passing. CI runs all of it on Windows
and Linux.

## Testing against a live MCP client

A registered client runs `dist/index.js`, so a change is only visible there after `npm run build`
**and** a client reconnect. `npm run dev` opens the MCP Inspector against the build.

## Measuring with a local model

`npm run eval:ollama` runs fixed modding tasks with a model served by Ollama through the built server and
scores them. Rounds 1–63 are recorded in the eval record, `docs/research/local-model-evals.md` in the skyrim-modding-tools folder beside this repository.
From round 64 the eval moves to the OpenClaw plugin's repository, which records its rounds there.

## Care with a real backend

This server writes into a mod manager's instance: mod folders, and the selected profile's mod order
and load order — and with Amethyst it runs Amethyst's deploy, which rewrites the game's `Data`. When working against a real one:

- Prefer read-only tools; treat anything not demonstrably read-only as a write.
- Work on a test instance. A Wabbajack-installed instance deletes every mod it did not install on its
  next update, and its authors usually void support for modified installs.
- Change other people's mods only through patches, never in their plugins.
- Ask before deploying into an instance you do not own, or a profile someone plays.
