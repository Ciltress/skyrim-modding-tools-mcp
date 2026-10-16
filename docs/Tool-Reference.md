# Tool reference

<!-- GENERATED FILE - do not edit by hand.
     Run `npm run build && npm run docs:tools` after changing any getTools(). -->

Every tool this server can expose: **13 tools across 6 families**, rendered from the tool definitions themselves so it cannot drift from the code. `healthcheck` is not listed here: the server defines it outside every handler and lists it in every profile.

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
- [Installing mods](#installing-mods) — 1 tool
- [Nexus Mods](#nexus-mods) — 3 tools
- [Projects: authoring and patching](#projects-authoring-and-patching) — 5 tools
- [Records in the load order](#records-in-the-load-order) — 2 tools
- [This server's own guides](#this-servers-own-guides) — 1 tool

---

## Bundled skills

From `src/handlers/SkillsHandlers.ts`.

**`readSkill`** — Bundled agent skills — how Skyrim modding works and how to approach it here: the basics (plugins, FormIDs, load order, conflicts, the tool landscape) and one skill per record family (items and crafting, magic, NPCs, leveled lists). Call with no arguments to see which exist, then pass `collection` for their descriptions and `skill` to read one. Consult a skill's SKILL.md before starting a task it covers: they carry the conventions and checklists the tool descriptions alone do not.

_read-only_

`collection` string · `skill` string · `file` string

## Installing mods

From `src/handlers/ModsHandlers.ts`.

**`installMod`** — Install a downloaded file (.7z, .zip, .rar) as a mod: unpack it into a new mod, enable the mod and activate its plugins at the end of the load order; then the mod manager is told, as for deployProject — when the user has to act, `modManager.nextStep` says what. A file with a FOMOD installer takes two calls: the first installs nothing and answers its steps, every option with an id like 1.1.2; the second, with `choices`, installs. A mod name already taken is refused unless `replace` is true. `missingMasters` names plugins the game cannot load until the mods they need are installed too.

_writes · destructive · idempotent_

`file`**\*** string · `choices` array · `name` string · `root` string · `replace` boolean

## Nexus Mods

From `src/handlers/NexusHandlers.ts`.

**`searchNexus`** — Search Nexus Mods for Skyrim Special Edition mods by words in their name, matched in any order — most endorsed first; without `text`, the catalogue in `sort` order. Each row has the mod's number (`modId`), version, author, summary and page. Read one with readNexusMod. `total` counts matches before the limit.

_read-only · reaches outside this backend_

Needs the backend feature `nexus-api-key`; withheld where it is missing.

`text` string · `sort` string, one of endorsements/downloads/updated · `limit` number, default `10`

**`readNexusMod`** — One Nexus Mods page for Skyrim Special Edition: its description as text, what it requires — SKSE, other mods, DLC — and the files it offers now (main, update, optional, miscellaneous), each with its fileId, version and size. Check the requirements before recommending or installing a mod: one that lacks them crashes the game or does nothing.

_read-only · reaches outside this backend_

Needs the backend feature `nexus-api-key`; withheld where it is missing.

`modId`**\*** number

**`downloadNexusFile`** — Download one file of a Nexus mod into the instance's downloads folder, through Nexus's API — listed only when NEXUS_API_KEY belongs to a premium account. Take modId and fileId from readNexusMod's files: usually the main file, plus the optional files the user wants. Recorded beside it the way Mod Organizer records its own downloads; a file already there with the right size is not downloaded again. Answers its full path.

_writes · idempotent · reaches outside this backend_

Needs the backend feature `nexus-premium`; withheld where it is missing.

`modId`**\*** number · `fileId`**\*** number

## Projects: authoring and patching

From `src/handlers/ProjectsHandlers.ts`.

**`newProject`** — Create an empty project for a new mod. Add records by writing YAML files into its plugin folder — one file per record, in its type's group folder there; the answer's `writeRecordsTo` gives the full path, so never write into the project folder itself, and its `readFirst` the skill to read for each family of records. Write each record the way readRecord shows a vanilla one of its type, and leave out FormKey: the build assigns one. To change records other mods already have, use addPatch instead.

_writes · idempotent_

`project`**\*** string · `plugin` string · `light` boolean

**`addPatch`** — Start or extend a patch — no newProject first: this creates the project when it does not exist. Copies existing records into the project as overrides, to change them without touching the plugins they come from: each from its current winning version — so other mods' changes are kept — or from `from`. Answers each copied file's full path and text (`added[].files`): edit it with your file tools, then run buildProject. Past about ten records the text is left out (`textLeftOut`) — read those files first. A record already in the project is reported under `alreadyInProject` and left alone. An override changes the record itself, everywhere: for a new record like a vanilla one, write a new file with newProject instead.

_writes · idempotent_

`project`**\*** string · `records`**\*** array · `from` string · `plugin` string

**`buildProject`** — Build a project's plugin from its text: gives new records their FormIDs (written back into their files, renamed once the build succeeds), turns a link written as an editor ID — a new record of the project, or one of the load order — into that record's FormID (`resolvedLinks`), checks that every link points at a record that exists, compiles the project's Papyrus scripts and writes the plugin with the header this game version needs. Refuses a project with no records, fields a record type does not have, files below a group's folder, and a FormKey copied from another record — each named. Record files outside the plugin folder are not built, and named in `warnings`. Does not touch the mod manager — deployProject does.

_writes · idempotent_

`project`**\*** string

**`deployProject`** — Put a built project into the mod manager (Mod Organizer or Amethyst): make its mod folder the build plus the project's assets, enable the mod, and activate the plugin — at the end of the load order when it is new, so it wins over what it patches. Then a running Mod Organizer re-reads its profile, or Amethyst deploys it into the game; when the user has to act, `modManager.nextStep` says what to do — tell them. Refuses when the project changed since its build, or when the deployed plugin was changed elsewhere (e.g. saved in the Creation Kit) — pull that first; a pulled copy that would hide the mod is then removed.

_writes · destructive · idempotent_

`project`**\*** string

**`pullProject`** — Bring changes made to a deployed plugin outside the project — placing objects in the Creation Kit, a fix in xEdit — back into the project's text. Refuses while the project folder has uncommitted changes, so what the pull changes can be reviewed with git diff and undone; where git cannot tell (no git, or no repository), it pulls and says so in `warning`. Returns the full paths of the files added, changed and removed.

_writes · destructive · idempotent_

`project`**\*** string

## Records in the load order

From `src/handlers/RecordsHandlers.ts`.

**`findRecords`** — Find records in the active load order — by text in the editor ID or name, or by exact FormIDs and editor IDs. Each row says which plugin defines the record, which one wins, and how many override it. Use `records` to turn the FormIDs in project text into names (and back) before reasoning about them. Placed references, landscape and navmesh are not searched. `total` counts matches before the limit.

_read-only_

`text` string · `records` array · `types` array · `plugin` string · `limit` number, default `25`

**`readRecord`** — One record as project text (YAML): by default the version that wins in the load order; with `plugin`, that plugin's version; with `allVersions`, every plugin's version, winning first — compare them to see a conflict. Each file carries `pathInPluginFolder`, where it would sit in a project's plugin folder; to change a record, copy it in with addPatch rather than writing this text yourself. Links inside are FormIDs, each followed by the editor ID of the record it names as a comment (`Race: 013746:Skyrim.esm  # NordRace`); a project file may link by either.

_read-only_

`record`**\*** string · `plugin` string · `allVersions` boolean

## This server's own guides

From `src/handlers/DocsHandlers.ts`.

**`readServerGuide`** — This server's own documentation. Call with no arguments for an index of the available guides and their sections, then request one section by number or title. Use it when you are unsure which tool to use, what an argument means, how a workflow fits together, or why a call is failing.

_read-only_

`guide` string, one of router/tool-reference/tools/hosting/agents · `section` string
