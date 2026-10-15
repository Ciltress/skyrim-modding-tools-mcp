# AGENTS.md

Guidance for AI agents working **on this repository**. If you are an agent _using_ the running server,
you want [`docs/MCP-Tools.md`](docs/MCP-Tools.md) instead.

## What this is

An MCP server for Skyrim Special Edition modding with a mod manager — Mod Organizer 2 on Windows, or
Amethyst on Linux: it looks records up across an instance's load order, and builds mods kept as text
projects into plugins deployed to that instance. What differs by operating system and by mod manager
sits behind two seams ([ADR-0007](docs/adr/0007-operating-system-and-mod-manager-are-separate-seams.md)).
It started as a copy of a TypeScript MCP server template, whose machinery — one-file tools, profiles,
the response budget, the capability gate, self-serving docs and skills — it keeps.

Two programs make it up:

- **The server** (TypeScript, `src/`) — the MCP side, the mod managers' readers, projects, deploy.
- **The plugin helper** (C#, `helper/`) — a .NET process built on Mutagen that does every plugin read
  and write ([ADR-0003](docs/adr/0003-plugins-through-a-mutagen-helper.md)). The server talks to it in
  JSON lines over stdio. Build it with `npm run build:helper` (needs the .NET 10 SDK).

The vocabulary is in [`CONTEXT.md`](CONTEXT.md); use its words — *mod*, *plugin*, *record*,
*FormID*, *instance*, *project*, *patch* — in code, docs and messages alike.

## Read these first

| Document | When you need it |
| --- | --- |
| **[`docs/Tool-Router.md`](docs/Tool-Router.md)** | Intent to tool, hand-written. The cheapest useful thing to read. |
| **[`docs/Tool-Reference.md`](docs/Tool-Reference.md)** | Every tool with its arguments, **generated** from `getTools()` by `npm run docs:tools`. Never edit it by hand. |
| **[`docs/MCP-Tools.md`](docs/MCP-Tools.md)** | The rules a generator cannot produce: the architecture, profiles, the response budget, the gate, the error model, troubleshooting, the test-suite map, how to extend. **Start here** for how the server behaves. |
| **[`docs/Hosting.md`](docs/Hosting.md)** | stdio vs. Streamable HTTP, the per-session bearer token, the origin/host allow-lists, the rate limit, where it runs. Read it before touching `runHttp()` or `src/lib/http.ts`. |
| **[`CONTEXT.md`](CONTEXT.md)**, **[`docs/adr`](docs/adr)** | The vocabulary, and the design decisions everything else follows from. |
| **[`docs/research`](docs/research)** | What was found out before deciding: engines, Nexus, Mod Organizer's file formats, the Spriggit spike. |

They are kept accurate deliberately — treat a contradiction between a doc and the code as a bug in one
of them, and fix it rather than working around it.

**These files are served to clients at runtime**, so they are part of the product, not side notes: as
MCP resources under `<scheme>://guides/…`, and through the `readServerGuide` tool. They are read
through [`src/lib/guides.ts`](src/lib/guides.ts); to add a guide, add one entry to `GUIDES` there.
`guides.test.ts` reads the real files, so moving or renaming a doc without updating the registry fails
the tests.

The skill collections under [`skills/`](skills/) are served the same way, discovered from disk by
[`src/lib/skills.ts`](src/lib/skills.ts) and exposed by `readSkill`:

- **`skills/Domain`** holds the modding skills — ours, edit freely. They are knowledge an agent using
  the server reads before modding; keep them accurate to the game, and to the project text format.

## Layout

```
src/
  index.ts                 entry point only: loads .env (quietly), builds the server, runs it
  server.ts                the MCP server: routing from getTools(), connect/retry/latch, the gate,
                           serializeResult, healthcheck, resources, stdio vs. Streamable HTTP
  backend/Backend.ts       the lifecycle every backend has, and the two rules it keeps
  backend/index.ts         AppBackend, createBackend(), REQUIRED_ENV — the one place naming the backend
  backend/skyrim/SkyrimBackend.ts   the domain operations and their types
  backend/skyrim/SkyrimInstanceBackend.ts  the backend: credential check, records, projects, deploy,
                                    pull — knowing only the ModManager interface
  backend/skyrim/engine.ts          the shared helper process and its load order, kept in step with
                                    the mod manager
  backend/skyrim/helperClient.ts    the helper's JSON-lines client
  backend/skyrim/modManager.ts      the ModManager seam (ADR-0007) and the types every manager shares
  backend/skyrim/mo2Manager.ts      Mod Organizer 2 as the mod manager, over mo2.ts and mo2Profile.ts
  backend/skyrim/mo2.ts             reading an MO2 instance: ini, profile, mod order, load order, files;
                                    under Proton, the Wine prefix its ini's paths are read through
  backend/skyrim/mo2Profile.ts      the profile edits deploy makes, and refreshing a running MO2
  backend/skyrim/amethyst.ts        Amethyst as the mod manager: finding its config, its profile, its
                                    deploy command
  backend/skyrim/projects.ts        a project on disk: paths, FormID assignment, text sync, deploy state
  backend/skyrim/externalTools.ts   the Papyrus compilers (the Creation Kit's, russo-2025's) and git
  backend/skyrim/platform.ts        everything that differs by operating system (ADR-0007) — the only
                                    place that asks; Windows and Linux side by side
  backend/skyrim/paths.ts           finding files whatever their letter case, on every system
  handlers/BaseHandler.ts  the ToolSpec contract: dispatch, timing, envelope, error mapping
  handlers/index.ts        createHandlers(): the one list served, documented and tested
  handlers/args.ts         shared argument checks, and request errors -> InvalidParams
  handlers/RecordsHandlers.ts       findRecords, readRecord
  handlers/ProjectsHandlers.ts      newProject, addPatch, buildProject, deployProject, pullProject
  handlers/DocsHandlers.ts, SkillsHandlers.ts   readServerGuide and readSkill
  types/tools.ts           ToolDefinition / ToolProperty / ToolAnnotations — the inputSchema contract
  lib/                     logger, guides, skills, profiles, responseBudget, capabilityGate,
                           instructions, serverInfo, http, toolDocs, env — the template's machinery
  __tests__/               vitest suites, all offline; fakes.ts holds the shared doubles
helper/SkyrimHelper/       the C# plugin helper: Session.cs (the methods), RecordIndex.cs, SpriggitFormat.cs,
                           PeVersion.cs (an exe's version, read the same way on Windows and Linux)
skills/Domain              the modding skills — ours, edit freely
projects/                  the user's projects (mods as text); created on first use
scripts/generate-tool-docs.mjs   writes docs/Tool-Reference.md; run after changing any getTools()
scripts/smoke.mjs                drives the built server over stdio; fails on anything but frames on stdout
scripts/check-helper.mjs         starts the built helper and checks it answers; CI runs it on both systems
scripts/eval-ollama.mjs          runs fixed modding tasks with a local model through Ollama and scores them
```

## Conventions that matter

- **Never write to stdout.** The server speaks MCP over stdio; anything on stdout that is not a
  protocol frame corrupts the stream and breaks every tool at once. Use the logger, which writes to
  stderr. A dependency can do it too — dotenv 17 did, which is why `index.ts` loads it `quiet` —
  and `npm run smoke` is what catches that kind.
- **A tool returns its payload; `BaseHandler` does everything else.** Each tool is one `ToolSpec` — a
  `ToolDefinition` plus a `run(args)` that returns plain data — and
  [`BaseHandler.handle()`](src/handlers/BaseHandler.ts) owns dispatch, timing, the MCP envelope and
  the error mapping. Do not build `{content:[{type:'text',…}]}` in a handler; `serializeResult()`
  passes the envelope through, so doing it twice nests JSON inside JSON.
  - `status:'success'` is added for you. Return your own `status` to override it, and return an
    array to be serialised as-is.
  - Throw to fail. An `McpError` passes through with its code intact; anything else becomes an
    `InternalError` prefixed with the spec's `onFailure`, keeping the backend's detail.
  - The envelope is compact, never pretty-printed. Indentation costs response budget and buys a
    model nothing.
- **Adding a tool is a one-file change.** Add a `ToolSpec` to `toolSpecs()`; `getTools()`, the router,
  `tools/list` and the contract tests are all derived from it, so a listed tool is always callable
  and always tested. A tool that belongs in a small profile is the exception — name it in
  [`src/lib/profiles.ts`](src/lib/profiles.ts) too.
- **Every tool declares its `annotations`: a `title` and all four hints, as booleans.** On a read-only
  tool that means `destructiveHint: false, idempotentHint: true`. The specification defines those two
  as meaningful only when a tool writes, but OpenAI's directory rejects a tool that omits either, and
  a client falling back to the defaults — not read-only, destructive, open-world — treats a new search
  tool like a delete. The conventions each flag follows are in
  [§2.2 of `docs/MCP-Tools.md`](docs/MCP-Tools.md); `handlerContract.test.ts` fails on a tool missing
  any of them, and `server.test.ts` checks the same on the wire.
- **Make every annotation true.** `idempotentHint: true` is a claim a test can check: repeat the call
  and compare the state. `skyrimBackend.test.ts` does it for `deployProject` — a second deploy of the
  same build leaves Mod Organizer's profile untouched — and for `newProject` and `assignFormIds`.
  `addPatch` leaving a record already in the project alone is the helper's behaviour, so it was
  checked against the test instance, not in the suite.
- **Errors must be `McpError`, and say the next step.** A raw `Error` reaching the client becomes an
  opaque "Internal error". `InvalidParams` for a bad argument, with a message that names what to send
  instead — a model reads the message and acts on it.
- **Declare argument types honestly.** An argument the backend wants as an object or a list must be
  declared `type: 'object'` or `'array'`, not `'string'`. There is no `optional` marker — omit the
  name from `required`.
- **Answers have a ceiling, enforced centrally.** `serializeResult()` is the single funnel every
  answer passes through, so [`src/lib/responseBudget.ts`](src/lib/responseBudget.ts) covers a tool
  added tomorrow without being told. Over-budget answers are replaced by valid JSON stating the
  original size and the next step — never by a cut-off fragment, which would not parse and which a
  model answers by retrying the same call. A tool that overruns _routinely_ should grow a real argument
  (a row limit, a section) instead, and carry a `narrowingHint` naming it.
- **The backend decides what it can serve; ask it, do not hard-code it.** Tools declare
  `needsFeature`; `capabilities()` says what this backend has. **Every failure path leaves the gate
  empty and the list complete**: hiding a tool that would have worked is worse than offering one that
  errors, because the first is invisible.
- **The profile decides what is listed _and_ what is routed.** A tool outside the profile is not
  callable, so `readonly` genuinely cannot write. Renaming a tool a profile names fails at **startup**
  (`applyProfile` throws), and `profiles.test.ts` catches it first.
- **Retry only what was refused before it ran, and only once.** `isSessionExpired()` answers true
  only for errors that prove nothing was applied. A credential the backend refused is latched and
  never retried — for a password, retries lock the account.
- **The tool reference is generated; regenerate it.** After changing any `getTools()`, run
  `npm run build && npm run docs:tools`. `toolDocs.test.ts` fails on a stale reference. The **router**
  is the opposite — hand-written intent phrases a generator cannot infer. Add a row when a new tool
  answers a question someone would ask in their own words.
- **One list of handlers.** `createHandlers()` in `src/handlers/index.ts` is what the server serves,
  what the reference documents and what the contract tests check. Never keep a second list.
- **A status code is not a diagnosis.** When a message names a cause, the code has to have evidence
  for that cause. An unreachable backend, a refused credential and a missing permission can arrive as
  the same HTTP status and need opposite fixes; `health()` exists so the startup failure and
  `healthcheck` can say which.

## Working on this repo

```bash
npm install
npm run build:helper   # dotnet publish helper/SkyrimHelper -> helper/bin (needs the .NET 10 SDK)
npm run build          # tsc -> dist/
npm test               # vitest, fully offline
npx tsc --noEmit       # type check only
npm run docs:tools     # regenerate docs/Tool-Reference.md (after a build)
npm run smoke          # drive the built server over stdio
npm run check:helper   # start the built helper once (after build and build:helper)
```

Before you call something done: `npx tsc --noEmit` clean, `npm test` green, `npm run build &&
npm run docs:tools` leaving the reference unchanged, and `npm run smoke` passing. A change to the
helper also needs `npm run build:helper`, `npm run check:helper`, and a call through it against a
real instance. CI runs all of it on Windows and Linux; code that differs by system belongs in
`platform.ts`, and its Linux side is tested on Windows too, against laid-out folders.

`handlerContract.test.ts` holds every tool to the same contract using arguments generated from its
`inputSchema`, so a new tool is covered as soon as it is listed. If it fails for a legitimate design
decision, encode the exception there with a comment — do not weaken the assertion.

**A green suite does not mean a write path works.** A fake accepts any order of calls, so it cannot
know the backend's own rules — that a lock must be released before activating, that a freshly created
object is not yet searchable. **Anything that locks, writes, activates or deletes has to be run
against a real backend once**, with a throwaway object created and deleted in the same session. Then
encode what you learned as an assertion, so the fake enforces it from then on. Here the real backend
is a **test instance** — a portable Mod Organizer on a clean game, never someone's playthrough; with
Amethyst, a throwaway profile — and the throwaway object is a project, deployed and then removed with
its mod.

## Testing against a live MCP client

A registered client runs `dist/index.js`, so a change is only visible there after `npm run build`
**and** a client reconnect. `npm run dev` opens the MCP Inspector against the build.

## Measuring with a local model

`npm run eval:ollama` runs fixed modding tasks with a model served by Ollama through the built server
and scores them. **Record every round in
[`docs/research/local-model-evals.md`](docs/research/local-model-evals.md)** — the figures (the script
prints the entry), the build, what changed before the round, and what the transcripts showed. The
transcripts are where a model's wasted calls point at the server: a relative path joined to the wrong
folder, a misspelled type answered with "nothing found". Fix those in the server, for every client.

## Care with a real backend

This server writes into a mod manager's instance: mod folders, and the selected profile's mod order
and load order — and with Amethyst it runs Amethyst's deploy, which rewrites the game's `Data`. When working against a real one:

- Prefer read-only tools; treat anything not demonstrably read-only as a write.
- Work on a test instance. A Wabbajack-installed instance deletes every mod it did not install on its
  next update, and its authors usually void support for modified installs.
- Change other people's mods only through patches, never in their plugins.
- Ask before deploying into an instance you do not own, or a profile someone plays.
