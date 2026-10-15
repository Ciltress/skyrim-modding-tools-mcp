# How this server behaves

> **Audience:** humans *and* LLM agents using this server.
> **Source of truth:** the handler classes in [`src/handlers`](../src/handlers) and the server in
> [`src/server.ts`](../src/server.ts). A contradiction between this document and the code is a bug
> in one of them — fix it, do not work around it.

This server works on one **Mod Organizer 2 instance** of Skyrim Special Edition. It looks records up
across the active load order, and it builds mods kept as text **projects** into plugins deployed to
that instance. It exposes those operations as **tools**, and its own documentation and modding
**skills** as both **resources** and tools. The vocabulary — mod, plugin, record, FormID, override,
project, patch — is defined in [`CONTEXT.md`](../CONTEXT.md).

For *which tool does what*, start with [`Tool-Router.md`](./Tool-Router.md). For every tool's
arguments, see [`Tool-Reference.md`](./Tool-Reference.md), which is generated from the code.

---

## Table of contents

1. [Read this first — the rules that prevent most failures](#1-read-this-first)
2. [Architecture: contract, base handler, routing, backend](#2-architecture)
3. [Profiles, the response budget and the capability gate](#3-profiles-the-response-budget-and-the-capability-gate)
4. [Golden paths — copy-pasteable workflows](#4-golden-paths)
5. [Response and error model](#5-response-and-error-model)
6. [Troubleshooting matrix](#6-troubleshooting-matrix)
7. [Test suites](#7-test-suites)
8. [Extending the server](#8-extending-the-server)

---

## 1. Read this first

1. **Know the job but not the tool? Ask the server.** `readServerGuide` with `{"guide":"router"}`
   maps the words people use to the tool that does the job. With no arguments it lists every guide
   and its sections — read a section, not a whole guide.

2. **`tools/list` is the truth about what you can call.** The active **profile** decides what is
   listed, and a tool outside it is not merely hidden — it is not callable. Calling one anyway
   answers that it *exists but is out of profile*, so there is no point retrying it.
   `healthcheck` names the active profile.

3. **Some tools may be withheld for this backend.** A tool that needs an optional backend feature
   is withheld where the backend lacks it. None does yet; the Nexus tools will (an API key, a premium
   account). Calling a withheld tool answers that the backend does not offer it — a property of the
   backend, so retrying will not help.

4. **An answer can be withheld for being too large.** Over the profile's response ceiling you get
   valid JSON with `status:"truncated"`, the original `bytes`, the `budget`, a 2,000-byte `preview`
   and a `nextStep`. **Retrying the identical call produces the identical refusal** — narrow it as
   `nextStep` says instead.

5. **Arguments are described, but not schema-validated at the door.** Every argument has a
   description and a type, and closed value sets carry an `enum`. Handlers validate what they use
   and answer `InvalidParams` with a message that says what to send instead.

6. **Read the annotations before you write.** Every tool states `readOnlyHint`, `destructiveHint`,
   `idempotentHint` and `openWorldHint`. `deployProject` and `pullProject` are destructive: they
   replace a mod folder in Mod Organizer, and a project's text. Every write here is idempotent —
   repeating it with the same inputs leaves the same state.

7. **A failed call is a result, not an exception.** You get `isError: true` and a JSON body with
   `error` and `code`. The message is written to tell you the next step; read it before retrying.

8. **Never log to stdout** (for anyone extending the server). It speaks MCP over stdio, and anything
   on stdout that is not a protocol frame corrupts the stream for every tool at once.
   [`src/lib/logger.ts`](../src/lib/logger.ts) writes every level to **stderr** for that reason.

9. **Domain rules.**
   - **Records are changed by editing project text** with your ordinary file tools — read, edit,
     write the YAML files in a project's `plugin/` folder. No tool edits a record.
   - **FormIDs are written `012EB7:Skyrim.esm`**, never as a load-order hex like `00012EB7`. Never
     guess one: find it with `findRecords`, which also turns the FormIDs in project text into names.
   - **A new record's file leaves `FormKey` out.** `buildProject` assigns one and writes it back;
     after that it never changes.
   - **Change other mods through a patch** (`addPatch`), never in their plugins: an override copied
     from the winning version keeps every other mod's changes, and survives their updates.
   - **Build, deploy and pull are explicit steps.** Deploy refuses a stale build and refuses to
     overwrite a plugin the Creation Kit changed; pull refuses while the project has uncommitted
     changes. Each refusal names the step to take first.
   - Read the `skyrim-modding-basics` skill before modding, and the record family's skill before
     touching one of its records.

| profile | listed | for |
| --- | --- | --- |
| `core` | 8 | look up, patch, build, deploy — small local models |
| `readonly` | 5 | looking records up only; the write tools are absent, not discouraged |
| `all` | 10 | the default; right for clients that fetch tool schemas on demand |

Counts include `healthcheck`, which every profile lists.

---

## 2. Architecture

### 2.1 The contract — `ToolDefinition`

[`src/types/tools.ts`](../src/types/tools.ts)

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required?: string[];   // the only optionality marker — anything not listed is optional
  };
  narrowingHint?: string;  // what "narrow it" means here, used when an answer exceeds the budget
  needsFeature?: string;   // the GatedFeature this tool cannot work without, e.g. 'tags'
  annotations?: ToolAnnotations;
}
```

`ToolProperty` is a subset of JSON Schema: `type`, `description`, `items`, `properties`, `required`,
`enum`, `default`. There is no `optional: true` flag — it was never JSON Schema, and a test fails if
one appears. Nested `properties`/`items` let a structured argument describe its own shape.

`narrowingHint` and `needsFeature` live on the tool rather than in a table keyed by tool name, for
one reason: such a table goes stale silently on a rename, and the failure is invisible — generic
advice at the moment the specific move was needed, or a gated tool quietly un-gated.

### 2.2 Annotations — what a tool does to the backend

`annotations` goes to the client unchanged in `tools/list`. It is how a client decides what to
auto-approve and what to put in front of a human. They are **hints, not a permission system**:
nothing is enforced, and a client must not trust annotations from a server it does not trust.

| Flag | True when |
| --- | --- |
| `readOnlyHint` | The call changes nothing in the backend. A check that sends data but persists nothing is read-only; anything that executes caller-supplied code is not. |
| `destructiveHint` | The call overwrites or removes something that was already there: `deployProject` (the mod folder), `pullProject` (the project's text). Adding something new is **not** destructive — `addPatch` never overwrites a file, and `buildProject` replaces only its own previous output. |
| `idempotentHint` | Repeating the call really does leave the same state: `addPatch` (a record already in the project is left alone), `newProject` (an existing project is returned as it is), `deployProject` of the same build. A write that appends to a history every time never qualifies. |
| `openWorldHint` | The call reaches past the backend this server is bound to: sending, publishing, pushing to an external remote. `false` everywhere else. |

**Every tool states all four flags**, read-only ones included, where they are always
`destructiveHint: false` and `idempotentHint: true`. The specification defines those two as
meaningful only when a tool writes, but OpenAI's tool directory rejects any tool that leaves one out,
and a client applying the defaults would read a missing `destructiveHint` as `true`.
`handlerContract.test.ts` holds every handler tool to that; `server.test.ts` checks the same on the
wire, which is the only place `healthcheck` (defined in the server) is seen.

### 2.3 The execution layer — `BaseHandler` and `ToolSpec`

[`src/handlers/BaseHandler.ts`](../src/handlers/BaseHandler.ts)

A tool is one `ToolSpec`: a `definition` and a `run(args)` that returns plain data. Everything else
is `BaseHandler`'s:

| Member | What it does |
| --- | --- |
| `toolSpecs()` | The handler's tools, declared once. `getTools()` and the router are both derived from it. |
| `handle(name, args)` | Dispatches to `run`, never with `undefined` args; times the call; wraps the payload; maps errors. |
| `envelope(payload)` | `{content:[{type:'text',text:<compact JSON>}]}`. Adds `status:'success'` to a plain object without a `status`; serialises a bare array as it stands. |
| `asMcpError(error, onFailure)` | An `McpError` passes through untouched; anything else becomes `InternalError`, prefixed with the spec's `onFailure` and keeping the backend's own message. |
| `backend` | The one `AppBackend` this server talks to. |
| `logger` | `createLogger(this.constructor.name)` — **all levels go to stderr**. |
| `getMetrics()` | Requests, errors, timing, bytes returned, largest answer, answers withheld. Surfaced per handler by `healthcheck`. |

### 2.4 Request lifecycle

[`src/server.ts`](../src/server.ts)

```
tools/list  → ensureGate()  (once per process; can only shorten the list, never fail it)
            → the profile's tools, minus anything gated, + healthcheck

tools/call  → healthcheck?  → answer without connecting to the backend
            → ensureGate()
            → withheld for this backend? → McpError InvalidRequest, saying so
            → toolRoutes.get(name)        (built from getTools(), within the profile, + aliases)
            → not found?  → "exists but out of profile" or "unknown tool"
            → !backend.connected?  → ensureConnected()
            → handler.handle(name, args)
            → session expired? → reconnect, retry once
            → serializeResult()  (pass-through envelope, response budget applied here)
            → on throw: handleError() → {content:[…], isError:true}
```

The router is **derived from `getTools()`**, so a tool cannot be listed without being callable. A
duplicate name is refused at startup with a warning on stderr (the first handler keeps it).
`TOOL_ALIASES` in `server.ts` keeps a renamed tool callable under its old name without listing it.

### 2.5 The backend seam

[`src/backend/Backend.ts`](../src/backend/Backend.ts) declares the lifecycle every backend has;
the domain operations live on the interface that extends it,
[`SkyrimBackend`](../src/backend/skyrim/SkyrimBackend.ts). [`src/backend/index.ts`](../src/backend/index.ts)
names the one the server uses — `AppBackend` — and builds it with `createBackend(env, { bearerToken })`.

Behind it sit three parts:

- **The MO2 reader** ([`mo2.ts`](../src/backend/skyrim/mo2.ts)) rebuilds what a program started
  outside Mod Organizer cannot see — which file each active plugin really is — from the instance's
  ini, the selected profile's mod order and load order, and the mods' folders. The few profile
  changes deploy makes are in [`mo2Profile.ts`](../src/backend/skyrim/mo2Profile.ts).
- **The plugin helper** ([`helper/`](../helper), [ADR-0003](adr/0003-plugins-through-a-mutagen-helper.md))
  is a .NET process built on Mutagen that does every plugin read and write, and writes project text in
  Spriggit's format. It speaks one JSON object per line on stdio, keeps the load order open between
  calls, and indexes it in the background. [`helperClient.ts`](../src/backend/skyrim/helperClient.ts)
  is its client.
- **The engine** ([`engine.ts`](../src/backend/skyrim/engine.ts)) owns the helper and keeps its load
  order in step with Mod Organizer: before each call it compares a fingerprint of the profile's files
  and hands over a fresh load order when another profile was selected or a mod changed. One engine
  serves every session in the process.

`connect()` is the credential check and nothing more: it starts the engine in the background without
waiting. An instance that cannot be read or a helper that is not built is not a refused credential, so
it surfaces on the first tool call and in `healthcheck` with its own cause, and is checked again on
every call.

| Member | Used for |
| --- | --- |
| `describe()` | What this instance is bound to — in `instructions` and `healthcheck`. Never contacts the backend. |
| `connected` / `connect()` | Connected lazily before the first tool call, eagerly at stdio startup, and again after an expired session. |
| `isSessionExpired(error)` | Errors that mean "refused before running it". Only these are retried, and only once. |
| `capabilities()` | Optional features, for the capability gate. `undefined` gates nothing. |
| `health()` | Optional probe for `healthcheck` and the startup failure message. Guarded: it can never make `healthcheck` throw. |

Two rules every backend keeps. **Constructing one never touches the network** — HTTP mode builds a
backend it never connects, purely to host sessions. And **a refused credential is permanent**: throw
`PermanentBackendError` from `connect()` and the server latches it, never connecting again. For a
password or a client secret every retry is one more failed logon, and enough of those lock the
account for everyone who uses it.

### 2.6 The server documents itself

This documentation and the bundled skills are served by the server, two ways, from the same files:

- **As MCP resources** — `<scheme>://guides/<id>` and `<scheme>://skills/<collection>/<name>`, all
  `text/markdown`. The scheme is derived from the package name. This is what lets a *user* attach a
  guide in their client.
- **As tools** — `readServerGuide` and `readSkill`. Resources are usually user-attached, so an agent
  will not discover them on its own; a tool is already in its context.

Both are drill-downs on purpose. `readServerGuide` with no arguments answers an index of guides and
their section headings, and a section is then fetched by number or title. `readSkill` with no
arguments lists collections and skill names, `collection` adds descriptions, and `skill` returns the
SKILL.md. The guide registry is [`src/lib/guides.ts`](../src/lib/guides.ts); skills are discovered
from [`skills/`](../skills) by [`src/lib/skills.ts`](../src/lib/skills.ts).

### 2.7 What this server is bound to

A server is bound to one backend for its whole life and cannot switch at runtime. When several are
registered — one per environment, account or tenant — an agent has to pick the right one, and tool
names alone do not say. So `backend.describe()` is announced in the MCP **`instructions`**, which a
client sees at `initialize` before it calls anything, and repeated by `healthcheck` as `boundTo`.

---

## 3. Profiles, the response budget and the capability gate

### 3.1 Profiles

`MCP_PROFILE` selects which tools are **listed and routed** ([`src/lib/profiles.ts`](../src/lib/profiles.ts)).
Every tool schema costs tokens, and a client that cannot fetch schemas on demand pays for the whole
list on every turn — for a small local model that is where "the same prompt works half the time"
comes from. A profile is therefore a safety property as well as a menu: `readonly` cannot write,
because the write tools are not routed. An unknown profile name fails at startup, and a profile that
names a tool no handler provides fails at startup too, so a rename cannot silently drop a tool.

### 3.2 The response budget

Each profile carries a ceiling on one answer ([`src/lib/responseBudget.ts`](../src/lib/responseBudget.ts)):
`core` 24,000 bytes, `readonly` 32,000, `all` none. `MCP_MAX_RESPONSE_BYTES` overrides it; `0`
removes it. It is enforced in one place, `serializeResult()`, so a tool added tomorrow is covered
without being told. Over the ceiling, the answer is replaced by valid JSON — never a cut-off
fragment, which would not parse and which a model answers by retrying. The replacement carries the
tool's own `narrowingHint` as `nextStep`.

Truncating is a runaway guard, not the design. A tool that overruns *routinely* should grow a real
argument — a row limit, a summary mode, a section — so the caller chooses what to leave out.

### 3.3 The capability gate

Backends differ: a plugin, an optional module, a newer API version. On first use the server asks the
backend once, through `capabilities()`, and withholds tools whose `needsFeature` it lacks
([`src/lib/capabilityGate.ts`](../src/lib/capabilityGate.ts)). This happens before `tools/list`
answers, so no client needs `tools/list_changed`.

**Every failure path leaves the gate empty and the list complete.** Hiding a tool that would have
worked is worse than offering one that errors, because the first is invisible. `MCP_GATE=off` skips
the question entirely.

---

## 4. Golden paths

### 4.1 Find a record and see who changes it

```jsonc
{"tool":"findRecords","args":{"text":"iron sword","types":["WEAP"]}}     // who defines it, who wins, how many override it
{"tool":"readRecord","args":{"record":"IronSword","allVersions":true}}   // every plugin's version, winning first
{"tool":"findRecords","args":{"records":["01E718:Skyrim.esm","013989:Skyrim.esm"]}} // what the FormIDs in it are
```

`readRecord` answers in project text, so a version can be mirrored or copied as it stands. Every
reference inside it is a FormID: resolve the ones you reason about with `findRecords` and `records`.

### 4.2 Patch another mod's records

```jsonc
{"tool":"addPatch","args":{"project":"IronSwordBuff","records":["IronSword"]}}   // copies the winning version in
// edit projects/IronSwordBuff/plugin/Weapons/IronSword - 012EB7_Skyrim.esm.yaml with your file tools
{"tool":"buildProject","args":{"project":"IronSwordBuff"}}     // checks every reference, writes the plugin
{"tool":"deployProject","args":{"project":"IronSwordBuff"}}    // into Mod Organizer, at the end of the load order
```

The copy comes from the **winning** version, so what other mods changed in the record is kept. Change
only the fields you mean to change; the rest of the override must stay as copied. To add to a leveled
list, keep every entry and add yours.

### 4.3 Make a new mod

```jsonc
{"tool":"newProject","args":{"project":"FrostBlade"}}
// write projects/FrostBlade/plugin/Weapons/FrostBlade.yaml — no FormKey line; mirror a vanilla weapon read with readRecord
{"tool":"buildProject","args":{"project":"FrostBlade"}}        // assigns 000800:FrostBlade.esp, renames the file
{"tool":"deployProject","args":{"project":"FrostBlade"}}
```

A new item nothing places is unobtainable: add it to a leveled list, a container or a recipe too —
the record family skills say how.

### 4.4 Bring Creation Kit work back

After placing objects or generating navmesh in the Creation Kit (started through Mod Organizer):

```jsonc
{"tool":"pullProject","args":{"project":"FrostBlade"}}     // refuses while the project has uncommitted changes
// review with git diff; commit
{"tool":"buildProject","args":{"project":"FrostBlade"}}
{"tool":"deployProject","args":{"project":"FrostBlade"}}
```

### 4.5 Find out what you are connected to

```jsonc
{"tool":"healthcheck","args":{}}
```

`boundTo` names the backend, `health` says whether it answers, `tools.profile` and `tools.listed`
say what you can call, and `tools.withheldForBackend` names anything gated. It never connects to the
backend, so it answers when nothing else does.

---

## 5. Response and error model

### 5.1 Success

Handlers return the MCP shape directly and `serializeResult()` passes it through, so a client gets
**one** level of JSON:

```jsonc
{ "content": [ { "type": "text", "text": "{\"status\":\"success\",\"total\":1,\"records\":[…]}" } ] }
```

Parse `content[0].text` once. The envelope is compact, never pretty-printed: indentation costs
response budget and buys a model nothing.

### 5.2 Errors

`handleError()` turns a thrown error into a **non-throwing** tool result:

```jsonc
{ "content":[{"type":"text","text":"{\"error\":\"…\",\"code\":-32602}"}], "isError": true }
```

- An `McpError` keeps its message and code.
- Anything else keeps its **message** (only the code becomes `InternalError`), and the stack goes to
  stderr for the operator.

| Code | Meaning here |
| --- | --- |
| `-32601` MethodNotFound | No such tool, or it exists but is outside the active profile — the message says which |
| `-32602` InvalidParams | An argument is missing or wrong; the message says what to send |
| `-32600` InvalidRequest | A semantic refusal, e.g. a tool withheld for this backend |
| `-32603` InternalError | Everything else, including backend failures — with the backend's message |

### 5.3 Logging

[`src/lib/logger.ts`](../src/lib/logger.ts) writes every level to **stderr**, because stdout is the
MCP protocol channel. Every tool call logs one `info` line with its timing and the handler's
cumulative metrics; the same counters are readable through `healthcheck`.

---

## 6. Troubleshooting matrix

Start with `healthcheck`.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| The server does not start; the client shows no tools | The eager connect failed, which exits before the transport is up | The startup error on stderr carries the backend's message and, when the backend has a probe, what the probe found |
| `healthcheck` → `status: "degraded"`, `session.refused` set | The backend refused the credential, and the server will not retry it | Fix the credential and restart. Retrying would only risk locking the account |
| `healthcheck` → `health.ok: false` | The backend's own probe failed | Read `health.summary` — it names the layer that refused |
| "exists but is not in the active profile" | The tool is outside `MCP_PROFILE` | Use a listed tool, or start the server with a larger profile |
| "does not offer … calling it again will not help" | The capability gate withheld the tool for this backend | Not a request problem. `healthcheck` lists `withheldForBackend` |
| `status: "truncated"` | The answer was over the profile's response budget | Do what `nextStep` says; or raise `MCP_MAX_RESPONSE_BYTES` |
| "No record with editor ID …" / "No record … in the load order" | A guessed or misspelled ID, or a plugin that is not active | Find it with `findRecords`; check the plugin is active in the selected profile |
| `buildProject` → "link(s) point at records that exist neither…" | A FormID typed by hand, or a master that is not active | Resolve each with `findRecords` and fix the file |
| `buildProject` → "cannot be written from the project's text" | A record whose fields Mutagen cannot write | Compare it with a vanilla record of the same type (`readRecord`) and fix the fields |
| `buildProject` → "no Papyrus compiler" / ".NET Framework 3.5" | The machine lacks what compiles scripts — not a fault in the project | Install what the message names, then build again |
| `deployProject` → "changed since the last deploy" | The deployed plugin was saved in the Creation Kit or xEdit — perhaps into overwrite | `pullProject`, review, commit, then build and deploy; deploy then clears the pulled copy from overwrite |
| `deployProject` → "… would hide this deploy from the game" | A plugin of the same name in overwrite would hide a first deploy | Pull it if it is this project's work; otherwise move it out of overwrite in the mod manager |
| `deployProject` → "changed since its last build" | Project text is newer than the build | `buildProject` first |
| `pullProject` → "uncommitted changes" | The project folder has uncommitted work | Commit it, so the pull shows on its own in `git diff` |
| "The plugin helper is not built" | `helper/bin` is missing | `npm run build:helper` (needs the .NET 10 SDK) |
| `buildProject` → "needs .NET Framework 3.5" | The Creation Kit's Papyrus compiler is a .NET 2.0 program | Turn on ".NET Framework 3.5" in Windows Features, once. The server checks before starting the compiler, because a missing 3.5 makes Windows open an install dialog for every attempt |
| The first lookup takes ~10 s, later ones well under 1 s | The helper indexes the load order once after it starts, and again after a deploy or a changed plugin | Nothing to fix; `healthcheck` right after start says the helper is starting |
| `healthcheck` → active plugins "have no file" | A plugin in the load order whose mod is disabled or gone | Fix the profile in Mod Organizer |
| `Unknown tool: X` | Not in the catalogue at all | `tools/list` — the router is derived from it |
| Duplicate-tool warning on stderr at startup | Two handlers declare the same name | Rename one; the second is ignored |
| MCP stream breaks / client reports protocol errors | Something wrote to **stdout** | Never `console.log`; use `this.logger`. `npm run smoke` catches it |
| HTTP: `401` "Missing or malformed Authorization" | No bearer token on `initialize` | Send `Authorization: Bearer <token>` — see [`Hosting.md`](./Hosting.md) |
| HTTP: `401` "opened with a different credential" | A session id reused with another token, or none | Send the same token on every request of a session |
| HTTP: `403` Origin or Host not allowed | The DNS-rebinding guard | `MCP_HTTP_ALLOWED_ORIGINS` / `MCP_HTTP_ALLOWED_HOSTS` |
| HTTP: `429` | The per-session rate limit | Back off for `Retry-After` seconds, or raise `MCP_HTTP_RATE_LIMIT` |

---

## 7. Test suites

`npm test` runs everything offline. Arguments for the contract suites are generated from each tool's
own `inputSchema`, so **a new tool is covered the moment it is listed**.

| Suite | Covers |
| --- | --- |
| `handlerContract.test.ts` | **Every tool**: one single-level MCP envelope; a backend failure reported as an `McpError`, never as `status:"success"`; delegation to the backend; `{}` and `undefined` arguments survived without a raw `TypeError`; all four annotations. Plus spot checks pinning the arguments handed to the backend. |
| `toolDefinitions.test.ts` | The catalogue: unique camelCase names, routability, descriptions on every tool and argument, valid `required`, no `optional`, element schemas on arrays, structured arguments declared as such. |
| `server.test.ts` | Through a real MCP client: `initialize` and `instructions`, `tools/list` per profile and the four hints on the wire, resources, routing and profile boundaries, the capability gate failing open, connect-on-demand, the single retry, the permanent-failure latch, `healthcheck`, the response budget, startup failure messages. |
| `httpTransport.test.ts` | Streamable HTTP: bearer-token gate, one backend per caller, a session bound to its token, session-id routing, origin and host allow-lists, CORS preflight, the rate limit, and the shipped backend factory end to end. |
| `profiles.test.ts` | Profile resolution and application; every member exists; `readonly` holds only tools whose own annotations say read-only. |
| `responseBudget.test.ts` | Budget resolution, byte counting, the replacement answer, and that the tools that run large carry a specific `narrowingHint`. |
| `capabilityGate.test.ts` | Gating, failing open, and that every `needsFeature` names a real feature. |
| `guides.test.ts`, `skills.test.ts` | Against the real files: every guide exists and has sections, section extraction, the drill-down tools, path traversal refused. |
| `toolDocs.test.ts` | The generated `Tool-Reference.md` matches what the code renders. |
| `serverManifest.test.ts` | `server.json` against the code: name, version, every environment variable read is declared and vice versa, required and secret flags. |
| `skyrimBackend.test.ts` | Against a real Mod Organizer instance laid out in a temp folder, with a scripted helper: reading the ini, mod priority and the load order; the profile edits deploy makes; FormID assignment; text sync; and the whole patch, build, deploy and pull cycle with each of its refusals. |

`npm run smoke` drives the **built** server over real stdio and fails if anything but protocol frames
reaches stdout.

---

## 8. Extending the server

### 8.1 Adding a tool

A one-file change. Add a `ToolSpec` to the handler's `toolSpecs()`:

```ts
{
  definition: {
    name: 'listMasters',
    annotations: {
      title: 'List masters',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description: 'One sentence an agent can select on: what it needs, what it returns, what it changes.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'A plugin file name, e.g. "Dawnguard.esm".' }
      },
      required: ['plugin']
    }
  },
  onFailure: 'Failed to list the masters',
  // Returns plain data. A bad argument throws McpError(InvalidParams); asRequestError turns the
  // backend's own "that is about your request" failures into the same.
  run: args => asRequestError(this.backend.listMasters(requireString(args, 'plugin')))
}
```

Then, in the same change: `npm run build && npm run docs:tools` to regenerate the reference; a row in
[`Tool-Router.md`](./Tool-Router.md) if the tool answers a question someone would ask in their own
words; the tool's name in [`profiles.ts`](../src/lib/profiles.ts) if a small profile should list it.
`tools/list`, the router and the contract tests pick it up by themselves.

Do not build `{content:[…]}` in `run` — `BaseHandler` wraps it, and wrapping twice nests JSON inside
JSON. Return an object with its own `status` only when `success` would be untrue.

### 8.2 Adding a tool family

A new handler class `extends BaseHandler` and implements `toolSpecs()`. Add it to `createHandlers()`
in [`src/handlers/index.ts`](../src/handlers/index.ts) — the one list the server serves, the reference
documents and the tests check — and give it a display label in `LABELS` in
[`src/lib/toolDocs.ts`](../src/lib/toolDocs.ts) if the class name does not read well.

### 8.3 Adding a guide

Add one entry to `GUIDES` in [`src/lib/guides.ts`](../src/lib/guides.ts). It appears as a resource
and as a `readServerGuide` topic, and its id is added to the tool's schema automatically. Number the
headings (`## 1.`, `### 1.1`) so an agent can ask for a section by number.

### 8.4 Adding a skill

Add a directory with a `SKILL.md` (frontmatter `name` and `description`) under a collection in
[`skills/`](../skills). It is discovered on the next start — no rebuild, no registry.

### 8.5 Renaming a tool

Rename it, put the old name in `TOOL_ALIASES` in `server.ts` so existing clients keep working, and
update any profile that lists it — `applyProfile` fails at startup otherwise, which is the point.
