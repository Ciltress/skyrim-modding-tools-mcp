# Tool reference

<!-- GENERATED FILE - do not edit by hand.
     Run `npm run build && npm run docs:tools` after changing any getTools(). -->

Every tool this server can expose: **28 tools across 7 families**, rendered from the tool definitions themselves so it cannot drift from the code. `healthcheck` is not listed here: the server defines it outside every handler and lists it in every profile.

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

- [Analysis](#analysis) — 3 tools
- [Bundled skills](#bundled-skills) — 1 tool
- [Installing mods](#installing-mods) — 8 tools
- [Nexus Mods](#nexus-mods) — 3 tools
- [Projects: authoring and patching](#projects-authoring-and-patching) — 10 tools
- [Records in the load order](#records-in-the-load-order) — 2 tools
- [This server's own guides](#this-servers-own-guides) — 1 tool

---

## Analysis

From `src/handlers/AnalysisHandlers.ts` of skyrim-modding-tools-core.

**`readCrashLog`** — Why the game crashed, from Crash Logger SSE's log: the newest of this setup's, or the one `log` names. Answers the crash, up to 5 `diagnoses` — known crashes, most certain first, each with its fix — and up to 5 `suspects`: the mods whose DLL, plugin, mesh or texture the log points at, with the lines that do; and for each record the log names, the plugin that defines it and the one that changed it last. Advice on the setup that holds whatever crashed — Engine Fixes not installed — comes apart, in `setup`. `section` answers one part of the log as written instead. Reads files; changes nothing.

_read-only_

`log` string · `section` string

**`readPapyrusLog`** — What the game's scripts did wrong, from its Papyrus log: script and install `problems`, grouped and counted, bugs first — a call on None, a script or framework missing, a script on the wrong record — each with its fix, its scripts by the mod whose .pex the game loads, its records by plugin; what the save still holds of mods removed mid-playthrough; script lag in `load`, from stack dumps; harmless messages counted in `noise`. Not a crash log: readCrashLog reads crashes. `script` lists one script's entries with their stacks. With logging off, it says the editIni call that turns it on. Reads files; changes nothing.

_read-only_

`log` string · `script` string

**`findConflicts`** — Mods in conflict, as the game sees them. `records`: each record whose winning version lost another plugin's changes, with those changes plugin by plugin — a field's value, an item a list gained or lost (`Keywords + WeapMaterialSilver`); a patch that names both plugins as masters settles a conflict, and is not listed. `files`: each pair of mods giving the game the same files, the one it takes and how — the mod order for loose files, the load order for archives, a loose file over any archive. Of one `plugin`, one `mod`, one `record`, or the whole setup. `nextStep` says how to settle them: addPatch with `merge` for records. Reads only; changes nothing.

_read-only_

`plugin` string · `mod` string · `record` string · `kind` string · `limit` number, default `25`

## Bundled skills

From `src/handlers/SkillsHandlers.ts` of skyrim-modding-tools-core.

**`readSkill`** — Bundled agent skills — how Skyrim modding works and how to approach it here: the basics (plugins, FormIDs, load order, conflicts, the tool landscape) and one skill per record family (weapons, armor, other items, enchantments, recipes; spells, magic effects, enchantments, shouts; NPCs; leveled lists: what NPCs carry, loot, merchant stock; quests, Papyrus scripts, dialogue: anything given or done when a game starts; cells and what is placed in them, indoors or out: a chest, an NPC; a cell in Blender; perks; game settings, globals, keywords). Call with no arguments to see which exist, then pass `collection` for their descriptions and `skill` to read one. Consult a skill's SKILL.md before starting a task it covers: they carry the conventions and checklists the tool descriptions alone do not.

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

**`enableMod`** — Enable a disabled mod in the mod manager's selected profile — only when the user said so, for this mod: it stays where it is in the mod order, and its plugins join the load order as installMod places them. Then the mod manager is told, as for installMod. `missingMasters` names its plugins that need one no active plugin is: the game will not start until those mods are enabled too.

_writes · idempotent_

`mod`**\*** string

**`movePlugin`** — Move a plugin in the load order of the selected profile — only when the user said so: just `after` another, so its version of a record they both change is the game's, or just `before` one, so that one's is. Refused where the game would not load it so: before one of its masters or after a plugin that needs it, across the line between master-flagged and plain plugins, or among the game's own. Then the mod manager is told, as for installMod. findConflicts says which plugin loses what; a patch (addPatch with `merge`) keeps both plugins' changes, where a move keeps one's.

_writes · idempotent_

`plugin`**\*** string · `after` string · `before` string

**`setModPriority`** — Move a mod in the mod order of the selected profile — only when the user said so: just `after` another, so its loose files win over that one's (below it in Mod Organizer's list), or just `before` one, so that one's win. The mod order decides loose files only: files in archives (BSAs) follow the load order of their plugins, and a loose file beats every archive. Then the mod manager is told, as for installMod. findConflicts says which mod's files lose to which.

_writes · idempotent_

`mod`**\*** string · `after` string · `before` string

**`editIni`** — Set or remove settings of the game's Skyrim.ini, SkyrimPrefs.ini or SkyrimCustom.ini — only when the user said so, for these settings: the copies the game reads for the selected profile (the profile's own, when the mod manager keeps them per profile; else those in My Games). Every other line stays as it was; the answer names each value as it was and is. The game reads them when it starts.

_writes · destructive · idempotent_

`set`**\*** array

## Nexus Mods

From `src/handlers/NexusHandlers.ts` of skyrim-modding-tools-core.

**`searchNexus`** — Search Nexus Mods for Skyrim Special Edition mods by words in their name, matched in any order — most endorsed first; without `text`, the catalogue in `sort` order. Each row has the mod's number (`modId`), version, author, summary and page. Read one with readNexusMod. `total` counts matches before the limit.

_read-only · reaches outside this backend_

`text` string · `sort` string, one of endorsements/downloads/updated · `limit` number, default `10`

**`readNexusMod`** — One Nexus Mods page for Skyrim Special Edition: its description as text, what it requires — SKSE, other mods, DLC — and the files it offers now (main, update, optional, miscellaneous), each with its fileId, version and size. Check the requirements before recommending or installing a mod: one that lacks them crashes the game or does nothing.

_read-only · reaches outside this backend_

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

`project`**\*** string · `records`**\*** array · `from` string · `merge` boolean · `plugin` string

**`editRecord`** — Change fields of one record file of a project by their paths — no old text to match. `set` lists each field's path and its value: [{"path": "BasicStats.Damage", "value": 12}, {"path": "Name", "value": "Flame Blade"}, {"path": "Effects[0].Data.Magnitude", "value": 40}] — a text field (Name, Description) takes its words, a link a FormID or an editor ID, a list a list, written whole; an object sets the fields it names inside that part and keeps its others, as {"path": "BasicStats", "value": {"Damage": 12}} does. `remove` takes paths to delete, any the file has: ["Critical", "Effects[1]"]. Changes only those lines, refuses a field the record's type does not have, and answers the file's new text. Then run buildProject — or send `"build": true`, and this call builds the project after the change and answers that build, as buildProject does.

_writes · destructive · idempotent_

`project`**\*** string · `record`**\*** string · `set` array · `remove` array · `build` boolean

**`moveRecord`** — Move one record file into a project's plugin folder: out of a folder the build does not read, to its .yaml name, or in from outside every project. The build's answers write this call out for each misplaced file. Then run buildProject.

_writes · idempotent_

`project`**\*** string · `from`**\*** string · `to`**\*** string

**`deleteRecord`** — Delete one record file of the projects folder: a copy left behind where the build does not read it, or a record the mod no longer needs. The build's answers write this call out for each copy left behind. Then run buildProject.

_writes · destructive · idempotent_

`project`**\*** string · `record`**\*** string · `build` boolean

**`buildProject`** — Build a project's plugin from its text: gives new records their FormIDs (written back into their files, which keep their names), builds a link written as an editor ID — a new record of the project, or one of the load order — as that record's FormID, the file keeping the editor ID (`resolvedLinks`), checks that every link points at a record that exists, compiles the project's Papyrus scripts and writes the plugin with the header this game version needs. Refuses a project with no records, fields a record type does not have, and files below a group's folder — each named. What has one right fix — a FormKey copied into a new record, escapes copied out of a JSON answer, a field written where its record has none but one place it goes — it writes into the file and lists in `corrected`. What builds but likely not as meant — record files outside the plugin folder, an override renamed as if it were a new record, a woman's voice on a man — is answered with status `built_with_warnings` and the `warnings` first: the plugin is written, and each warning says what to fix. `built` lists each record the written plugin holds, with its name and numbers. Does not touch the mod manager — deployProject does.

_writes · idempotent_

`project`**\*** string

**`deployProject`** — Put a built project into the mod manager (Mod Organizer or Amethyst): make its mod folder the build plus the project's assets, enable the mod, and activate the plugin — at the end of the load order when it is new, so it wins over what it patches. Then a running Mod Organizer re-reads its profile, or Amethyst deploys it into the game; when the user has to act, `modManager.nextStep` says what to do — tell them. Refuses when the project changed since its build, or when the deployed plugin was changed elsewhere (e.g. saved in the Creation Kit) — pull that first; a pulled copy that would hide the mod is then removed.

_writes · destructive · idempotent_

`project`**\*** string

**`pullProject`** — Bring changes made to a deployed plugin outside the project — placing objects in the Creation Kit, a fix in xEdit — back into the project's text. Refuses while the project folder has uncommitted changes, so what the pull changes can be reviewed with git diff and undone; where git cannot tell (no git, or no repository), it pulls and says so in `warning`. Returns the full paths of the files added, changed and removed.

_writes · destructive · idempotent_

`project`**\*** string

**`exportCell`** — Lay a cell out for Blender, to arrange it by eye: every object placed in it — the project's own build over the load order's — with the meshes and textures they show, copied out of the mods and archives, and the Python that places them in Blender through the PyNifly add-on, where the game places them. An interior (WhiterunBreezehome) or an exterior cell (Riverwood), with its ground. Creates the project when it does not exist. Answers the folder and the two scripts: importScript places the cell, exportScript writes what was moved, copied (Shift+D) or deleted — run each in Blender's Scripting tab, or send its text through Blender's MCP server — then importCell brings the changes into the project.

_writes · idempotent_

`project`**\*** string · `cell`**\*** string · `textures` boolean

**`importCell`** — Bring a cell arranged in Blender back into the project, from the layout its exportScript wrote: each object moved, turned or scaled is written as the project's copy of its reference with the new placement; each copy made in Blender as a new reference of the project, in the cell's Temporary folder; each one deleted disabled — another plugin's reference is never deleted, what names it would break — or, the project's own, its file deleted. Answers the full path of each file written; run buildProject next.

_writes · idempotent_

`project`**\*** string · `cell` string

## Records in the load order

From `src/handlers/RecordsHandlers.ts` of skyrim-modding-tools-core.

**`findRecords`** — Find records in the active load order — by text in the editor ID or name, or by exact FormIDs and editor IDs. Each row says which plugin defines the record, which one wins, and how many override it. Use `records` to turn the FormIDs in project text into names (and back) before reasoning about them. Placed references, landscape and navmesh are not searched: readRecord of a cell lists what is placed in it. `total` counts matches before the limit.

_read-only_

`text` string · `records` array · `types` array · `plugin` string · `limit` number, default `25`

**`readRecord`** — One record as project text (YAML): by default the version that wins in the load order; with `plugin`, that plugin's version; with `allVersions`, every plugin's version, winning first — compare them to see a conflict. Each file carries `pathInPluginFolder`, where it would sit in a project's plugin folder; to change a record, copy it in with addPatch rather than writing this text yourself. Links inside are FormIDs, each followed by the editor ID of the record it names as a comment (`Race: 013746:Skyrim.esm  # NordRace`); a project file may link by either. A cell comes with `placed`: what the load order places in it, and the file and lines a new reference placed there is written with.

_read-only_

`record`**\*** string · `plugin` string · `allVersions` boolean · `in` string

## This server's own guides

From `src/handlers/DocsHandlers.ts` of skyrim-modding-tools-core.

**`readServerGuide`** — This server's own documentation. Call with no arguments for an index of the available guides and their sections, then request one section by number or title. Use it when you are unsure which tool to use, what an argument means, how a workflow fits together, or why a call is failing.

_read-only_

`guide` string, one of router/tool-reference/tools/hosting/agents · `section` string
