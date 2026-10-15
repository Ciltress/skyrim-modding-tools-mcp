# skyrim-modding-tools-mcp

An MCP server that lets an AI agent author and analyse Skyrim Special Edition mods inside one Mod
Organizer 2 **instance**, shaped so the agent succeeds on the first try from a cold session — with
whatever client it happens to run in.

## Language

### Skyrim modding

**Instance**:
One Mod Organizer 2 installation — its game folder, its mods, its downloads and its profiles.
_Avoid_: setup, install, modlist

**Profile**:
One of an instance's named setups — which mods are enabled, the mod order, the load order, and
optionally its own game settings and saves. The server follows whichever one Mod Organizer has
selected.
_Avoid_: preset, configuration, modlist, tool profile

**Mod**:
One folder in an instance, installed from one download or made by hand, holding loose files, archives
and zero or more plugins.
_Avoid_: package, addon, plugin

**Mod order**:
The priority of an instance's mods. When two mods ship the same file, the game sees the higher mod's.
_Avoid_: install order, load order

**Plugin**:
An `.esm`, `.esp` or `.esl` file the game loads, holding records.
_Avoid_: mod, data file, "ESP" as a generic name

**Light plugin**:
A plugin flagged ESL. It takes no slot in the game's 254-plugin limit, at the cost of holding at most
4,096 new records (2,048 before game version 1.6.1130).
_Avoid_: ESL file, small plugin

**Load order**:
The sequence in which the game loads the active plugins. For a record several plugins define, the
last one loaded wins.
_Avoid_: plugin order, mod order

**Master**:
A plugin another plugin depends on and must load after; a record can only override records of its
plugin's masters.
_Avoid_: dependency, requirement, parent

**Record**:
One entry in a plugin — an NPC, a spell, a cell, a placed object — of a record type named by a
four-letter signature such as `NPC_` or `SPEL`.
_Avoid_: form, object, entry

**Reference**:
A record that places a base record in a cell — one particular chest, one particular Lydia. Changing
the base record changes every reference to it; changing a reference changes only that one.
_Avoid_: instance (which means Mod Organizer's), placed object, ref

**FormID**:
The identity of a record: the plugin that first defined it plus a number local to that plugin. The
hex value seen in game prefixes the plugin's load-order slot, so it moves when the load order does;
the identity does not.
_Avoid_: ID, ref ID, editor ID (a separate, human-readable name)

**Override**:
A plugin's version of a record that one of its masters defined.
_Avoid_: edit, change, copy

**Conflict**:
Two mods or plugins supplying different versions of the same file or record. The later one in the
mod order or load order wins, and the other's changes are lost.
_Avoid_: clash, incompatibility

**Nexus mod**:
One mod page on Nexus Mods. It offers several Nexus files — a main file, optional files, patches.
_Avoid_: mod (which always means the folder in an instance)

**Nexus file**:
One download offered on a Nexus mod. Installed, it becomes one mod.
_Avoid_: archive, download, upload

### Authoring

**Project**:
A mod we author, kept as text in git — one file per record, plus its scripts and assets — and
built into a plugin. The project, not the plugin, is the source of truth.
_Avoid_: source, workspace, repo

**Patch**:
A project whose overrides change records of other mods — loading after them, so the change wins
without touching their plugins. It starts from each record's current winning version.
_Avoid_: fix, compatibility plugin, merge

**Build**:
Turning a project into a plugin, compiled scripts and collected assets, inside the project.
_Avoid_: compile, export, pack

**Deploy**:
Copying a project's build into its mod in the instance, enabling it and placing it in the load order.
_Avoid_: install, publish, sync

**Pull**:
Bringing changes made to a deployed plugin outside the project — in the Creation Kit, in xEdit — back
into the project's text. The reverse of deploy.
_Avoid_: import, sync, update

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
Whatever the server's tools act on — here, one instance and the Nexus Mods catalogue — reached through
one `AppBackend` per running server: per process in stdio mode, per session in HTTP mode.
_Avoid_: API, service, upstream, provider

**Binding**:
The fixed pairing of one running server to exactly one instance, decided at startup and not
changeable while it runs. The active profile is not part of it: the server follows whichever one Mod
Organizer has selected. Announced in the `instructions`.
_Avoid_: connection, target, environment

**Feature**:
An optional capability a backend may or may not offer, which a tool can declare it needs.
_Avoid_: plugin, module, extension, flag

**Gating**:
The server withholding tools because the connected backend does not offer a feature they need, as
the backend itself reports. Distinct from a tool profile: a tool profile is what the operator chose
to offer, gating is what the backend can actually do.
_Avoid_: filtering, feature flag, capability check

### How the server adapts to its client

**Tool profile**:
A named subset of the tools a server lists, chosen by the operator at startup (`MCP_PROFILE`) to fit
a client tier. A tool outside the active tool profile is not merely hidden — it is not callable.
_Avoid_: profile (which means Mod Organizer's), preset, mode, config, toolset

**Response budget**:
The ceiling on the size of one tool answer, following the tool profile. An answer over it is replaced by a
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
