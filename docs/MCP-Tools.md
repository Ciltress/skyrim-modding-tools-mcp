# How this server behaves

> **Audience:** humans *and* LLM agents using this server.
> **Source of truth:** the handler classes in [`src/handlers`](../src/handlers) and the server in
> [`src/server.ts`](../src/server.ts). A contradiction between this document and the code is a bug
> in one of them — fix it, do not work around it.

This server works on one **instance** of Skyrim Special Edition, kept by a **mod manager** — Mod
Organizer 2, or Amethyst on Linux. It looks records up across the active load order, and it builds
mods kept as text **projects** into plugins deployed to that instance. It exposes those operations as **tools**, and its own documentation and modding
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
   description and a type, and closed value sets carry an `enum`. An argument sent as text for its
   declared type is taken as that type: a list as JSON text (`"[\"IronSword\"]"`), one item where a
   list is declared (`"IronSword"`), a number or `true`/`false` in quotes. Handlers validate the
   rest and answer `InvalidParams` with a message that says what to send instead.

6. **Read the annotations before you write.** Every tool states `readOnlyHint`, `destructiveHint`,
   `idempotentHint` and `openWorldHint`. `deployProject` and `pullProject` are destructive: they
   replace a mod folder in the mod manager, and a project's text. Every write here is idempotent —
   repeating it with the same inputs leaves the same state.

7. **A failed call is a result, not an exception.** You get `isError: true` and a JSON body with
   `error` and `code`. The message is written to tell you the next step; read it before retrying.

8. **Never log to stdout** (for anyone extending the server). It speaks MCP over stdio, and anything
   on stdout that is not a protocol frame corrupts the stream for every tool at once.
   [`src/lib/logger.ts`](../src/lib/logger.ts) writes every level to **stderr** for that reason.

9. **Domain rules.**
   - **Records are changed by editing project text** with your ordinary file tools — read, edit,
     write the YAML files in a project's `plugin/` folder. No tool edits a record.
   - **A `path` in an answer is a full path**, ready for your file tools; `addPatch` adds the file's
     text, so you can edit it at once. A path relative to something says so in its name:
     `readRecord`'s `pathInPluginFolder`.
   - **FormIDs are written `012EB7:Skyrim.esm`**, never as a load-order hex like `00012EB7`. Never
     guess one: find it with `findRecords`, which also turns the FormIDs in project text into names.
   - **A new record's file leaves `FormKey` out.** `buildProject` assigns one and writes it back;
     after that it never changes. A `FormKey` copied from another record makes the file an override
     of that record, so where the editor ID differs from the record it names, the build takes the line
     out and says so in `corrected` — in addPatch's copy of that record too, since eval round 34. So
     too the project's own FormKey past a light plugin's last FormID, 000FFF, since eval round 35.
   - **A link may name its record by editor ID.** `buildProject` writes that record's FormID into the
     file — the project's own record first, then the load order's — and lists it in `resolvedLinks`,
     so a new record can point at another one written in the same go.
   - **Change other mods through a patch** (`addPatch`), never in their plugins: an override copied
     from the winning version keeps every other mod's changes, and survives their updates.
   - **Build, deploy and pull are explicit steps.** Deploy refuses a stale build and refuses to
     overwrite a plugin the Creation Kit changed; pull refuses while the project has uncommitted
     changes. Each refusal names the step to take first.
   - Read the `skyrim-modding-basics` skill before modding, and the record family's skill before
     touching one of its records.

| profile | listed | for |
| --- | --- | --- |
| `core` | 12 | look up, patch, build, deploy; list the mods, check them against the game, install or disable one — small local models |
| `readonly` | 9 | looking records and mods up only; the write tools are absent, not discouraged |
| `all` | 17 | the default; right for clients that fetch tool schemas on demand |

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
| `openWorldHint` | The call reaches past the instance this server is bound to, into an outside service: reading Nexus Mods (`searchNexus`, `readNexusMod`), sending, publishing, pushing to an external remote. `false` everywhere else. |

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
| `handle(name, args)` | Dispatches to `run`, never with `undefined` args, and with any argument sent as text for its declared type turned into that type (`coerceArgs` in [`args.ts`](../src/handlers/args.ts)); times the call; wraps the payload; maps errors. |
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

Behind it sit three parts, and two seams ([ADR-0007](adr/0007-operating-system-and-mod-manager-are-separate-seams.md)):

- **The mod manager** ([`modManager.ts`](../src/backend/skyrim/modManager.ts)) rebuilds what a program
  started outside it cannot see — which file each active plugin really is — from the instance's
  settings, the selected profile's mod order and load order, and the mods' folders, and makes the few
  profile changes deploy needs. [`mo2Manager.ts`](../src/backend/skyrim/mo2Manager.ts) is Mod
  Organizer's ([`mo2.ts`](../src/backend/skyrim/mo2.ts) reads, [`mo2Profile.ts`](../src/backend/skyrim/mo2Profile.ts)
  writes); [`amethyst.ts`](../src/backend/skyrim/amethyst.ts) is Amethyst's. `SKYRIM_MOD_MANAGER`
  chooses; what differs by operating system is in [`platform.ts`](../src/backend/skyrim/platform.ts).
- **The plugin helper** ([`helper/`](../helper), [ADR-0003](adr/0003-plugins-through-a-mutagen-helper.md))
  is a .NET process built on Mutagen that does every plugin read and write, and writes project text in
  Spriggit's format. It speaks one JSON object per line on stdio, keeps the load order open between
  calls, and indexes it in the background. [`helperClient.ts`](../src/backend/skyrim/helperClient.ts)
  is its client.
- **The engine** ([`engine.ts`](../src/backend/skyrim/engine.ts)) owns the helper and keeps its load
  order in step with the mod manager: before each call it compares a fingerprint of the profile's files
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
SKILL.md. A loose name reads the skill it means, answered under its real name: `npc` or `npcs` for `skyrim-modding-npcs`,
`weapon` for the skill whose description leads with weapons, and a skill sent as the `collection`
(`items`) or as `name`, the way OpenClaw's own `skills_read` takes it (since eval round 35; answered
with the index before, the skill went unread in 24 runs of rounds 23–34). The guide registry is [`src/lib/guides.ts`](../src/lib/guides.ts); skills are discovered
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

**The exception is Nexus, by the user's decision.** The Nexus tools need `nexus-api-key` — a key in
`NEXUS_API_KEY` — and `downloadNexusFile` needs `nexus-premium` as well, which the backend reports only
when Nexus *confirms* the key is a premium account's. A key Nexus could not check, or not within 5 s,
is not confirmed: the download is withheld, and a restart asks again. The backend always reports
`instance` too, so its list is never empty — an empty one would gate nothing — and it answers within
the server's 8 s, so a slow Nexus cannot leave the gate empty either.

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
// added[].files holds the copy's full path and text: edit it with your file tools
{"tool":"buildProject","args":{"project":"IronSwordBuff"}}     // checks every link, writes the plugin
{"tool":"deployProject","args":{"project":"IronSwordBuff"}}    // into the mod manager, at the end of the load order
```

The copy comes from the **winning** version, so what other mods changed in the record is kept. Change
only the fields you mean to change; the rest of the override must stay as copied. To add to a leveled
list, keep every entry and add yours.

### 4.3 Make a new mod

```jsonc
{"tool":"newProject","args":{"project":"FrostBlade"}}
// write projects/FrostBlade/plugin/Weapons/FrostBlade.yaml — no FormKey line; mirror a vanilla weapon read with readRecord
// and its enchantment, ObjectEffects/FrostBladeEnch.yaml; the sword names it as `ObjectEffect: FrostBladeEnch`
{"tool":"buildProject","args":{"project":"FrostBlade"}}        // assigns 000800 and 000801 in the two files, writes
                                                               // 000800:FrostBlade.esp in place of FrostBladeEnch
{"tool":"deployProject","args":{"project":"FrostBlade"}}
```

A new item nothing places is unobtainable: add it to a leveled list, a container or a recipe too —
the record family skills say how.

### 4.4 Bring Creation Kit work back

After placing objects or generating navmesh in the Creation Kit (started through Mod Organizer, or in
the game's prefix with Amethyst):

```jsonc
{"tool":"pullProject","args":{"project":"FrostBlade"}}     // refuses while the project has uncommitted changes
// review with git diff; commit
{"tool":"buildProject","args":{"project":"FrostBlade"}}
{"tool":"deployProject","args":{"project":"FrostBlade"}}
```

### 4.5 Find a mod on Nexus, check what it needs, install it

```jsonc
{"tool":"searchNexus","args":{"text":"realistic water"}}   // most endorsed first; modId, version, author, page
{"tool":"readNexusMod","args":{"modId":2182}}              // description as text, requirements, the files it offers now
{"tool":"downloadNexusFile","args":{"modId":2182,"fileId":705147}}   // into the instance's downloads folder
{"tool":"installMod","args":{"file":"Realistic Water Two SE v5.7.3-2182-5-7-3-1767473625.7z"}}
// a FOMOD installer: status "chooseOptions", its steps, every option with an id; nothing is written
{"tool":"installMod","args":{"file":"Realistic Water Two SE v5.7.3-2182-5-7-3-1767473625.7z","choices":["2.1.1","3.1.6"]}}
```

The Nexus tools are listed only with a key in `NEXUS_API_KEY`. Recommend a mod only with its
`requirements` checked against what the instance has — an SKSE plugin without SKSE does nothing, and
one built for another game version crashes it. `downloadNexusFile` is listed only when Nexus confirms
the key is a premium account's (`health.nexus` says whether it is); it writes the file and Mod
Organizer's `<file>.meta` record beside it. Without it, the user downloads the file into the downloads
folder themselves; `installMod` is listed either way.

`installMod` takes any `.7z`, `.zip` or `.rar` there. Without a FOMOD installer it installs the
file's Data folder at once — the top, a `Data` folder or the one folder there is; when that is not
clear (`1K/`, `2K/`), it asks for `root`. With one, the first call answers the steps and the second
installs the `choices`; a group the choices leave out keeps the installer's default, and options the
load order decides — a patch for a mod that is there — are defaults already. The mod is enabled, its
plugins activated at the end of the load order (masters first) — a plugin an active plugin already
needs as a master goes right before that one instead (`placedBefore`), as when a mod is installed for
a plugin that named it in `missingMasters`, or installed again after `disableMod` — and the mod
manager told, as for `deployProject`. Its `meta.ini` names the Nexus mod and file, so Mod Organizer's update check knows
it. `missingMasters` lists plugins the game cannot load until another mod is installed.

### 4.6 Find out what you are connected to

```jsonc
{"tool":"healthcheck","args":{}}
```

`boundTo` names the backend, `health` says whether it answers, `tools.profile` and `tools.listed`
say what you can call, and `tools.withheldForBackend` names anything gated. `health.nexus` is the
Nexus account behind `NEXUS_API_KEY` — its name and whether it is premium, `apiKey: false` without a
key — and never counts against `health.ok`. It never connects to the backend, so it answers when
nothing else does; the account check waits at most 3 s for Nexus.

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
| "'WEPN' is not a record type. Did you mean WEAP (Weapon)?" | A misspelled signature or type name in `findRecords`' `types` | Send one the message suggests; a type that exists but has no records answers `total: 0` instead |
| `buildProject` → "link(s) point at records that exist neither…" | A FormID typed by hand, or a master that is not active | Resolve each with `findRecords` and fix the file |
| `buildProject` → "cannot be written from the project's text" | A record whose fields Mutagen cannot write | Compare it with a vanilla record of the same type (`readRecord`) and fix the fields |
| `buildProject` → "has no records to build" | No record file in the plugin folder — often written into the project folder instead, which the message then names | Write each record where `newProject`'s `writeRecordsTo` says: `<project>/plugin/<group folder>/<name>.yaml` |
| `buildProject` answers `built_with_warnings`: "record file(s) outside the plugin folder were not built" | Record files in the project folder, which no build reads; with records in the plugin folder they stop nothing | Write a record meant for the mod into its group folder in the plugin folder; a copy of one already there can stay |
| `buildProject` answers `built_with_warnings`: "record file(s) the build does not read were not built: …, whose record … holds" | A file in a folder that is no group, or below a group's folder, whose record its group's folder holds too; or a `.yml` file beside its `.yaml` twin | Nothing to fix; delete the left-out file when the client can |
| `buildProject` → "cannot be built as written: … has no field X (it goes under Y)" / "(it is spelled Effects)" / "(an enchantment is ObjectEffect…)" | A field the record type does not have — invented, misspelled, singular for plural, another name for one it has (a weapon's `Enchantment`), or written on the wrong record or level (a magic effect's `Magnitude` belongs to the spell's `Effects`); or a folder that is no group (`NPCs` for `Npcs`). A field with one place to go the build moves itself since eval round 33 (see `corrected` below) | Do what the hint in brackets says; else write the record the way `readRecord` shows one of its type: the same field names, nesting and folder |
| `buildProject` → "… is in a folder below Spells/, where the build reads no record" | A record file nested below its group's folder (`Spells/Spells/…`); only cells, worldspaces and dialogue nest | Put it directly into its group's folder, as the message names it. Once the group's folder holds the record — by that name or editor ID — the nested file is left out with a warning, so a client that cannot delete it is not stuck |
| `buildProject` → "…, lines 1 and 21: a markdown fence" | A record copied with the fence an answer shows it in (```` ```yaml ````) | Delete the fence lines; a record file holds only the record's YAML |
| `buildProject` answers with `corrected`: "…, line 3 (two backslashes): `File: Weapons\\Iron\\…` → `File: Weapons\Iron\…`" / "(a backslash before a quote)" / "(a backslash at the end of the line)" / "(line breaks written as \n): `…` → 6 lines: …" / "(a backslash before an apostrophe)" | A record copied out of a JSON answer as it reads — every backslash doubled, every quote escaped, a text's line breaks as `\n` — or a `\n` whose line break was written for real and its backslash kept. Not a refusal since eval round 32: the build writes each line as the arrow shows, at its indentation, and builds (a quest's `Filter:` may end in a backslash, as the Creation Kit writes it) | Nothing to fix. Edit those lines as they are now in the file; a refusal that comes after names them as "Corrected in the files already" |
| `buildProject` answers with `corrected`: "…: removed `FormKey: 012EB7:Skyrim.esm` — … is IronSword of Skyrim.esm, and this file makes FlameBlade" / "names no record in the load order" / "is no record's FormID" / "'…' is no FormKey" | A `FormKey` line copied into a new record from the record read as an example, invented, or a placeholder like `000000`. Not a refusal since eval round 32: the build takes the line out and numbers the record | Nothing to fix. An override keeps the editor ID of the record it changes. addPatch's copy given another editor ID is a new record too since eval round 34 ("addPatch's copy of it was given the EditorID …, which makes it a new record"): refused as an override renamed, it ended a run of round 33. The project's own FormKey past 000FFF in a light plugin too since eval round 35 ("… is past the last FormID a light plugin has, 000FFF"), and a link to it in another of the project's files names its editor ID instead ("the link to … now names …"): Mutagen refused the plugin as "out of bounds for the given record compaction settings", naming no file, and a run of round 34 gave up |
| `buildProject` answers with `corrected`: "…: moved `Level`, `CalcMinLevel`, `CalcMaxLevel` under `Configuration` — a Npc has them there, not at the margin" / "moved `Value` under `BasicStats`" / "moved `CalcMinLevel`, `CalcMaxLevel` out of `Configuration.Level` up to `Configuration`, below `Level` — they are not fields of Level" | A field written where its record's type has none, with one place to go: a part's field at the margin — an NPC's level, a weapon's `Value` — or a field a level too deep, inside one of the record's parts or in a part's braces. Not a refusal since eval round 33: the build moves the lines there, as deep as that part's fields, and builds. 13 of the 27 runs e4b failed in rounds 23–32 had been told to move a field | Nothing to fix. Still refused, with the move to make: a field its place has already, one that goes "in each item of Effects", and one whose part is of several kinds and not written yet (a magic effect's `Archetype`) |
| `buildProject` → "have the same FormKey" | Two files with one `FormKey` — one copied twice, or invented for two new records | Remove the line from each new record — the build gives each a FormID of its own |
| `buildProject` → "FormKey is the first line of a record file" | A line written above `FormKey:` — the reader takes the first line for it | Move `FormKey:` to the top (below `MutagenObjectType:` where a record has one) |
| `checkGameVersion` → `refusedAtLastStart` | SKSE did not load the plugin at the last game start; `reason` quotes SKSE's log | `readNexusMod` with the mod's `nexusModId`: a file built for this game version, or for Address Library after 1.7.99; else ask the user whether to disable the mod (`disableMod`) |
| `checkGameVersion` → `willNotLoad` | The plugin names other game versions only, is 32-bit, is made for 1.5.97, or needs Address Library or a newer SKSE | As above; for Address Library or SKSE, install that |
| `checkGameVersion` → `mayNotWork` | An Address Library plugin built before 2025-05-26, without the flag for 1.7.99's Address Library: SKSE loads it, and it may look addresses up wrong | Try the game first — it often still works; a newer file of the mod is the safe way |
| `checkGameVersion` → `log.used: false` | SKSE's log is another game folder's, or from before a game update | Start the game once through SKSE, then check again |
| `buildProject` → "field(s) cannot be built as written: … names X, and no record has that editor ID" | A link written as an editor ID that no record of the field's type has (`Race: Nord`), or a record of the project without an `EditorID` line | Use one of the editor IDs the message offers, give the project's record the `EditorID` line it names, or write the FormID from `findRecords` |
| `buildProject` → "field(s) cannot be built as written: Race is 02C65A:Skyrim.esm, which is RedguardRaceChild, but the comment after it names NordRace" | A FormID written from memory beside the editor ID of the record meant: the build reads the FormID and skips the comment | Write the link by the editor ID of the one meant — the message offers both lines |
| `buildProject` → "field(s) cannot be built as written: … Name is written as one value" | A text written as `Name: Hilda` | Write it on two indented lines below `Name:` — `TargetLanguage: English` and `Value: Hilda` |
| `buildProject` → "field(s) cannot be built as written: … has no field X" / "is a field of several kinds" / "takes a list" / "takes fields of its own" / "the YAML breaks at line N" | A record's shape below its top level: a field one level off, a `Level:` without its `MutagenObjectType:`, a list where fields belong or the reverse, broken indentation | Read a vanilla record of the type (the message names one) and write the field with its nesting |
| `buildProject` → "Data has no field ObjectEffect, EnchantmentAmount (move them up, keeping both: …)" | Fields of the record written a level too deep, inside one of its parts. Since eval round 33 the build moves them itself (`corrected`), unless the level above has them already | Keep the lines and move them as the message says: the spaces taken out in front, where they are the part's last lines; else deleted there and written again at the margin below it |
| `buildProject` → "NewBlade carries no enchantment, and no record of the project names the new FlameDamage" | A new enchantment that no record names, beside a weapon or armor of the project that carries none — the one meant to carry it | Write the lines the message gives into that record, right below its `EditorID:` line and at the margin: `ObjectEffect:` and `EnchantmentAmount: 500` in a weapon, `ObjectEffect:` alone in an armor. For a copy of a vanilla record, also delete its `FormKey` line and give it an `EditorID` of its own, unless every copy of that record in the game is meant to change. A project with no such weapon or armor builds with a warning instead: its enchantment may be another mod's |
| `buildProject` → `built_with_warnings`: "no record of the project names StormBoltEffect, so the magic effect does nothing — a spell casts it as `- BaseEffect: StormBoltEffect` among its `Effects`" | A new magic effect that no record of the project names, by editor ID or FormID — a spell's magic effect written without the spell. A warning since eval round 35: e4b built Storm Bolt's effect alone and answered (round 34). It may be another mod's, or one a script applies | Write the spell, enchantment, potion or scroll that casts it, naming it in its `Effects` |
| `buildProject` → "field(s) cannot be built as written: Archetype is written as one value, ShockDamage" | A part of the record, which takes fields of its own, written on one line | Write `Archetype:` alone on its line, then below it, two spaces in, `MutagenObjectType:` naming its kind and the kind's fields. Where the value is one of the part's fields (`Archetype: DualValueModifier`), the message gives that line |
| `buildProject` → "effect(s) would do nothing in game: … is a DualValueModifier that names no actor value" / "has no Archetype" | A new magic effect whose archetype changes an actor value — Value Modifier, Peak Value Modifier, Dual Value Modifier, Absorb, or none written, which reads as a Value Modifier — that names none. Each of the official plugins' 1,133 such effects names one | Write `ActorValue:` under `Archetype`, as deep as its other lines — `Health` for damage. Where `Archetype` is missing, the message gives the whole block |
| `buildProject` → "the YAML breaks at line N … the line is part of the text under `Value: >-`" | A long text's later lines written at the margin, or less deep than its first: YAML ends the text there and reads the rest as fields | Indent every line of the text as deep as its first — the message gives the depth and the line re-indented |
| `buildProject` → "the YAML breaks at line 2 … VersionControl is written twice, on lines 1 and 2" / "DefaultOutfit is written twice, on lines 10 and 14" | A field written a second time — often a line removed by writing the line below it over it, or a record written from two vanilla ones | Delete one of the two lines the message names; where their values differ, keep the one meant. Two lines the same at the margin the build takes out itself since eval round 37 (`corrected`: "removed line 2, `VersionControl: 79128` — line 1 says the same") |
| `buildProject` → "Npcs/Hilda - 000800_HildaTheNord.esp.yaml and Npcs/Hilda.yaml have the same EditorID Hilda — one record written twice" | A record written again in a second file after a build numbered it — or after a pull named its file the way Spriggit does, as builds before eval round 30 did too: two records, one of them as it was. A file under Spriggit's name is known as the numbered one even when written again without its `FormKey` line | Make the changes in the file the message names, and write the other empty — the build leaves an empty record file out |
| `buildProject` → "the text under `Value: >-` (line N) runs on into `PickUpSound: …`" | The reverse: the record's own fields below a text indented with it, where they would be words of the text and the record would lack them | Write the line named and the field lines after it at the margin again |
| `buildProject` → "'Enchantments' is no group folder — the folder for them is ObjectEffects" | A folder named for what the record is — enchantments, notes, potions — not for its group | Write the file where the message says, `ObjectEffects/<name>.yaml` |
| `buildProject` answers `built_with_warnings`: "overrides X of Skyrim.esm and renames it" | A vanilla record copied whole — its `FormKey` and `EditorID` kept — and renamed: the build changes that record instead of making a new one | Meant as a change, nothing to do. Meant as a new record: remove the `FormKey` line and give it an `EditorID` of its own |
| `buildProject` answers `built_with_warnings`: "… has no Name, so the game shows it with none" | A new item, spell, shout or NPC written without `Name:`; an NPC with a `Template` is left out, as it may take its name from that | Write two lines indented below `Name:`, `TargetLanguage: English` and `Value:` with the name; a record the player never sees can go without |
| `buildProject` → "cannot be read as a record: … Line N is `…`" | A value the YAML reader cannot read: one value where the field takes fields of its own, text where a number belongs | Fix the line the message quotes, as a vanilla record of the type writes it |
| `buildProject` → "The build read no record from …" | Record files the reader took for none — the plugin would have been empty | Put each file directly into its group's folder, written the way `readRecord` shows one |
| `buildProject` → "no Papyrus compiler" / ".NET Framework 3.5" | The machine lacks what compiles scripts — not a fault in the project | Install what the message names, then build again |
| `deployProject` → "changed since the last deploy" | The deployed plugin was saved in the Creation Kit or xEdit — perhaps into overwrite | `pullProject`, review, commit, then build and deploy; deploy then clears the pulled copy from overwrite |
| `deployProject` → "… would hide this deploy from the game" | A plugin of the same name in overwrite would hide a first deploy | Pull it if it is this project's work; otherwise move it out of overwrite in the mod manager |
| `deployProject` → "changed since its last build" | Project text is newer than the build | `buildProject` first |
| `pullProject` → "uncommitted changes" | The project folder has uncommitted work | Commit it, so the pull shows on its own in `git diff` |
| "The plugin helper is not built" | `helper/bin` is missing | `npm run build:helper` (needs the .NET 10 SDK) |
| `buildProject` → "needs .NET Framework 3.5" | The Creation Kit's Papyrus compiler is a .NET 2.0 program | Turn on ".NET Framework 3.5" in Windows Features, once. The server checks before starting the compiler, because a missing 3.5 makes Windows open an install dialog for every attempt |
| The first lookup takes ~10 s, later ones well under 1 s | The helper indexes the load order once after it starts, and again after a deploy or a changed plugin | Nothing to fix; `healthcheck` right after start says the helper is starting |
| `healthcheck` → active plugins "have no file" | A plugin in the load order whose mod is disabled or gone | Fix the profile in the mod manager |
| `deployProject` → `modManager.status: "deployManually"` | Amethyst is open, so the server did not deploy behind its window — or its deploy command failed; under Proton, Mod Organizer started during the deploy | Do what `nextStep` says: Refresh, then Deploy in Amethyst; or restart Mod Organizer |
| `deployProject` → "Mod Organizer is running for this instance, and under Proton…" | Mod Organizer under Proton cannot be told to re-read its profile, and would write its own over the deploy when it exits | Close Mod Organizer, then deploy again ([Hosting](Hosting.md) §5) |
| "ModOrganizer.ini names 'D:\…', on a drive of the Wine prefix this server could not find" | Mod Organizer under Proton uses a drive other than `Z:`, and no prefix was named or found | Set `SKYRIM_WINE_PREFIX` to the prefix Mod Organizer runs in ([Hosting](Hosting.md) §5) |
| `healthcheck` → `notes`: another profile "deployed" | Amethyst has a different profile in the game than the one selected | Deploy the selected profile in Amethyst, or select the deployed one |
| Startup → "Missing required environment variables: SKYRIM_MO2_INSTANCE" | Mod Organizer is the default mod manager | Set the instance — or `SKYRIM_MOD_MANAGER=amethyst` |
| `searchNexus` / `readNexusMod` → "Nexus Mods could not be reached" | No internet connection from this machine, or Nexus is down | Check the connection; the instance's tools work without it |
| `searchNexus` / `readNexusMod` → "Nexus Mods answered HTTP 429" | Nexus's rate limit | Wait, then ask again — fewer calls, a narrower `text` |
| `healthcheck` → `health.nexus.problem`: "Nexus Mods refused the key in NEXUS_API_KEY" | A mistyped, revoked or regenerated personal API key | Copy the key from nexusmods.com/settings/api-keys into `NEXUS_API_KEY`, restart the server |
| `searchNexus`, `readNexusMod`, `downloadNexusFile` not listed; `tools.withheldForBackend` names them | `NEXUS_API_KEY` is unset — the Nexus tools are offered only with a key | Set a personal API key and restart; `installMod` works without one, on files the user downloads |
| `downloadNexusFile` not listed; `tools.withheldForBackend` names it | `NEXUS_API_KEY` is refused or not a premium account's — Nexus gives download links through its API to premium accounts only — or Nexus did not answer the key check when the server started (`health.nexus.unchecked`) | Set a premium account's key and restart, or restart once Nexus answers; otherwise the user downloads the file on the mod page |
| `downloadNexusFile` → "came out N of M bytes" | The download broke off; nothing was kept | Call it again |
| `newProject` / `addPatch` → "X is already a plugin in the load order" | The project's own plugin was given the name of one the instance has — often the plugin meant to copy from | Leave `plugin` out (the project gets `<project>.esp`); to copy from a plugin, pass it to `addPatch` as `from` |
| `installMod` → "A mod named 'X' is already in the instance" | The mod is installed, or another one has its name | `replace: true` to install over it (it keeps its place in the mod order), or `name` for a separate mod |
| `installMod` → "Which folder of X is the mod is not clear" | The file has several folders at the top — usually options, such as texture sizes | Read the mod page, ask the user, and call again with `root` |
| `installMod` → `missingMasters` | A plugin of the mod needs one that is not in the load order | Install the mod it comes from (`readNexusMod` → `requirements`); until then the game will not start |
| `installMod` → "cannot be opened as a .7z, .zip or .rar" | A broken or incomplete download, or another format | Download it again |
| `installMod` → "Mod Organizer is running for this instance, and under Proton…" | As for `deployProject` | Close Mod Organizer, then install again |
| `disableMod` → "No mod 'X' in the profile …" | A name not quite the mod's — the message lists the mods whose names hold it | Call again with the exact name; `listMods` with `text` finds it |
| `disableMod` → `missingMasters` | Active plugins of other mods need a plugin the disabled mod took out of the load order | Tell the user: the game will not start like this. Disable those mods too — on the user's word — or have the user enable the mod again |
| `disableMod` → "Amethyst is open…" | Amethyst writes its own state of the mods it knows over a change made outside it | The user closes Amethyst and the call is repeated, or the user unticks the mod in Amethyst and deploys |
| `disableMod` → "Amethyst has 'X' locked" / "is part of the game" / "is the mod of the project" | A mod the user locked on; MO2's DLC and Creation Club entries; a project's mod, which `deployProject` keeps enabled | The user unlocks it in Amethyst, or disables it in the mod manager themselves |
| `readNexusMod` → "No Nexus mod N for Skyrim Special Edition" | A guessed number, or a mod of another game (Skyrim LE, VR) | `searchNexus` for it; `modId` is the number in the page's address |
| `buildProject` on Linux → "a Windows program … SKYRIM_PAPYRUS_COMPILER" | The Creation Kit's Papyrus compiler does not run on Linux | Install russo-2025's compiler and name it in `SKYRIM_PAPYRUS_COMPILER` ([Hosting](Hosting.md) §4) |
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
| `handlerContract.test.ts` | **Every tool**: one single-level MCP envelope; a backend failure reported as an `McpError`, never as `status:"success"`; delegation to the backend; `{}` and `undefined` arguments survived without a raw `TypeError`; all four annotations; every argument sent as text for its declared type giving the same outcome as the real type, and text that is not that type refused with the argument named. Plus spot checks pinning the arguments handed to the backend. |
| `toolDefinitions.test.ts` | The catalogue: unique camelCase names, routability, descriptions on every tool and argument, valid `required`, no `optional`, element schemas on arrays, structured arguments declared as such. |
| `server.test.ts` | Through a real MCP client: `initialize` and `instructions`, `tools/list` per profile and the four hints on the wire, resources, routing and profile boundaries, the capability gate failing open, connect-on-demand, the single retry, the permanent-failure latch, `healthcheck`, the response budget, startup failure messages. |
| `httpTransport.test.ts` | Streamable HTTP: bearer-token gate, one backend per caller, a session bound to its token, session-id routing, origin and host allow-lists, CORS preflight, the rate limit, and the shipped backend factory end to end. |
| `profiles.test.ts` | Profile resolution and application; every member exists; `readonly` holds only tools whose own annotations say read-only. |
| `responseBudget.test.ts` | Budget resolution, byte counting, the replacement answer, and that the tools that run large carry a specific `narrowingHint`. |
| `capabilityGate.test.ts` | Gating, failing open, and that every `needsFeature` names a real feature. |
| `guides.test.ts`, `skills.test.ts` | Against the real files: every guide exists and has sections, section extraction, the drill-down tools, path traversal refused. |
| `toolDocs.test.ts` | The generated `Tool-Reference.md` matches what the code renders. |
| `serverManifest.test.ts` | `server.json` against the code: name, version, every environment variable read is declared and vice versa, required and secret flags. |
| `platform.test.ts` | The operating system's side: the Linux process table, file names matched without case, both Papyrus compilers' command lines, where a compiler is looked for on Linux (none on Windows) and that a named one wins. |
| `setup.test.ts` | `npm run setup`'s parts that decide something: `.env` set line by line with comments kept and values dotenv reads back, Claude Desktop's config merged (others kept, an unreadable one left alone), the Claude Code and VS Code registrations, OpenClaw's patch (the server, the skills folder added once, a modding agent created once and then left alone, the sole agent kept in its workspace), MO2's global instances for Skyrim, each package manager's install command, a Windows command line's quoting, the pinned compiler's checksum. |
| `sksePlugins.test.ts` | Whether an SKSE plugin fits a runtime, by the rules SKSE and Address Library apply (Amethyst's): 32-bit, 1.5.97's, runtimes listed (the store digit ignored), Address Library before 1.7.99's change as "may not work", 1.6.629's structs, Address Library's file, SKSE's version; SKSE's log read, and trusted only for this game, this runtime and an unchanged file; problems grouped by reason. Checked on LoreRim's 317 DLLs against its own log: no disagreement. |
| `pathSettings.test.ts` | Every path setting as a user writes it, on both systems' sides: `~`, `$NAME` and the `${…}` operators as a POSIX shell reads them, a variable not set refused, relative paths from the server's folder, drive letters, spaces, apostrophes, a Windows path on Linux, `%NAME%` and commands refused. A contract: every path setting goes through the one resolver, and every other variable the source reads is known not to be one. |
| `nexus.test.ts` | The Nexus Mods catalogue against trimmed copies of real GraphQL answers: the search's filter and order, a mod page's description as text (BBCode), requirements and current files, a long description cut, an unknown mod, Nexus unreachable or refusing. The account behind `NEXUS_API_KEY` (never the key or e-mail in the answer; checked once, again after a failed check), and downloads: the file and its `.meta`, the key sent to the API but never to the CDN, a file already there kept, a short download leaving nothing, no key or no premium account said in words. |
| `mo2Proton.test.ts` | Mod Organizer under Proton, against an MO2-LINT-style setup: the ini's Windows paths read through the Wine prefix, finding the prefix (`SKYRIM_WINE_PREFIX`, MO2-LINT's `state.json`), the deploy refused while this instance's Mod Organizer runs, `refresh` never started, the `healthcheck` notes. A real `dosdevices` folder only on Linux, since Windows forbids its `c:` names. |
| `amethyst.test.ts` | Against an Amethyst setup laid out as Amethyst 2.5.4 does (Flatpak config, custom staging, a hardlink deploy with `Data_Core`): the mod manager chosen by what is configured when `SKYRIM_MOD_MANAGER` is unset, and said in `healthcheck`; finding it, reading the profile, adding only new lines, its deploy command, and deploy, pull, install and disable through the backend — a locked mod refused, and any change to lines it knows while it is open. |
| `skyrimBackend.test.ts` | Against a real Mod Organizer instance laid out in a temp folder, with a scripted helper: reading the ini, mod priority and the load order; the profile edits deploy and install make; FormID assignment; text sync; the whole patch, build, deploy and pull cycle with each of its refusals — a build of no records, record files outside the plugin folder, files the helper refuses before any is numbered, and a build — failed or not — that leaves every file under its name; listing the mods — lowest priority first, separators, a short row or details (plugins and which copy loads, the whole Nexus record), SKSE plugins, pages; and installing a downloaded file — the mod, its `meta.ini`, the download marked installed, a FOMOD's question writing nothing, `root`, `replace` keeping the mod order, missing masters, a project's mod refused; and disabling a mod — where it stands, its plugins out of `plugins.txt` and `loadorder.txt` unless another mod has them, a second call changing nothing, the plugins left needing one taken out, a name found whatever its case or answered with the closest, the game's own entries and a project's mod refused. |
| `installer.test.ts` | What installMod decides before writing: a plain file's Data folder, and a FOMOD installer's numbering, order, defaults, option types and steps decided by the load order or by flags, and the files a set of choices installs — paths relative to the installer's folder, folders and files placed as the schema says, priority, folder spelling, unknown or forbidden choices refused. The default mod name from the download's record or Nexus's file names. |

`npm run smoke` drives the **built** server over real stdio and fails if anything but protocol frames
reaches stdout.

`npm run eval:ollama` measures how a local model drives the **built** server
([`scripts/eval-ollama.mjs`](../scripts/eval-ollama.mjs)): eight fixed tasks — find a record, read two
of its values, list a plugin's armor, patch a record, patch and build, and author and build a new
enchanted sword, a new Destruction spell and a new NPC — through Ollama's `/api/chat`,
with the server's tools and four file tools confined to a temporary projects folder. It checks each
task against the instance itself, deploys nothing (`deployProject` is listed, but a call to it is
refused), and writes every call with its arguments and answer to a JSON file. Then it measures the
model's prompt and generation speed at the same context, apart from the tasks. `--model`, `--profile`,
`--runs`, `--tasks` and `--ctx` choose what to measure. Run it after changing what a tool says or
answers: the transcripts show where a model loses turns — they are how the relative paths
`addPatch` used to answer with were found. Every round is recorded in
[`research/local-model-evals.md`](./research/local-model-evals.md); the script prints its entry.

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
