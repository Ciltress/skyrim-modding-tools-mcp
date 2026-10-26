# Tool reference

<!-- GENERATED FILE - do not edit by hand.
     Run `npm run build && npm run docs:tools` after changing any getTools(). -->

Every tool this server can expose: **19 tools across 6 families**, rendered from the tool definitions themselves so it cannot drift from the code. `healthcheck` is not listed here: the server defines it outside every handler and lists it in every profile.

**How many you can actually call is smaller.** The active `MCP_PROFILE` decides what is
listed, and the server withholds anything the connected backend does not support.
`tools/list` is always the truth; `healthcheck` reports the profile and what was withheld.

Looking for the tool that does a particular job? Start with the guide `router`
(`readServerGuide {"guide":"router"}`), which maps intent to tool. For workflows and the error
model, see the guide `tools`.

An argument marked **\*** is required. Argument *descriptions* are not repeated here: they
reach you in the `inputSchema` of every tool you can call.

The italic line under each tool is its MCP **annotations**, sent to clients in `tools/list`:
whether it only reads, whether it *writes*, whether the write is *destructive* (it overwrites
or removes something that was there) or *idempotent* (repeating it changes nothing further),
and whether it reaches past the backend this server is bound to. They are hints for deciding
what needs a human, not a permission system: nothing here is enforced.

## Families

- [Bundled skills](#bundled-skills) — 1 tool
- [Installing mods](#installing-mods) — 4 tools
- [Nexus Mods](#nexus-mods) — 3 tools
- [Projects: authoring and patching](#projects-authoring-and-patching) — 8 tools
- [Records in the load order](#records-in-the-load-order) — 2 tools
- [This server's own guides](#this-servers-own-guides) — 1 tool

---

## Bundled skills

From `src/handlers/SkillsHandlers.ts` of skyrim-modding-tools-core.

**`readSkill`** — Bundled agent skills — how Skyrim modding works and how to approach it here: the basics (plugins, FormIDs, load order, conflicts, the tool landscape) and one skill per record family (items and crafting, magic, NPCs, leveled lists). Call with no arguments to see which exist, then pass `collection` for their descriptions and `skill` to read one. Consult a skill's SKILL.md before starting a task it covers: they carry the conventions and checklists the tool descriptions alone do not.

_read-only_

`collection` string · `skill` string · `file` string

## Installing mods

From `src/handlers/ModsHandlers.ts` of skyrim-modding-tools-core.

**`listMods`** — The mods installed in the mod manager's selected profile, lowest priority first as Mod Organizer shows them, one short row each: enabled or not, its priority and separator, its Nexus Mods modId (for readNexusMod), and `skse` when it carries SKSE plugins. With `details`, also its plugins — whether the game loads that copy — and the file and version installed. `total` counts every mod matched; past 150, `next` says how to get the rest. Read from the files, at once.

_read-only_

`text` string · `enabledOnly` boolean · `details` boolean · `limit` number, default `150` · `offset` number

**`checkGameVersion`** — Whether the mods fit the installed game version: SKSE in the game folder, Address Library's file for this runtime, and every SKSE plugin the game loads — the copy that wins, from enabled mods, overwrite and the game folder — judged by SKSE's own log of the last game start where it is this game's, and by the rules SKSE and Address Library apply. `problems` groups the plugins that do not fit, each with its mod and Nexus modId: refusedAtLastStart (SKSE did not load it), willNotLoad (it will not), mayNotWork (an Address Library plugin from before 1.7.99's change: it loads, and often still works — try the game). Plugins that fit are only counted. Reads files; changes nothing.

_read-only_

_no arguments_

**`installMod`** — Install a downloaded file (.7z, .zip, .rar) as a mod: unpack it into a new mod, enable the mod and activate its plugins at the end of the load order — or right before an active plugin that needs one as a master (`placedBefore`); then the mod manager is told, as for deployProject — when the user has to act, `modManager.nextStep` says what. A file with a FOMOD installer takes two calls: the first installs nothing and answers its steps, every option with an id like 1.1.2; the second, with `choices`, installs. A mod name already taken is refused unless `replace` is true. `missingMasters` names plugins the game cannot load until the mods they need are installed too.

_writes · destructive · idempotent_

`file`**\*** string · `choices` array · `name` string · `root` string · `replace` boolean

**`disableMod`** — Disable a mod in the mod manager's selected profile — only when the user said so, for this mod: it stays where it is in the mod order, its files stay, and its plugins leave the load order as the mod manager does with a disabled mod's — except one another enabled mod also has (`keptActive`). Then the mod manager is told, as for installMod. `missingMasters` names active plugins that need one taken out: the game will not start until their mods are disabled too, or this one enabled again.

_writes · destructive · idempotent_

`mod`**\*** string

## Nexus Mods

From `src/handlers/NexusHandlers.ts` of skyrim-modding-tools-core.

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

From `src/handlers/ProjectsHandlers.ts` of skyrim-modding-tools-core.

**`newProject`** — Create an empty project for a new mod. Add records by writing YAML files into its plugin folder — one file per record, in its type's group folder there; the answer's `writeRecordsTo` gives the full path, so never write into the project folder itself, and its `readFirst` the skill to read for each family of records. Write each record the way readRecord shows a vanilla one of its type, and leave out FormKey: the build assigns one. To change records other mods already have, use addPatch instead.

_writes · idempotent_

`project`**\*** string · `plugin` string · `light` boolean

**`addPatch`** — Start or extend a patch — no newProject first: this creates the project when it does not exist. Copies existing records into the project as overrides, to change them without touching the plugins they come from: each from its current winning version — so other mods' changes are kept — or from `from`. Answers each copied file's full path and text (`added[].files`): change its fields with editRecord, which needs no old text to match, or with your file tools, then run buildProject. Past about ten records the text is left out (`textLeftOut`) — read those files first. A record already in the project is reported under `alreadyInProject` and left alone. An override changes the record itself, everywhere: for a new record like a vanilla one, write a new file with newProject instead.

_writes · idempotent_

`project`**\*** string · `records`**\*** array · `from` string · `plugin` string

**`editRecord`** — Change fields of one record file of a project by their paths — no old text to match. `set` lists each field's path and its value: [{"path": "BasicStats.Damage", "value": 12}, {"path": "Name", "value": "Flame Blade"}, {"path": "Effects[0].Data.Magnitude", "value": 40}] — a text field (Name, Description) takes its words, a link a FormID or an editor ID, a list a list, written whole; an object sets the fields it names inside that part and keeps its others, as {"path": "BasicStats", "value": {"Damage": 12}} does. `remove` takes paths to delete, any the file has: ["Critical", "Effects[1]"]. Changes only those lines, refuses a field the record's type does not have, and answers the file's new text. Then run buildProject.

_writes · destructive · idempotent_

`project`**\*** string · `record`**\*** string · `set` array · `remove` array

**`moveRecord`** — Move one record file into a project's plugin folder: out of a folder the build does not read, to its .yaml name, or in from outside every project. The build's answers write this call out for each misplaced file. Then run buildProject.

_writes · idempotent_

`project`**\*** string · `from`**\*** string · `to`**\*** string

**`deleteRecord`** — Delete one record file of the projects folder: a copy left behind where the build does not read it, or a record the mod no longer needs. The build's answers write this call out for each copy left behind. Then run buildProject.

_writes · destructive · idempotent_

`project`**\*** string · `record`**\*** string

**`buildProject`** — Build a project's plugin from its text: gives new records their FormIDs (written back into their files, which keep their names), builds a link written as an editor ID — a new record of the project, or one of the load order — as that record's FormID, the file keeping the editor ID (`resolvedLinks`), checks that every link points at a record that exists, compiles the project's Papyrus scripts and writes the plugin with the header this game version needs. Refuses a project with no records, fields a record type does not have, and files below a group's folder — each named. What has one right fix — a FormKey copied into a new record, escapes copied out of a JSON answer, a field written where its record has none but one place it goes — it writes into the file and lists in `corrected`. What builds but likely not as meant — record files outside the plugin folder, an override renamed as if it were a new record, a woman's voice on a man — is answered with status `built_with_warnings` and the `warnings` first: the plugin is written, and each warning says what to fix. Does not touch the mod manager — deployProject does.

_writes · idempotent_

`project`**\*** string

**`deployProject`** — Put a built project into the mod manager (Mod Organizer or Amethyst): make its mod folder the build plus the project's assets, enable the mod, and activate the plugin — at the end of the load order when it is new, so it wins over what it patches. Then a running Mod Organizer re-reads its profile, or Amethyst deploys it into the game; when the user has to act, `modManager.nextStep` says what to do — tell them. Refuses when the project changed since its build, or when the deployed plugin was changed elsewhere (e.g. saved in the Creation Kit) — pull that first; a pulled copy that would hide the mod is then removed.

_writes · destructive · idempotent_

`project`**\*** string

**`pullProject`** — Bring changes made to a deployed plugin outside the project — placing objects in the Creation Kit, a fix in xEdit — back into the project's text. Refuses while the project folder has uncommitted changes, so what the pull changes can be reviewed with git diff and undone; where git cannot tell (no git, or no repository), it pulls and says so in `warning`. Returns the full paths of the files added, changed and removed.

_writes · destructive · idempotent_

`project`**\*** string

## Records in the load order

From `src/handlers/RecordsHandlers.ts` of skyrim-modding-tools-core.

**`findRecords`** — Find records in the active load order — by text in the editor ID or name, or by exact FormIDs and editor IDs. Each row says which plugin defines the record, which one wins, and how many override it. Use `records` to turn the FormIDs in project text into names (and back) before reasoning about them. Placed references, landscape and navmesh are not searched. `total` counts matches before the limit.

_read-only_

`text` string · `records` array · `types` array · `plugin` string · `limit` number, default `25`

**`readRecord`** — One record as project text (YAML): by default the version that wins in the load order; with `plugin`, that plugin's version; with `allVersions`, every plugin's version, winning first — compare them to see a conflict. Each file carries `pathInPluginFolder`, where it would sit in a project's plugin folder; to change a record, copy it in with addPatch rather than writing this text yourself. Links inside are FormIDs, each followed by the editor ID of the record it names as a comment (`Race: 013746:Skyrim.esm  # NordRace`); a project file may link by either.

_read-only_

`record`**\*** string · `plugin` string · `allVersions` boolean

## This server's own guides

From `src/handlers/DocsHandlers.ts` of skyrim-modding-tools-core.

**`readServerGuide`** — This server's own documentation. Call with no arguments for an index of the available guides and their sections, then request one section by number or title. Use it when you are unsure which tool to use, what an argument means, how a workflow fits together, or why a call is failing.

_read-only_

`guide` string, one of router/tool-reference/tools/hosting/agents · `section` string
