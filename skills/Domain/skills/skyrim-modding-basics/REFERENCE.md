# Skyrim modding basics — reference

Skyrim Special Edition and Anniversary Edition, game versions 1.5.97 to 1.7.x. Legendary Edition
(2011, 32-bit) and Skyrim VR differ in places and are out of scope.

## What the game reads

Everything comes from one `Data` folder — under Mod Organizer, a virtual one (see
[Mod order](#mod-order-files-and-archives)).

| Kind | Where | Notes |
| --- | --- | --- |
| Plugins | `Data\*.esm` `*.esp` `*.esl` | Records. Active only when listed in the load order. |
| Archives | `Data\*.bsa` | Packed loose files. SE uses BSA version 105 (LZ4). |
| Meshes | `meshes\…\*.nif` | Models. |
| Textures | `textures\…\*.dds` | |
| Scripts | `scripts\*.pex` compiled, `source\scripts\*.psc` source | SE keeps sources in `Data\Source\Scripts`. |
| Sounds and voice | `sound\…` — `.wav`, `.xwm`, `.fuz` (voice + lip-sync) | |
| Strings | `strings\<plugin>_<language>.strings` (+ `.dlstrings`, `.ilstrings`) | Only for localized plugins. |
| SKSE plugins | `SKSE\Plugins\*.dll` | Native code, bound to one game version. |

## Plugins

A plugin is a header record (`TES4`) followed by groups of records.

- **Master flag** (`0x1`): the plugin loads among the masters, before every non-master. `.esm` files
  carry it.
- **Light flag** (`0x200`, "ESL"): the plugin loads into the shared `FE` slot. An `.esl` file is light
  and master at once; an ESL-flagged `.esp` is light but not a master. Light plugins take no slot in
  the 254-plugin limit and hold at most 4,096 new records.
- **Localized flag** (`0x80`): names and texts live in `strings` files instead of the plugin.
- **Masters list**: every plugin this one references, in a fixed order. A missing master crashes the
  game at startup.
- **Header version**: `1.70`, or `1.71` from game version 1.6.1130 on. `1.71` widened the range of new
  record numbers (below). A `1.71` plugin on an older game will likely crash it — write the header
  the target game expects. Form version is 44 for SE (43 for Legendary Edition).

### Slots and limits

- `00`–`FD`: 254 full plugins (masters and regular).
- `FE`: all light plugins share it, up to 4,096 of them.
- `FF`: records the game creates at runtime, stored in the save.

## Records and FormIDs

A record has a four-letter **signature** (`NPC_`, `WEAP`, `SPEL`…), a **FormID**, usually an
**editor ID** (a unique, human-readable name like `IronSword`) and its fields.

- **Identity** is *which plugin first defined the record* plus a local number: `012EB7:Skyrim.esm`.
  Mutagen and Spriggit call this a **FormKey**; projects on this server write every reference this way.
- **Runtime FormID**, as the console shows it, prefixes the defining plugin's load-order slot:
  `00012EB7` (slot `00` = Skyrim.esm). A full plugin's record is `SSxxxxxx`; a light plugin's is
  `FEAAAxxx`, with `AAA` the light slot and `xxx` the local number.
- **New record numbers**: a light plugin may use `0x800`–`0xFFF` (2,048 records) under header `1.70`,
  and `0x000`–`0xFFF` (4,096) under `1.71`. Once assigned, a FormID never changes — references to it
  live in other plugins and in saves.
- **Editor IDs** are for humans and tools, not identity. Papyrus cannot look a record up by editor ID
  without an SKSE extension; it holds records through properties.

### Base records and references

Most records are **base records** — the definition of a sword, an NPC, a chest. A **reference** is a
record inside a cell that places a base record in the world: `REFR` for objects, `ACHR` for actors.
Change the base and every reference follows; change one reference and only that one does. References
are either **persistent** (always in memory, needed for quests and scripts) or temporary.

## Load order

- The game reads the active plugins from `plugins.txt` (`*Name.esp` = active), in
  `%LOCALAPPDATA%\Skyrim Special Edition\` — other stores use their own folder name, and Mod
  Organizer substitutes the profile's copy.
- `Skyrim.esm`, `Update.esm`, the three DLCs and the Creation Club plugins listed in `Skyrim.ccc` are
  always active and load first; `plugins.txt` omits them.
- Masters load before non-masters regardless of order in the file.
- **LOOT** sorts a load order from a community masterlist and flags known-dirty plugins; it is the
  standard first step when a user's load order is in doubt.

## Overrides, conflicts and patches

**The rule of one**: for each record, only the last override in load order counts — all of it. If
mod A raises the Iron Sword's damage and mod B (later) adds a keyword to it, the game sees B's copy:
B's keyword, *vanilla* damage. Neither mod is broken; together they conflict.

- **Patch**: a plugin, loading after both, whose override carries the combination — A's damage and
  B's keyword. Patches are how conflicts are resolved; editing A's or B's plugin is undone by their
  next update.
- **Merged patches** combine list-like records automatically: Wrye Bash's *Bashed Patch*, xEdit's
  *Merged Patch*, Synthesis patchers. Leveled lists are the classic case (see the `leveled-lists` skill).
- **Distribution frameworks** avoid the conflict altogether by changing things at runtime from text
  files instead of overriding records: SPID (spells, perks, items, outfits, factions onto NPCs), KID
  (keywords onto items), SkyPatcher (many record fields). Prefer them for broad additions.
- **ITM** (identical to master): an override that changes nothing. Harmless alone, but it still wins,
  so it silently reverts earlier mods' changes. Remove ITMs.
- **UDR** (deleted reference): a reference a plugin deleted outright. Other mods or saves that touch it
  crash the game. The fix is to undelete and disable it instead.
- **Deleted navmesh**: crashes when the area loads. Never delete a navmesh record.
- A plugin carrying ITMs or UDRs is called **dirty**; xEdit's *Quick Auto Clean* cleans one, and LOOT
  says which known plugins need it.

## Mod order, files and archives

Mod Organizer (MO2) never touches the real `Data` folder. Each **mod** is a folder under `mods\`; a
program started *through* MO2 sees one virtual `Data` folder layered from the enabled mods.

- **Mod order** (priority) decides **file** conflicts: when two mods ship the same file, the
  higher-priority mod's file is the one the game sees. It has no say over records.
- **Loose files beat archive contents**, whatever the order. Between two archives, the one belonging
  to the later plugin wins.
- An archive loads when it is named after an active plugin — `MyMod.bsa`, `MyMod - Textures.bsa` —
  or is listed in the game's INI.
- **Overwrite**: files a program writes *new* under MO2 land in the instance's `overwrite\` folder. An
  existing file it changes is written back to the mod that holds it.
- **Profiles** each have their own enabled mods, mod order and load order, and optionally their own
  game INIs and saves.
- MO2 keeps the profile in memory and writes `modlist.txt`, `plugins.txt` and `loadorder.txt` back on
  exit and before launching a program. An edit made to them while MO2 runs is lost unless MO2 is
  told to refresh first.
- A program started *outside* MO2 — this server included — sees only the real game folder, and must
  work out the virtual `Data` from mod order itself.

## Game versions and SKSE

| Game version | Era | Notes |
| --- | --- | --- |
| 1.5.97 | Special Edition (2019) | Header `1.70`. Large modding base; SKSE 2.0.20. |
| 1.6.640 | Anniversary Edition | Last build before the Creations update. |
| 1.6.1130 / 1.6.1170 | Creations update (Dec 2023 / Jan 2024) | Header `1.71`, 4,096-record light plugins. |
| 1.7.99 / 1.7.104 | August 2026 | Header still `1.71`. SKSE 2.3.1 supports 1.7.104. |

- **SKSE** (Skyrim Script Extender) adds Papyrus functions and loads `.dll` plugins. Each SKSE build
  matches exactly one game version.
- **SKSE plugins** find game code through the **Address Library**, a per-version database. A game
  update breaks every DLL until it is recompiled or its author ships a new Address Library build —
  1.7.x broke most 1.6 DLLs. Plugins built on CommonLibSSE-NG can support several versions at once.
- **Plugins and scripts survive game updates.** Only the header version and new vanilla records tie a
  plugin to a game version.
- GOG and Steam builds of the same version differ for SKSE: they need different SKSE builds.

## Papyrus and saves

- Papyrus source (`.psc`) compiles to `.pex` with the Creation Kit's `PapyrusCompiler.exe`. It needs
  the vanilla sources (`Data\Source\Scripts`), plus SKSE's sources when a script calls SKSE functions,
  as imports.
- Scripts run attached to records: a quest, a reference alias, an object reference, a magic effect
  (`ActiveMagicEffect`), an actor. The record lists its scripts and the values of their
  **properties**; a property left unfilled is `None` at runtime.
- **A save stores every running script, its variables and its registered events.** Remove a scripted
  mod and its script instances stay in the save, orphaned; ReSaver cleans them, at the user's risk.
- A save also keeps the runtime state of everything that changed — an actor's inventory, a container's
  contents, a moved object. Edits to such a record may not show in an existing save; test on a new
  game, or from the main menu with `coc <cell>`.
- Adding a plugin mid-playthrough is usually safe. Removing one is not, once it has scripts, placed
  references, or records the player has picked up.

## Where errors show up

| Symptom | First place to look |
| --- | --- |
| Crash before or at the main menu | A missing master, too many full plugins, a `1.71` plugin on an old game, or an SKSE DLL built for another version — `SKSE\skse64.log` lists DLLs that failed to load |
| Crash in game | Crash Logger SSE: `Documents\My Games\Skyrim Special Edition\SKSE\crash-*.log`. *POSSIBLE RELEVANT OBJECTS* names records with their plugin; the call stack names DLLs |
| Something silently doesn't happen | The Papyrus log, `…\Logs\Script\Papyrus.0.log` — off by default; enable `bEnableLogging=1` under `[Papyrus]` in the active `Skyrim.ini` (the profile's, under MO2) |
| A change has no effect | An override later in load order wins; or the save kept the old state |
| Invisible or purple objects | A missing mesh or texture, or an armor without an addon for the wearer's race |
| A plugin's own consistency | xEdit's *Check for Errors*, or `SSEDump -check` from the command line |
| Creation Kit load warnings | `EditorWarnings.txt` in the game folder |

## The Creation Kit's role here

The Creation Kit (CK) is the official editor. On this server it is used only through what runs
without its window: `PapyrusCompiler.exe`, and command-line switches such as `-GenerateLips` and
`-ConvertToESL`. Records are edited in the project, not in the CK.

What still needs the CK's window is done by the user: placing objects in the render window,
generating and finalising navmesh. Start the CK *through* Mod Organizer so it sees the deployed mod
and its masters; afterwards, **pull** the deployed plugin back into the project before the next
deploy, or the deploy refuses to overwrite the CK's work.

## Sources

- UESP, *Skyrim Mod: Mod File Format* — https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format
- UESP, *Skyrim: Special Edition Patch* — https://en.uesp.net/wiki/Skyrim:Special_Edition_Patch
- SKSE — https://skse.silverlock.org/
- Research notes in this repository: [`docs/research/`](../../../../docs/research/)
