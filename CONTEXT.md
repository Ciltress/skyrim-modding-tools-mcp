# mcp-template

<!-- TEMPLATE: one paragraph on what your server lets an agent do, and for whom. Keep the glossary
     below — it is the vocabulary the code, the docs and the tests use — and add your domain's terms. -->

An MCP server that gives an AI agent access to a **backend**, shaped so the agent succeeds on the
first try from a cold session — with whatever client it happens to run in.

## Language

### What the server offers

**Tool**:
One operation this server exposes to an MCP client, with a name, a description, an argument schema
and annotations.
_Avoid_: command, function, endpoint, API

**Tool family**:
The tools one handler class offers, documented together in the tool reference.
_Avoid_: module, group, category

**Guide**:
One of this server's own documents, written for an agent that is *using* the server. Served both as an
MCP resource and through a tool, because the two reach different consumers.
_Avoid_: doc, manual, readme, reference

**Skill**:
A packaged set of instructions for an agent, served by this server. A skill tells an agent *how to
approach a kind of work*; a guide tells it *what this server can do*.
_Avoid_: prompt, playbook, template, instruction set

**Router**:
The hand-written map from the words a person uses to the tool that does the job. An intent
vocabulary, deliberately not generated, because the generated form can only restate the tools' own
names back at the reader.
_Avoid_: index, glossary, table of contents, catalogue

### What the server wraps

**Backend**:
Whatever the server's tools act on, reached through one `AppBackend` instance per server instance —
per process in stdio mode, per session in HTTP mode.
_Avoid_: API, service, upstream, provider

**Binding**:
The fixed pairing of one running server instance to exactly one backend, decided at startup and not
changeable while it runs. Announced in the `instructions`.
_Avoid_: connection, target, environment

**Feature**:
An optional capability a backend may or may not offer, which a tool can declare it needs.
_Avoid_: plugin, module, extension, flag

**Gating**:
The server withholding tools because the connected backend does not offer a feature they need, as
the backend itself reports. Distinct from a profile: a profile is what the operator chose to offer,
gating is what the backend can actually do.
_Avoid_: filtering, feature flag, capability check

### How the server adapts to its client

**Profile**:
A named subset of the tools a server lists, chosen by the operator at startup to fit a client tier. A
tool outside the active profile is not merely hidden — it is not callable.
_Avoid_: preset, mode, config, toolset

**Response budget**:
The ceiling on the size of one tool answer, following the profile. An answer over it is replaced by a
valid, self-describing one that names the next step.
_Avoid_: limit, truncation, max size

### How the server is judged

**Client tier**:
A class of consuming model, distinguished by how much tool description it can afford to carry and how
well it recovers from a wrong turn: an agent harness that fetches schemas on demand, a small local
model that receives every schema on every turn, and a cloud model in between.
_Avoid_: model, consumer, user agent

**Cold session**:
A fresh conversation carrying no prior knowledge of this server beyond what the server itself
supplies. The only condition under which reliability is judged, because it is the condition every
real task starts in.
_Avoid_: new chat, fresh context, first run

**First-try success**:
A task completed from a cold session without the model retrying, choosing a wrong tool, or asking for
information the server could have supplied. The measure of quality here — not tool count, not token
cost, both of which only matter through their effect on this.
_Avoid_: accuracy, success rate, reliability
