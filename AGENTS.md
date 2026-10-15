# AGENTS.md

Guidance for AI agents working **on this repository**. If you are an agent _using_ the running server,
you want [`docs/MCP-Tools.md`](docs/MCP-Tools.md) instead.

## What this is

A template for a TypeScript MCP server, extracted from a production server and stripped of its
domain. It runs as is — against an in-memory **notes** store that stands in for a real backend — so
every pattern below has a working, tested instance. Each new server starts as a copy of it.

## Starting a new server from this template

Work through these in order; each is greppable as `TEMPLATE:` in the code and the docs.

1. **Name it.** `name`, `description`, `author`, `bin` and `mcpName` in `package.json`; `name`,
   `description`, `repository` and the package entry in `server.json`; the copyright line in
   `LICENSE`, if the new server has a different owner. The server's announced name, version and resource URI scheme all derive from
   `package.json` — nothing else to change.
2. **Replace the backend.** Write your client in `src/backend/` as an interface that extends
   `Backend` (lifecycle) with your domain operations, plus an implementation. Point `AppBackend` and
   `createBackend()` in `src/backend/index.ts` at it, and list the variables it cannot start without in
   `REQUIRED_ENV`. Keep the two rules in `Backend.ts`: construction never touches the network, and a
   refused credential throws `PermanentBackendError`.
3. **Replace the tools.** Swap `NotesHandlers` for your own handler families in `createHandlers()`
   (`src/handlers/index.ts`). Then update `src/lib/profiles.ts` (who gets which tools),
   `GATED_FEATURES` in `src/lib/capabilityGate.ts`, and `LABELS` in `src/lib/toolDocs.ts`.
4. **Replace the tests that are about notes.** `src/__tests__/fakes.ts` (keep what each fake
   promises), `notesHandlers.test.ts` (one behavioural suite per family), and the `TEMPLATE:` spot
   checks in `handlerContract`, `toolDefinitions`, `profiles` and `responseBudget`. The generic suites
   need no changes.
5. **Rewrite the domain parts of the docs.** `docs/Tool-Router.md` (rows in your users' words),
   `docs/MCP-Tools.md` §1 rule 9, §4 and §6, `CONTEXT.md`, `README.md`. Then
   `npm run build && npm run docs:tools`.
6. **Replace the skills.** `skills/Domain` with skills for your domain; keep or `git rm` the
   `skills/Development` submodule.
7. **Rename the backend's variables.** `EXAMPLE_*` → your prefix, in code, `server.json` and
   `.env.example` together — `serverManifest.test.ts` fails until all three agree.

Done when `grep -rn "TEMPLATE" --exclude-dir=node_modules .` finds nothing you have not decided to
keep, and the checks under [Working on this repo](#working-on-this-repo) pass.

## Read these first

| Document | When you need it |
| --- | --- |
| **[`docs/Tool-Router.md`](docs/Tool-Router.md)** | Intent to tool, hand-written. The cheapest useful thing to read. |
| **[`docs/Tool-Reference.md`](docs/Tool-Reference.md)** | Every tool with its arguments, **generated** from `getTools()` by `npm run docs:tools`. Never edit it by hand. |
| **[`docs/MCP-Tools.md`](docs/MCP-Tools.md)** | The rules a generator cannot produce: the architecture, profiles, the response budget, the gate, the error model, troubleshooting, the test-suite map, how to extend. **Start here** for how the server behaves. |
| **[`docs/Hosting.md`](docs/Hosting.md)** | stdio vs. Streamable HTTP, the per-session bearer token, the origin/host allow-lists, the rate limit, Docker. Read it before touching `runHttp()` or `src/lib/http.ts`. |
| **[`docs/Development-Skills.md`](docs/Development-Skills.md)** | The bundled general engineering skills, and which fit this repo. |
| **[`CONTEXT.md`](CONTEXT.md)**, **[`docs/adr`](docs/adr)** | The vocabulary, and the two design decisions everything else follows from. |

They are kept accurate deliberately — treat a contradiction between a doc and the code as a bug in one
of them, and fix it rather than working around it.

**These files are served to clients at runtime**, so they are part of the product, not side notes: as
MCP resources under `<scheme>://guides/…`, and through the `readServerGuide` tool. They are read
through [`src/lib/guides.ts`](src/lib/guides.ts); to add a guide, add one entry to `GUIDES` there.
`guides.test.ts` reads the real files, so moving or renaming a doc without updating the registry fails
the tests.

The skill collections under [`skills/`](skills/) are served the same way, discovered from disk by
[`src/lib/skills.ts`](src/lib/skills.ts) and exposed by `readSkill`:

- **`skills/Domain` is vendored** — ordinary files in this repository. Edit freely.
- **`skills/Development` is a git submodule** of `mattpocock/skills`. **Do not edit it**: the changes
  belong to that repository and are lost on the next update. A plain `git clone` leaves it empty — use
  `--recurse-submodules`.

## Layout

```
src/
  index.ts                 entry point only: loads .env (quietly), builds the server, runs it
  server.ts                the MCP server: routing from getTools(), connect/retry/latch, the gate,
                           serializeResult, healthcheck, resources, stdio vs. Streamable HTTP
  backend/Backend.ts       the lifecycle every backend has, and the two rules it keeps
  backend/notes.ts         TEMPLATE: the example domain, an in-memory notes store
  backend/index.ts         AppBackend, createBackend(), REQUIRED_ENV — the one place naming the backend
  handlers/BaseHandler.ts  the ToolSpec contract: dispatch, timing, envelope, error mapping
  handlers/index.ts        createHandlers(): the one list served, documented and tested
  handlers/DocsHandlers.ts, SkillsHandlers.ts   readServerGuide and readSkill
  handlers/NotesHandlers.ts                     TEMPLATE: the example tool family
  types/tools.ts           ToolDefinition / ToolProperty / ToolAnnotations — the inputSchema contract
  lib/logger.ts            structured logging; every level goes to stderr
  lib/guides.ts            the guide registry served as resources and by readServerGuide
  lib/skills.ts            filesystem discovery of skills/, served as resources and by readSkill
  lib/profiles.ts          which tools MCP_PROFILE lists, and therefore routes
  lib/responseBudget.ts    the ceiling on one answer, enforced in serializeResult
  lib/capabilityGate.ts    tools withheld because the backend lacks a feature they need
  lib/instructions.ts      the MCP instructions announced at initialize
  lib/serverInfo.ts        name, version and resource scheme, read from package.json
  lib/http.ts              Streamable HTTP plumbing: origin/host policy, rate limit, body reader
  lib/toolDocs.ts          renders docs/Tool-Reference.md from the tool definitions
  lib/env.ts               parsing helpers for list and flag variables
  __tests__/               vitest suites, all offline; fakes.ts holds the shared doubles
skills/Domain              vendored domain skills — ours, edit freely
skills/Development         git submodule of mattpocock/skills — do NOT edit
scripts/generate-tool-docs.mjs   writes docs/Tool-Reference.md; run after changing any getTools()
scripts/smoke.mjs                drives the built server over stdio; fails on anything but frames on stdout
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
  and compare the state. `notesHandlers.test.ts` does it for `updateNote`, whose store does not even
  move `updatedAt` on a no-op — that is what made the claim honest.
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
npm run build          # tsc -> dist/
npm test               # vitest, fully offline
npx tsc --noEmit       # type check only
npm run docs:tools     # regenerate docs/Tool-Reference.md (after a build)
npm run smoke          # drive the built server over stdio
```

Before you call something done: `npx tsc --noEmit` clean, `npm test` green, `npm run build &&
npm run docs:tools` leaving the reference unchanged, and `npm run smoke` passing.

`handlerContract.test.ts` holds every tool to the same contract using arguments generated from its
`inputSchema`, so a new tool is covered as soon as it is listed. If it fails for a legitimate design
decision, encode the exception there with a comment — do not weaken the assertion.

**A green suite does not mean a write path works.** A fake accepts any order of calls, so it cannot
know the backend's own rules — that a lock must be released before activating, that a freshly created
object is not yet searchable. **Anything that locks, writes, activates or deletes has to be run
against a real backend once**, with a throwaway object created and deleted in the same session. Then
encode what you learned as an assertion, so the fake enforces it from then on.

## Testing against a live MCP client

A registered client runs `dist/index.js`, so a change is only visible there after `npm run build`
**and** a client reconnect. `npm run dev` opens the MCP Inspector against the build.

## Care with a real backend

This server writes. When working against a real one:

- Prefer read-only tools; treat anything not demonstrably read-only as a write.
- Release what you lock, including after a failure.
- Ask before writing to data you do not own.
