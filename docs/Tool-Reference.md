# Tool reference

<!-- GENERATED FILE - do not edit by hand.
     Run `npm run build && npm run docs:tools` after changing any getTools(). -->

Every tool this server can expose: **9 tools across 4 families**, rendered from the tool definitions themselves so it cannot drift from the code. `healthcheck` is not listed here: the server defines it outside every handler and lists it in every profile.

**How many you can actually call is smaller.** The active `MCP_PROFILE` decides what is
listed, and the server withholds anything the connected backend does not support.
`tools/list` is always the truth; `healthcheck` reports the profile and what was withheld.

Looking for the tool that does a particular job? Start with
[`Tool-Router.md`](./Tool-Router.md), which maps intent to tool. For workflows and the error
model, see [`MCP-Tools.md`](./MCP-Tools.md).

An argument marked **\*** is required. Argument *descriptions* are not repeated here: they
reach you in the `inputSchema` of every tool you can call.

The italic line under each tool is its MCP **annotations**, sent to clients in `tools/list`:
whether it only reads, whether it *writes*, whether the write is *destructive* (it overwrites
or removes something that was there) or *idempotent* (repeating it changes nothing further),
and whether it reaches past the backend this server is bound to. They are hints for deciding
what needs a human, not a permission system: nothing here is enforced.

## Families

- [Bundled skills](#bundled-skills) — 1 tool
- [Projects: authoring and patching](#projects-authoring-and-patching) — 5 tools
- [Records in the load order](#records-in-the-load-order) — 2 tools
- [This server's own guides](#this-servers-own-guides) — 1 tool

---

## Bundled skills

From `src/handlers/SkillsHandlers.ts`.

**`readSkill`** — Bundled agent skills — how Skyrim modding works and how to approach it here: the basics (plugins, FormIDs, load order, conflicts, the tool landscape) and one skill per record family (items and crafting, magic, NPCs, leveled lists). Call with no arguments to see which exist, then pass `collection` for their descriptions and `skill` to read one. Consult a skill's SKILL.md before starting a task it covers: they carry the conventions and checklists the tool descriptions alone do not.

_read-only_

`collection` string · `skill` string · `file` string

## Projects: authoring and patching

From `src/handlers/ProjectsHandlers.ts`.

**`newProject`** — Create an empty project for a new mod: a plugin folder holding RecordData.yaml. Add records by writing YAML files into it (one file per record, in the group's folder, e.g. Weapons/MySword.yaml — leave out FormKey, the build assigns one). To change records other mods already have, use addPatch instead. Returns the folder to write into.

_writes · idempotent_

`project`**\*** string · `plugin` string · `light` boolean

**`addPatch`** — Start or extend a patch: copy existing records into a project as overrides, so they can be changed without touching the plugins they come from. Each record is copied from its current winning version — so other mods' changes are kept — or from `from`. Creates the project when it does not exist. Then edit the copied files and run buildProject. A record already in the project is reported under `alreadyInProject` and left alone.

_writes · idempotent_

`project`**\*** string · `records`**\*** array · `from` string · `plugin` string

**`buildProject`** — Build a project's plugin from its text: gives new records their FormIDs (written back into their files), checks that every link (a FormID in a field) points at a record that exists, compiles the project's Papyrus scripts and writes the plugin with the header this game version needs. Fails with the list of broken links, if any. Does not touch the mod manager — deployProject does.

_writes · idempotent_

`project`**\*** string

**`deployProject`** — Put a built project into the mod manager (Mod Organizer or Amethyst): make its mod folder the build plus the project's assets, enable the mod, and activate the plugin — at the end of the load order when it is new, so it wins over what it patches. Then a running Mod Organizer re-reads its profile, or Amethyst deploys it into the game; when the user has to act, `modManager.nextStep` says what to do — tell them. Refuses when the project changed since its build, or when the deployed plugin was changed elsewhere (e.g. saved in the Creation Kit) — pull that first; a pulled copy that would hide the mod is then removed.

_writes · destructive · idempotent_

`project`**\*** string

**`pullProject`** — Bring changes made to a deployed plugin outside the project — placing objects in the Creation Kit, a fix in xEdit — back into the project's text. Refuses while the project folder has uncommitted changes, so what the pull changes can be reviewed with git diff and undone; where git cannot tell (no git, or no repository), it pulls and says so in `warning`. Returns the files added, changed and removed.

_writes · destructive · idempotent_

`project`**\*** string

## Records in the load order

From `src/handlers/RecordsHandlers.ts`.

**`findRecords`** — Find records in the active load order — by text in the editor ID or name, or by exact FormIDs and editor IDs. Each row says which plugin defines the record, which one wins, and how many override it. Use `records` to turn the FormIDs in project text into names (and back) before reasoning about them. Placed references, landscape and navmesh are not searched. `total` counts matches before the limit.

_read-only_

`text` string · `records` array · `types` array · `plugin` string · `limit` number, default `25`

**`readRecord`** — One record as project text (YAML): by default the version that wins in the load order; with `plugin`, that plugin's version; with `allVersions`, every plugin's version, winning first — compare them to see a conflict. Each version comes with the file path it would have in a project. Links inside are FormIDs: resolve them with findRecords.

_read-only_

`record`**\*** string · `plugin` string · `allVersions` boolean

## This server's own guides

From `src/handlers/DocsHandlers.ts`.

**`readServerGuide`** — This server's own documentation. Call with no arguments for an index of the available guides and their sections, then request one section by number or title. Use it when you are unsure which tool to use, what an argument means, how a workflow fits together, or why a call is failing.

_read-only_

`guide` string, one of router/tool-reference/tools/hosting/agents · `section` string
