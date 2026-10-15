# The modding tool landscape

What the community uses, what each tool is for, and when to send the user to it. "Here" says how the
tool relates to this server. Versions and states are as of October 2026.

## Editing records

| Tool | What it is | Here |
| --- | --- | --- |
| **Creation Kit** (CK) | Bethesda's editor, free on Steam with the game. The only tool with a 3D render window, navmesh generation and lip-sync generation built in. GUI only; slow to load; layout changes with patches. | Used through its command line only. The user opens it for object placement and navmesh, then the change is pulled into the project. |
| **xEdit** (SSEEdit) | The community's record editor: every record of every loaded plugin in a tree, with a conflict view colouring who overrides whom. Cleans dirty plugins (*Quick Auto Clean*), checks for errors, runs Pascal scripts. MPL-2.0. 4.1.5 is the public release; newer builds come from its Discord. | Send the user here to *see* conflicts across a load order, or to clean a dirty plugin. `SSEDump.exe` beside it is a console tool: `-check` runs *Check for Errors* without a window. |
| **Mutagen** | C# library that reads and writes Bethesda plugins, record-typed, GPL-3.0. | The engine behind this server's plugin reading and writing. |
| **Spriggit** | Converts a plugin to a folder of text — one YAML file per record — and back. Built on Mutagen, GPL-3.0. | The text format of a project. |
| **Synthesis** | Runs patchers written on Mutagen against a whole load order and writes one output plugin. | Recommend for load-order-wide patches (merging leveled lists, applying a rule to every NPC) that the user would otherwise redo after every list change. |
| **zEdit** | xEdit's former JavaScript successor, with UPF patchers. Dormant. | Mention only if the user already uses it. |

## Load order and patches

| Tool | What it is | Here |
| --- | --- | --- |
| **LOOT** | Sorts the load order from a community masterlist; warns about dirty plugins, missing requirements, incompatibilities. Its masterlist is CC0 YAML. | Recommend first when a load order is in doubt. The masterlist is a source for dirty-plugin facts. |
| **Wrye Bash** | Builds a *Bashed Patch* that merges leveled lists and other list-like records using *Bash tags* declared by mods. | Recommend for merging leveled lists across many mods. |
| **SPID** — Spell Perk Item Distributor | SKSE plugin; adds spells, perks, items, outfits, factions, packages to NPCs at runtime from `*_DISTR.ini` files, matched by keyword, faction, race, level… | Prefer over editing NPC records when a change targets many NPCs. Conflict-free by design. |
| **KID** — Keyword Item Distributor | Same idea for keywords on items (`*_KID.ini`). | Prefer for tagging many items. |
| **SkyPatcher** | SKSE plugin that changes many record fields at runtime from INI files. | An alternative to a patch plugin when the change is a rule, not a list of records. |

## Mod managers and installers

| Tool | What it is | Here |
| --- | --- | --- |
| **Mod Organizer 2** (MO2) | Keeps every mod in its own folder and shows programs a virtual `Data` folder; profiles with their own load order, INIs and saves. 2.5.2 is the current release. | An instance this server can be bound to (the default). |
| **Amethyst Mod Manager** | A native Linux manager in MO2's layout — profiles, `mods`, `overwrite` — that deploys a profile into the real `Data` by hard links, symlinks or a sandboxed view. | An instance this server can be bound to (`SKYRIM_MOD_MANAGER=amethyst`). |
| **Vortex** | Nexus Mods' own manager; deploys mods into the real `Data` folder by hard links. | Not supported. |
| **Wabbajack** | Installs complete curated mod setups into an MO2 instance. An update deletes every file the list does not know, except folders whose name starts with `[NoDelete]`. | Warn before changes to a Wabbajack-installed instance: list authors usually void support for modified installs. |

## Scripts

| Tool | What it is | Here |
| --- | --- | --- |
| **PapyrusCompiler.exe** | Ships with the CK. `PapyrusCompiler <file or folder> -f=TESV_Papyrus_Flags.flg -i=<imports> -o=<output> [-all] [-optimize] [-debug]`. SE has no `-release` or `-final`. | Compiles a project's scripts during build. |
| **Papyrus** VS Code extension (joelday) | Language server, linting, build tasks and a debugger for Papyrus; a 4.0 rework is under way. | Recommend for writing scripts by hand. |
| **russo-2025/papyrus-compiler** | An independent compiler for SE/AE; also disassembles `.pex`. MIT. | An alternative when the CK is not installed. |
| **Champollion** | Decompiles `.pex` back to `.psc`. Dormant but works. | When a mod ships no sources. |
| **Caprica** | An alternative compiler with language extensions. Dormant. | Mention only. |
| **Pyro** | Incremental builds from `.ppj` project files. | Mention only. |

## Archives, meshes, textures, sound

| Tool | What it is | Here |
| --- | --- | --- |
| **Archive.exe** (CK `Tools\Archive`) and **BSArch** | Pack and unpack BSA archives. | For packing a finished mod; loose files are fine while developing. |
| **Cathedral Assets Optimizer** | Converts and optimises meshes, textures and archives, e.g. Legendary Edition assets to SE. | When old assets crash or show wrongly. |
| **NifSkope** | Views and edits `.nif` meshes. | For checking a mesh path, a texture set, a shape. |
| **Outfit Studio / BodySlide** | Fits armor meshes to body shapes; builds the meshes for body presets. | Armor conversion and fitting. |
| **PyNifly** | Blender add-on for `.nif`. GPL-3.0. | Modelling. |
| **texconv** (also as `xtexconv` in the CK's `Tools\Elric`) | Converts textures to the right DDS compression. | |
| **LipGenerator / LIPFuzer** (CK `Tools\LipGen`) and the CK's `-GenerateLips` | Make lip-sync files from voice `.wav` and the spoken text; LIPFuzer packs `.wav` + `.lip` into `.fuz`. | Voiced dialogue, a later wave. |

## World, appearance, saves, settings

| Tool | What it is | Here |
| --- | --- | --- |
| **DynDOLOD / xLODGen / TexGen** | Generate distant LOD for objects, terrain and trees. | Rerun after adding anything visible from afar. |
| **EasyNPC** | Resolves NPC appearance conflicts between appearance mods, including FaceGen files. | Recommend when faces turn dark or mismatched. |
| **Pandora / Nemesis** | Behavior engines that patch animation behavior files for animation mods. | Rerun after adding animation mods. |
| **ReSaver** | Inspects and cleans saves, e.g. orphaned script instances. | Only with a backup of the save. |
| **BethINI Pie** | Edits the game's INI files with presets. | For INI questions. |

## Diagnosis

| Tool | What it is | Here |
| --- | --- | --- |
| **Crash Logger SSE** | SKSE plugin; writes `crash-<date>.log` with the probable call stack, the records involved and their plugins, loaded DLLs and plugins. | The input for crash analysis — a later wave. |
| **Phostwood's Crash Log Analyzer** | Web app that matches crash logs against a large rule set. GPL-3.0. | Recommend for a second opinion. |
| **Papyrus log** | The game's script log, off by default. | For scripts that silently fail. |
| **xEdit *Check for Errors*** | Finds broken references, invalid fields, missing masters in a plugin. | Run on a build before testing in game. |

## SKSE and its ecosystem

| Tool | What it is | Here |
| --- | --- | --- |
| **SKSE** | Script extender: new Papyrus functions, DLL plugins. One build per game version. | Projects whose scripts call SKSE functions need its script sources to compile. |
| **Address Library** | The per-version database SKSE DLLs locate game code with. | A DLL "built for another version" error points here. |
| **CommonLibSSE-NG** | The C++ library most SKSE plugins are written with; can target several game versions at once. | For DLL authors. |

## Nexus Mods

The main mod site. Its API has three generations: **v1 REST** (needs a personal API key; mod info,
files, changelogs, MD5 lookup; download links for premium accounts), **v2 GraphQL** (much of it works
without a key: search, MD5 lookup, batched version checks) and **v3 REST** (mostly for authors:
uploads, file versions). A personal key is tolerated for personal use; a public tool has to be
registered with Nexus.
