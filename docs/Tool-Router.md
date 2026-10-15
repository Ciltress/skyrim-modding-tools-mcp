# Tool router

**What you want to do → the tool that does it.** Written by hand, in the words people actually use,
because a generated index can only ever say a tool's own name back to you. If you know the job but not
the tool, start here.

Not all of these are callable on every server: `MCP_PROFILE` decides what is listed, and anything the
connected backend does not support is withheld. **`tools/list` is the truth.** A tool named here but
missing there is not a mistake — it is out of profile, or not supported by this backend.

Arguments live in each tool's own `inputSchema`. Full list: [`Tool-Reference.md`](./Tool-Reference.md).
Workflows and the error model: [`MCP-Tools.md`](./MCP-Tools.md). The vocabulary: [`CONTEXT.md`](../CONTEXT.md).

---

## Looking things up in the load order

| You want to… | Call |
| --- | --- |
| Find a weapon, spell, NPC… by name or editor ID | `findRecords` with `text`, and `types` like `["WEAP"]` to narrow it. **Start here.** |
| Know what a FormID in project text is (`01E718:Skyrim.esm`) | `findRecords` with `records` — FormIDs in, names out |
| Find the FormID for an editor ID before writing it | `findRecords` with `records: ["WeapMaterialIron"]` |
| Read a record — its fields, as a project would hold it | `readRecord` with the FormID or editor ID |
| See which mods change a record, and how | `readRecord` with `allVersions: true` — every plugin's version, winning first |
| Read one mod's version of a record | `readRecord` with `plugin` |
| List what a plugin defines or overrides | `findRecords` with `plugin`, and `types` to narrow it |
| Learn how a kind of record is written | `readRecord` on a vanilla one of that type, then mirror it |

## Changing other mods — patches

| You want to… | Call |
| --- | --- |
| Change a record of another mod or the base game | `addPatch` with the records — then edit the copied files it answers with |
| Combine two mods' changes to one record | `readRecord` with `allVersions`, then `addPatch`, and merge both into the copy |
| Add items to a leveled list | `addPatch` with the list, then add entries to the copy — keep every entry it has |
| Copy a particular mod's version, not the winning one | `addPatch` with `from` |

## Making a mod

| You want to… | Call |
| --- | --- |
| Start a new mod | `newProject` — then write record files into its `plugin/` folder |
| Add a record (a new sword, spell, NPC…) | Write a YAML file into the project, without `FormKey`; mirror a vanilla record |
| Turn the text into a plugin | `buildProject` — it also checks every link, and turns links written as editor IDs into FormIDs |
| Put the mod into the game | `deployProject` — enables it in the mod manager; with Amethyst, also deploys or says to |
| Bring back what you did in the Creation Kit or xEdit | `pullProject` — commit first, review with `git diff` after |

## Mods on Nexus Mods

| You want to… | Call |
| --- | --- |
| Find a mod on Nexus by name | `searchNexus` with `text` — words of the name, in any order. The Nexus tools are listed only with `NEXUS_API_KEY` set |
| See what is popular, or new | `searchNexus` without `text`, `sort: "downloads"` or `"updated"` |
| Check what a mod needs before installing it — SKSE, Address Library, other mods | `readNexusMod` with its `modId` → `requirements`, `dlcRequirements` |
| Choose which file of a mod to get | `readNexusMod` → `files`: the main file, optional files, updates, with versions |
| Download a mod's file | `downloadNexusFile` with `modId` and `fileId` — needs a premium account's `NEXUS_API_KEY`; without one, the user downloads it on the page |
| Know whether the Nexus key is premium | `healthcheck` → `health.nexus` |
| Install a downloaded mod | `installMod` with `file` — its name in the downloads folder; enables it and activates its plugins |
| Answer a mod's installer (FOMOD), choose its options | `installMod` without `choices` answers the steps and option ids; then again with `choices` |
| Install a mod again — a newer file, other options | `installMod` with `replace: true` |

## When something went wrong

| You want to… | Call |
| --- | --- |
| Find out whether the server, the instance and the helper are up | `healthcheck` — it answers even when nothing else does |
| See which profile and game version are in use | `healthcheck` → `health` |
| Understand an error message or a failing workflow | `readServerGuide` with `{"guide":"tools","section":"troubleshooting"}` |
| Understand why a record's change has no effect in game | `readRecord` with `allVersions` — a later plugin may win |

## Guidance

| You want to… | Call |
| --- | --- |
| Learn how Skyrim modding works — plugins, FormIDs, load order, conflicts | `readSkill` with `{"skill":"skyrim-modding-basics"}` |
| Learn a kind of record: items, magic, NPCs, leveled lists | `readSkill` with its skill, e.g. `{"skill":"magic","file":"REFERENCE.md"}` |
| Know which outside tool fits a job (xEdit, LOOT, NifSkope…) | `readSkill` with `{"skill":"skyrim-modding-basics","file":"TOOLS.md"}` |
| Find the right tool for a job | `readServerGuide` with `{"guide":"router"}` — this page |
| See every tool's arguments | `readServerGuide` with `{"guide":"tool-reference"}`, one family by `section` |
| Learn how to work on this server's own code | `readServerGuide` with `{"guide":"agents"}` |

## Words that lead people astray

| If you are thinking… | You probably want… |
| --- | --- |
| "edit the ESP", "change the mod's plugin" | `addPatch` and edit the copy — never the mod's own plugin |
| "form", "form ID" | a record, and its FormID written `012EB7:Skyrim.esm` |
| "install the mod" (one you made) | `deployProject` |
| "save", "export the plugin" | `buildProject`, then `deployProject` |
| "import from the Creation Kit" | `pullProject` |
| "profile" | The mod manager's profile — the server follows the selected one. The tool set is the *tool profile*, `MCP_PROFILE` |
| "is it connected?" | `healthcheck`, not a test call to a write tool |
| "Nexus ID", "the mod's link" | `modId`: the number in the page's address, `…/skyrimspecialedition/mods/12604` |
| "help", "docs", "manual" | `readServerGuide` and `readSkill` — the server documents itself |
