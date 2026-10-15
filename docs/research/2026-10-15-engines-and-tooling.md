# Research: engines and tooling for a Skyrim SE modding MCP server

Gathered 2026-10-15. Facts only. "local:" means observed read-only on this machine (no tool was run except
`dotnet --list-*`). **UNVERIFIED** means I could not confirm it from a primary source.

## 0. Local environment, as observed

- `G:\Steam\...\Skyrim Special Edition\SkyrimSE.exe` file version 1.7.104.0; `CreationKit.exe` 1.7.99.0 (mtime 2026-10-15); `Papyrus Compiler\PapyrusCompiler.exe` 1.0.0.0 plus `PapyrusAssembler.exe`, `PCompiler.dll` and `ScriptCompile.bat`. Local: version resources.
- `Data\Source\Scripts` holds 14,302 files, including `TESV_Papyrus_Flags.flg`. `Data\Scripts.zip` is also present. There is no loose `Data\Scripts` (.pex) folder: the compiled scripts are inside the vanilla BSAs. Local: directory listing.
- `G:\LoreRim\Stock Game\SkyrimSE.exe` is 1.6.1170.0 and `skse64_1_6_1170.dll` is present. MO2 is 2.5.2, profile "Extreme". Local: `G:\LoreRim\ModOrganizer.ini`.
- **The folder "SSE Edit (4.0.4)" is misnamed.** It holds xEdit **4.1.5f**: `whatsnew.md` heads with "What's New in xEdit 4.1.5f" and the exe FileVersion is 4.1.5.0. It ships `SSEEdit.exe`, `SSEEdit64.exe`, `SSEEditQuickAutoClean.exe`, `SSEDump.exe`, `SSEDump64.exe`, 219 files in `Edit Scripts\` and an MPL-2.0 `LICENSE.txt`.
- MO2 launches xEdit with these real arguments: `-D:"G:\LoreRim\Stock Game\Data" -IKnowWhatImDoing -pseudoesl`, `... -quickautoclean` and `... -VQSC -iknowwhatimdoing`. Synthesis and zEdit get `-D:"...Stock Game\Data"`. MO2 also has a "Creation Kit Platform Extended" entry, but no CreationKit.exe exists in Stock Game. Local: `ModOrganizer.ini`.
- Synthesis.exe is 0.35.3 (self-contained, 278 MB). It embeds **Mutagen 0.52.0** (`Mutagen.Bethesda.Skyrim/0.52.0` etc.) and targets `.NETCoreApp,Version=v9.0`. Local: strings in `G:\LoreRim\tools\Synthesis\Synthesis.exe`.
- LOOT.exe is 0.24.1 and zEdit.exe is 0.6.6. Local: version resources.
- .NET: runtimes 6.0.36, 8.0.22, 9.0.6 and 10.0.8, and WindowsDesktop 6.0.36 and 9.0.6. **`dotnet --list-sdks` printed nothing, so no SDK is installed.** Local: dotnet CLI.
- Vanilla masters are **identical in header version** in both installs: Skyrim/Update/Dawnguard/HearthFires/Dragonborn.esm and `_ResourcePack.esl` are all form version 44 with HEDR 1.71. **Their contents differ**, for example Update.esm has 21,385 records on Steam 1.7.104 vs 21,232 in LoreRim Stock Game, and the file sizes differ. Local: TES4 headers read with a script. **UNVERIFIED cause**: it could be 1.7.x content changes or Wabbajack-cleaned masters in Stock Game.

## 1. Mutagen

- What it is: "A library for analyzing, creating, and manipulating Bethesda mods written in .NET" — https://github.com/Mutagen-Modding/Mutagen
- License: **GPL-3.0-only** (`PackageLicenseExpression` in Directory.Build.props; NuGet also says GPL-3.0-only) — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/Directory.Build.props , https://www.nuget.org/packages/Mutagen.Bethesda.Skyrim
- Latest stable is **0.54.4 (2026-08-08)**. The prerelease line is 0.55.0-alpha.67 (2026-10-06). Recent notes cover mod-split for exceeding master limits (0.53.0, 2026-02), FO3/FNV support (0.54.0, 2026-06-29), and fixes for zero-ID FormKeys (0.54.3/0.54.4) — https://github.com/Mutagen-Modding/Mutagen/releases , https://www.nuget.org/packages/Mutagen.Bethesda.Skyrim
- Target frameworks: `Mutagen.Bethesda.Skyrim.csproj` targets **net9.0;net10.0** (net8 is gone), so a helper needs the .NET 9 or 10 runtime — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/Mutagen.Bethesda.Skyrim/Mutagen.Bethesda.Skyrim.csproj
- Games (`GameRelease` enum): Oblivion, OblivionRE, SkyrimLE, **SkyrimSE**, SkyrimVR, SkyrimSEGog, EnderalLE/SE/SEGog, Fallout3, FalloutNV, Fallout4, Fallout4VR, Starfield — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/Mutagen.Bethesda.Kernel/GameRelease.cs
- Depth: "Strongly typed objects and fields for all records". It **reads and writes** plugins, load orders and strings. **Archives (BSA/BA2) are read-only.** — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/docs/index.md
- Correctness is checked by "passthrough" tests: import, re-export, then a byte-for-byte compare after normalisation (decompression, float and subrecord-order standardisation, strings reindexing) — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/docs/Correctness.md
- **Binary overlay (read-only) is the default import mode**: "Only fields that are accessed get parsed"; a mod object "is returned almost immediately … having done almost no parsing"; it keeps no references to records, so the GC can free them; it holds an open stream (`IDisposable`). The trade-off is that repeated property access re-parses, and repeated *Group* access re-reads from disk. `.Mutable()` loads everything up front. — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/docs/plugins/Importing.md , https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/docs/best-practices/Overlays-Single-Access.md
- Load orders use `LoadOrder.Import<ISkyrimModGetter>(dataFolder | listings, GameRelease.SkyrimSE)`; a Getter type gives overlays. `GameEnvironment.Typical.Builder(...).WithTargetDataFolder(...)` takes a custom Data folder, and a LinkCache resolves FormLinks across the load order — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/docs/environment/Environment-Construction.md
- MO2: the docs say MO2 "don't play well" with .NET 9's CET feature, and the fix is `<CETCompat>false</CETCompat>` in the csproj. I found no MO2 VFS / mods-folder resolution in the docs, so outside MO2 you would supply each plugin's path yourself (**UNVERIFIED** that no helper exists) — https://raw.githubusercontent.com/Mutagen-Modding/Mutagen/dev/docs/best-practices/Mo2-Compatibility.md
- CLI: **Mutagen ships no general-purpose CLI.** You write a C# console app. Ready-made CLIs built on it: Spriggit CLI (§2); Synthesis CLI `Synthesis.CLI.exe run-pipeline -o … -s PipelineSettings.json [-d DataFolder] [-l LoadOrderFile] [-p Profile]`; and the patcher contract `-s SourcePath -o OutputPath -g GameRelease -d DataFolderPath -l LoadOrderFilePath` — https://raw.githubusercontent.com/Mutagen-Modding/Synthesis/dev/docs/Synthesis-CLI.md , https://raw.githubusercontent.com/Mutagen-Modding/Synthesis/dev/docs/devs/Patcher-CLI.md
- Synthesis latest is 0.36.6 (2026-08-08), GPL-3.0; the local copy is 0.35.3 — https://github.com/Mutagen-Modding/Synthesis/releases
- MIT interplay: the GPL FAQ treats "pipes, sockets and command-line arguments" between separate programs as normally separate works, while linking makes a combined work. It is not legal advice — https://www.gnu.org/licenses/gpl-faq.html#MereAggregation
- Performance numbers for a ~3,400-plugin load order: I found no published benchmark (**UNVERIFIED**).

## 2. Spriggit

- Purpose: "converting Bethesda plugin files to a text based format that can be stored in Git" — https://github.com/Mutagen-Modding/Spriggit
- License **GPL-3.0**. Latest release **0.41.0 (2026-07-02)**: "Fo3 support, Net10 bump, … mutagen definition updates". Earlier: 0.40.1 (2026-04-24) and 0.40.0 (2025-10-19, "Packed CLI as a dotnet tool"). NuGet already has 0.42.0-alpha.2. Pre-1.0 — https://github.com/Mutagen-Modding/Spriggit/releases , https://api.nuget.org/v3-flatcontainer/spriggit.cli/index.json
- Distribution:
  - GitHub release assets `Spriggit.zip` (self-contained WPF UI, Windows only), `SpriggitCLI.zip` and `SpriggitLinuxCLI.zip` — https://github.com/Mutagen-Modding/Spriggit/releases
  - A dotnet tool package `Spriggit.CLI` with command name `spriggit`, `<TargetFramework>net10.0</TargetFramework>` — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/Spriggit.CLI/Spriggit.CLI.csproj
  - "The UI executable can also be run as a command line interface" — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/installation.md
- **The SDK is required.** Install docs: "Install Latest .NET SDK … needed by the 'engine' in order to download the Spriggit translation packages via `dotnet tool install`". The CLI zip "is not self contained". This machine has no SDK — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/installation.md , https://github.com/Mutagen-Modding/Spriggit
- Translation logic lives in NuGet packages (`Spriggit.Yaml.<Game>`, `Spriggit.Json.<Game>`) that are downloaded at run time. The text output is stamped with the package and version, so old text deserialises with the old package. That means network access to nuget.org on first use — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/translation-packages.md
- CLI verbs (`Spriggit.CLI.exe <verb>`) — https://mutagen-modding.github.io/Spriggit/cli/
  - `serialize` | `convert-from-plugin`: `-i/--InputPath` (plugin), `-o/--OutputPath` (a folder dedicated to Spriggit), `-g/--GameRelease SkyrimSE`, `-p/--PackageName Spriggit.Yaml|Spriggit.Json`, `-v/--PackageVersion`, `-t/--Threads`, `-m/--ModKey`, `-c/--Check` (default true), `-u/--ErrorOnUnknown` (default true), `-d/--DataFolder` (Starfield only), `--Debug`
  - `deserialize` | `convert-to-plugin` | `create-plugin`: `-i`, `-o`, optional `-p`/`-v` (auto-detected), `-t`, `-l/--Localized`, `-b/--BackupDays` (default 30)
  - `upgrade -p <SpriggitPath> -v <ver> [-s]`, `formid-collision -p <path>` (run after each git merge, at most 2 records per FormID), `merge-version-syncer -p <path>`, and `standardize -i -o -g` (a record-sorted plugin for binary diffing)
- A `.spriggit` JSON file next to or above the folder pins `{"PackageName","Release","Version"}` — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/spriggit-file.md
- Output: one folder per mod. The mod header is in `RecordData.yaml`. Records sit in per-type subfolders, one file per record (e.g. `GlassDagger.yaml`). Formats are **YAML or JSON** — https://mutagen-modding.github.io/Spriggit/output/
- **FormIDs are written as FormKeys** `<6-hex local ID>:<origin plugin filename>`, e.g. `FormKey: 087835:Skyrim.esm`, `Race: 013749:Skyrim.esm`, `PickUpSound: 08AB15:Immersive Sounds - Compendium.esp`. The text never uses a load-order or master index — https://mutagen-modding.github.io/Spriggit/output/
- Limitations:
  - It refuses to serialise "unexpected records" rather than skip them — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/unexpected-records.md
  - It **omits** CK junk fields (unused condition params, timestamps, unknown group data, `PlayerSkills.Unused`) and sets them to defaults on deserialise. A round trip is therefore not byte-identical for those fields — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/omissions.md
  - Text from before v0.20 needs v0.20 to decode — https://raw.githubusercontent.com/Mutagen-Modding/Spriggit/dev/docs/alpha-backwards-compatibility.md
- GameRelease values the CLI accepts include SkyrimSE, SkyrimSEGog, SkyrimVR, SkyrimLE, Fallout4, Starfield and others — https://mutagen-modding.github.io/Spriggit/cli/

## 3. xEdit / SSEEdit

- License: **MPL-2.0** (repo and local `LICENSE.txt`) — https://github.com/TES5Edit/TES5Edit
- Versions:
  - The latest GitHub *release* is `xedit-4.1.5f` (2024-04-28) — https://github.com/TES5Edit/TES5Edit/releases
  - Newer builds are distributed through Discord `#xedit-builds`. A Reddit post announced **4.1.5q** with "~250 commits since 4.1.5p". Its date is derived only from a snapshot, ~Feb 2026 (**UNVERIFIED** exact date) — https://reddit.sentinel-team.org/posts/1u6jz38/snapshots/2026-06-16T07%3A02%3A42.6264Z
  - The `dev-4.1.6` branch is active (many commits 2026-09-05/06) — https://github.com/TES5Edit/TES5Edit/tree/dev-4.1.6
- Switch syntax is `-Name` or `-Name:value` (`wbFindCmdLineParam`) — https://raw.githubusercontent.com/TES5Edit/TES5Edit/dev-4.1.6/Core/wbCommandLine.pas
- Switches found in `xEdit/xeInit.pas` (dev-4.1.6) — https://raw.githubusercontent.com/TES5Edit/TES5Edit/dev-4.1.6/xEdit/xeInit.pas
  - Paths: `-D:<Data>`, `-P:<plugins.txt>`, `-S:<scripts dir>`, `-T:<temp>`, `-O:<output>`, `-M:<My Games dir>`, `-I:<game ini>`, `-G:<saves>`, `-B:<backup>`, `-C:<cache>`, `-R:<log file>`, `-l:<language>`, `-moprofile:<MO profile>`, `-CustomIni:`
  - Game mode: `-SSE`, `-TES5`, `-FO4`, `-SF1`, etc., or the exe name — https://github.com/TES5Edit/TES5Edit
  - Tool modes (by switch or exe name): `edit`, `view`, `lodgen`, `script`, `translate`, `onamupdate`, `masterupdate`, `masterrestore`, `setesm`, `clearesm`, `sortandclean`, `sortandcleanmasters`, `checkforerrors`, `checkforitm`, `checkfordr`, plus `Saves`
  - Edit-mode automation: `-quickautoclean`/`-qac` (QAC + autosave), `-quickclean`/`-qc`, `-quickshowconflicts`/`-qsc`, `-veryquickshowconflicts`/`-vqsc` (implies autoload), `-autogamelink`/`-agl`, `-testconflicts:<outfile>` (plus `-comparetofile:`, `-fieldsfile:`, `-modgroups`; implies autoload; exit code 255 on load error), `-quickedit:<plugin>`, `-generateseq:<plugin>`. Only one of these may be active at a time.
  - `-autoload`, `-autoexit`. **In released builds they are parsed only in edit mode.** A 2026-09-06 dev commit extends them to script mode — https://github.com/TES5Edit/TES5Edit/commits/dev-4.1.6
  - Scripts: `-script:<file.pas>`. A game-specific extension such as `.ssepas`/`.tes5pas` forces "script" tool mode, which sets IKnowWhatImDoing, loads BSAs and builds refs. `-scripthost:` is also parsed.
  - Safety and other: `-IKnowWhatImDoing`; with it, `-AllowMakePartial`, `-AllowMasterFilesEdit`, `-AllowEditHEDRVersion`, `-StripEmptyMasters`, `-StripMasters:a,b`, `-AllowESPMaster`; plus `-nobuildrefs`, `-skipbsa`/`-forcebsa`, `-fixup`/`-nofixup`, `-AllowDirectSaves`, `-SimpleFormIDs`, `-EnforceAllMasters`, `-PseudoESL`/`-PseudoLight`/`-PseudoMedium`/`-PseudoSmall`, `-alwayssaveonam`, `-filteronam`, `-devmode`, `-resetsettings`.
- **Headless:** SSEEdit is a Delphi VCL GUI. Script and automation modes still open the main window and exit via `-autoexit`. I found no documented windowless mode (**UNVERIFIED** beyond source reading). The documented automation example is `FO4Edit.exe -script:"GreatScript.pas" -nobuildrefs` launched via ShellExecute — https://tes5edit.github.io/docs/13-Scripting-Functions.html
- **SSEDump.exe is a true console tool** (`{$APPTYPE CONSOLE}`). It loads a plugin and its masters and dumps the decoded contents to stdout. Options: `-d:datapath`, `-l:lang`, `-bsa`/`-allbsa`, `-dg:GROUPS`, `-xg:`/`-xr:`/`-xcg:`, `-xbloat`, `-top:N`, `-check` (Check for Errors), `-dcr`, `-es`, `-dh`, `-do:0..3`, `-q`. `SSEExport <RAW|UESPWIKI>` "will dump the plugin definition", i.e. a schema export — https://raw.githubusercontent.com/TES5Edit/TES5Edit/dev-4.1.6/xDump.dpr
- Scripting (Pascal via JvInterpreter):
  - Entry points `Initialize`, `Process(e)`, `Finalize`. No short-circuit evaluation, no overloads or out params.
  - API examples: `FileByIndex`, `AddNewFile`, `ElementByPath`, `GetElementEditValues`/`SetElementEditValues`, `wbCopyElementToFile`, `RecordByFormID`, `WinningOverride`, `ReferencedByCount`, `AddMessage`.
  - Sources — https://tes5edit.github.io/docs/13-Scripting-Functions.html ; 4.1.5q added `ScriptProcessSignatures` — reddit snapshot above.
- Record definitions: `Core/wbDefinitionsTES5.pas` (~378 KB, shared by TES5/SSE/VR) plus `wbDefinitionsCommon.pas`, written as Pascal builder calls (`wbRecord`, `wbStruct`…) with callbacks. They are not a data file. The machine-readable route is `SSEExport` (RAW/UESPWIKI) or porting. Any reuse is MPL-2.0, file-level copyleft — https://github.com/TES5Edit/TES5Edit/tree/dev-4.1.6/Core
- xEdit 4.1.5 added the Extended FormID range for SSE modules with HEDR 1.71 — https://github.com/TES5Edit/TES5Edit/releases

## 4. Skyrim SE 1.7.x update

- **1.7.99 was released 2026-08-20; 1.7.104 on 2026-08-27** (the 1.7.104 entry lists only crash and bug fixes) — https://en.uesp.net/wiki/Skyrim:Special_Edition_Patch . The previous build, 1.6.1170, dates from 2024-01-17 (same source).
- Official 1.7.99 CK changes: "Added Localization export support"; Search and Replace aligned with Starfield; "Creation Kit will now allow multiple master loads by default"; "Altered forms will no longer count as new forms when creating a plugin"; consistent .bsa capitalisation; fixed Creation submission mis-tagging files as Masterfile. **No mention of plugin format, ESL, Papyrus or save compatibility** — https://elderscrolls.bethesda.net/en-US/news/skyrim-update-august-20
- Plugin header: the last header bump was **1.70 → 1.71** in the Creations update of 2023-12-05 (1.6.1130), which raised ESL capacity from 2048 to 4096 new records. "Attempting to use a version 1.71 plugin on an old game build will likely crash." — https://www.nexusmods.com/skyrimspecialedition/articles/9691 , https://bethesda.net/article/4ORD7tshfmHUN8H4ULSgE4/the-elder-scrolls-v-skyrim-special-edition-creations-update-patch-notes
- Local evidence: the 1.7.104 vanilla masters are still **HEDR 1.71 / form version 44**, the same as 1.6.1170 (see §0). Form version: SE=44, LE=43 — https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format
- CK 1.7.99 vs game 1.6.1170: I found **no source** stating that CK-1.7.99 plugins are format-incompatible with 1.6.1170 (**UNVERIFIED** either way).
  - A "Creation Kit Downgrade Patcher (1.7.99)" exists that downgrades the CK to 1.6.1378.1 for a 1.6.1170 game. Nexus page returned 403; the fact comes from a search snippet — https://www.nexusmods.com/skyrimspecialedition/mods/190110
  - The masters differ in content between the two installs (§0), so references to records added in 1.7.x masters would dangle on 1.6.1170 (**UNVERIFIED** whether any were added).
- SKSE: "Current Anniversary Edition build **2.3.1 (game version 1.7.104)**"; GOG AE build 2.2.6 (1.6.1179); SE 1.5.97 build 2.0.20. Also "Mods using plugins probably need to be updated" — https://skse.silverlock.org/ . SKSE 2.3.0 targeted 1.7.99 — https://gitlab.com/BMMProject/Mods/SkyrimAccess/-/tags (search snippet).
- Address Library: the Nexus files list "All in One" **v13 for 1.7.104** and v12 for 1.7.99 (search snippet, page not fetched) — https://www.nexusmods.com/skyrimspecialedition/mods/32444?tab=files . Old DLLs fail with "must be recompiled for new address library" — https://rpgmodding.blogspot.com/2026/09/skyrim-171040-skse-231-address-library.html
- Papyrus .pex: I found no report of a format change in 1.7.x (**UNVERIFIED**). The last known Papyrus additions were 4 natives in Dec 2023 (`SetContainerAllowStolenItems`, `GetAllItemsCount`, `IsContainerEmpty`, `RemoveAllStolenItems`) — bethesda.net Dec-2023 notes above.
- DynDOLOD 3.00 Alpha 210/211 shipped DLLs for runtime 1.7.99/1.7.104 — https://dyndolod.info/Changelog

## 5. Creation Kit (SSE)

- **Command-line switches present in the local CreationKit.exe 1.7.99** (read as one contiguous string table): `-OptimizeMasterFile -BuildShaderList -ExportDialogue -GenerateLips -GenerateSingleLip -ExportFaceGenData -TagifyMasterfile -TagifyPlugin -ExportText -CompileTextExport -DelocalizeMasterfile -DelocalizeLocalMasterfile -DumpNeededFiles -OptimizeDLC -GenerateSEQ -ConvertToESL`. Local: byte search of `CreationKit.exe`. **Argument syntax and behaviour are UNVERIFIED.** An old forum thread (original-Skyrim era) describes `CreationKit.exe -GenerateLips <plugin>` and lists `-ExportText`/`-CompileTextExport` — http://www.gamesas.com/creationkit-exe-command-line-parameters-t256063.html
- Standalone CK tools in the Steam install (`Tools\`) — local listing:
  - `LipGen\LipGenerator\LipGenerator.exe` + `FonixData.cdf`, usage string `LipGenerator <wav> "<text>"`
  - `LipGen\LipFuzer\LIPFuzer.exe`, documented CLI `[-s srcDir] [-d dstDir] [-a audioExt] [-l lipExt] [-f fuzedExt] [--norec] [-u] [-i incl] [-e excl] [-v 0-2]`; `-u` unfuzes
  - `Archive\Archive.exe`, `Elric\xtexconv.exe`, `RoboVoicer.exe`, `HavokBehaviorPostProcess`
  - The Dec-2023 update added RoboVoice and LipFuzer and made LipGenerator 64-bit — bethesda.net Dec-2023 notes (§4)
- Uniquely CK, per general community knowledge, without a single primary source (**UNVERIFIED** as a list):
  - navmesh generation and finalisation
  - the render-window cell editing and placement
  - FaceGen head mesh/tint export (`-ExportFaceGenData` exists)
  - LIP generation (also possible with the standalone LipGenerator or third-party FaceFXWrapper, which needs `FonixData.cdf`)
  - vanilla Papyrus **sources** ship with the CK; papyrus-lang says "the Creation Kit is still needed for its script sources" — https://github.com/joelday/papyrus-lang/commits/main
  - Precombines/previs are a Fallout 4 concept; Skyrim SE has none (**UNVERIFIED**, no source fetched).
- CKPE (Creation Kit Platform Extended):
  - LGPLv3 from v0.6 (GPLv3 earlier); supports "Skyrim Special Edition 1.5.73.0 and later" — https://github.com/Perchik71/Creation-Kit-Platform-Extended
  - Latest releases: "v0.6 build 3" (22 Mar, year not shown) and "v0.6 build 1 – New engine (fully rewritten)". **No release mentions CK 1.7.99**, and a search snippet lists supported SSE CK builds only up to 1.6.1130 (**UNVERIFIED** support for 1.7.99) — https://github.com/Perchik71/Creation-Kit-Platform-Extended/releases

## 6. Papyrus tooling

- **PapyrusCompiler.exe (SSE) flags, read from the local binary's flag table:**
  - `-debug`/`-d`, `-optimize`/`-op`, `-output`/`-o=<dir>`, `-import`/`-i=<dirs ; separated>`, `-flags`/`-f=<file>`, `-all`/`-a` ("interprets object as the folder"), `-quiet`/`-q`, `-noasm`, `-keepasm`, `-asmonly`, `-?`
  - Usage: `PapyrusCompiler <object or folder> [<arguments>]`; it compiles in multiple threads ("Starting {0} compile threads")
  - **`-release` and `-final` do not exist in the SSE compiler**; they are Fallout 4 compiler flags (**UNVERIFIED**: the FO4 wiki returned 403)
  - Shipped example: `ScriptCompile.bat`: `PapyrusCompiler.exe %1 -f="TESV_Papyrus_Flags.flg" -i="...\Source\Scripts" -o="...\Data\Scripts"`. The flags file defines `Hidden 0`, `Conditional 1`, … ("DO NOT EDIT"). Local: `Papyrus Compiler\` and `Data\Source\Scripts\TESV_Papyrus_Flags.flg`.
- **Caprica** (Orvid): MIT. v0.3.0 (2023-10-02) brought Starfield and "includes support for Skyrim and Fallout 76" plus a `-pcompiler` mode accepting most PapyrusCompiler syntax, but "PPJ files are not currently supported". Last push 2024-06-18; it is dormant — https://github.com/Orvid/Caprica/releases . It adds language extensions (For, ForEach, Switch, Break/Continue) — https://github.com/Orvid/Caprica
- **Champollion** (decompiler .pex→.psc): LGPL-3.0, "for Skyrim, Fallout 4 and Starfield". v1.3.2 (2023-10-03) added `--print-info`, `--no-debug-line` and `-r` recursive. Last push 2023-10 — https://github.com/Orvid/Champollion/releases
- **Papyrus Language Tools** (joelday): MIT. Stable v3.2.0 (2023-03-15); v3.3.0-prerelease.1 (2024-10-04). **A 4.0 rework is landing on `main` now**, with commits on 2026-10-12/14: "4.0 CI/CD cutover and legacy removal", "publish main as a Marketplace preview", a NativeAOT language server, Pyro .ppj detection, and its own compiler `papyrusc verify --compile --game skyrimse` gated on byte-identical PEX — https://github.com/joelday/papyrus-lang , https://github.com/joelday/papyrus-lang/commits/main
- **russo-2025/papyrus-compiler** (written in V, MIT, Skyrim SE/AE only):
  - Latest release 2026.03.15; last push 2026-09-06
  - Commands: `compile -i <dir|psc> -o <dir> -h <headers dir> [-nocache -check -no-debug-info -original]`, `read`/`disassembly` (.pex → text), `create-dump` (dump.json of .pex info)
  - Builds for Windows, Linux and macOS
  - Source — https://github.com/russo-2025/papyrus-compiler
- **Pyro** (fireundubh, MPL-2.0): .ppj incremental build automation for TESV/SSE/FO4. Last release 2022; last push 2026-03 — https://github.com/fireundubh/pyro

## 7. JS/TS libraries and format specs

- **ESP/ESM/ESL in JS/TS: nothing maintained found.**
  - `@fcrick/tes-data` 0.0.1 (npm, 2016, Unlicense): TypeScript, "isn't really ready for consumption", Skyrim definitions incomplete — https://github.com/fcrick/tes-data , https://registry.npmjs.org/@fcrick/tes-data
  - `xelib` (z-edit): a native Node addon (node-gyp) around **XEditLib.dll** (Delphi xEdit core, Windows), MIT, "Will be published to npm soon", no releases; the npm `xelib` entry is a 0.0.0 placeholder — https://github.com/z-edit/xelib
  - npm has no `esptk`, `bsatk`, `esplugin` or `libloot*` packages (registry lookups returned 404).
- Non-JS options that could be wrapped via WASM or N-API:
  - `esplugin` (Rust, GPL-3.0, 6.1.4, 2026-01) reads headers, masters and FormIDs, and is used by LOOT — https://crates.io/crates/esplugin
  - `libloadorder` (Rust, GPL-3.0, 18.8.2) — https://crates.io/crates/libloadorder
  - `skyrim-cell-dump` (Rust, MIT) — https://crates.io/crates/skyrim-cell-dump
  - Python: `esplib` (BadDogSkyrim) — https://github.com/BadDogSkyrim/esplib
- **BSA v105:**
  - `ba2` crate (Rust, **0BSD**, 3.0.1, 2024-12): a "near-complete" reader/writer for Morrowind→Starfield archives, using memory-mapped I/O — https://crates.io/crates/ba2 , https://github.com/Ryan-rsm-McKenzie/bsa-rs
  - npm `bsa` 0.1.0 (2016) is stale.
  - Format: v104 = Skyrim LE (zlib); **v105 = SSE (LZ4)**, with v105 adding padding fields in folder records; a 36-byte header; hashes over lower-cased, backslash paths; archive flag bit 9 embeds file names — https://en.uesp.net/wiki/Skyrim_Mod:Archive_File_Format (last edited 2024-08-03)
- **NIF:**
  - `nifly` (ousnius, C++17, **GPL-3.0**, FO3→Starfield incl. SSE; no WASM, C API or Python bindings listed) — https://github.com/ousnius/nifly
  - PyNifly (Blender, GPL-3.0) — https://github.com/BadDogSkyrim/PyNifly
  - The format spec `nifxml` is now **GPL-3.0** — https://github.com/niftools/nifxml
  - I found no maintained JS/three.js NIF loader. The practical route found is NifSkope's glTF export for SSE → three.js GLTFLoader — https://github.com/fo76utils/nifskope/blob/develop/CHANGELOG.md
- Record-format specs:
  - UESP "Skyrim Mod:Mod File Format" (last edited 2026-04-29). Records: 24-byte header (type, dataSize, flags, FormID, timestamp, VC info, internal version, unknown). GRUP size *includes* its 24-byte header. Compressed flag 0x00040000 means zlib with a uint32 decompressed size. ESL flag 0x200; ESL holds 4096 records since 1.6.1130 — https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format
  - The xEdit definitions are the de facto complete spec (§3).
- Prior art (descriptions from GitHub search, not reviewed):
  - houseCARL (GPL-3.0, 44★, "data-layer access to your Skyrim SE load order … author patches") — https://github.com/Avick3110/houseCARL
  - SehtMCP (GPL-3.0, plugin authoring, validation, NIF inspection) — https://github.com/tel-0s/SehtMCP
  - SkyrimForge (MIT) — https://github.com/SenjuWoo/SkyrimForge
  - SkyrimPatcherMCP (GPL-3.0, Mutagen) — https://github.com/Gerkinfeltser/SkyrimPatcherMCP
  - fo4-mcp (Mutagen/Spriggit/Papyrus) — https://github.com/m4rmzNexus/fo4-mcp
  - `modwright` (npm, MIT, 0.1.10, 2026-10-12) — https://registry.npmjs.org/modwright

## 8. LOOT

- Versions and licenses:
  - LOOT app **0.29.2 (2026-08-16)**, GPL-3.0; local copy is 0.24.1 — https://github.com/loot/loot/releases
  - libloot **0.29.6 (2026-06-27)**, GPL-3.0 — https://github.com/loot/libloot/releases
  - Masterlist repo `loot/skyrimse` is **CC0-1.0**, pushed 2026-10-15 — https://github.com/loot/skyrimse
- libloot "is written in Rust. C++, Python and Node.js wrappers can be found in the `cpp`, `python` and `nodejs` subdirectories"; it is published to crates.io. The C++ DLL binaries are Windows-only — https://raw.githubusercontent.com/loot/libloot/master/README.md
- The **Node wrapper `libloot-nodejs`** is "**experimental**", built with NAPI-RS for win-x64 and linux-x64, and **not on npm**, so you must build it from source. Its package.json says MIT while libloot is GPL-3.0 — https://raw.githubusercontent.com/loot/libloot/master/nodejs/package.json , https://raw.githubusercontent.com/loot/libloot/master/nodejs/README.md
- `loot-condition-interpreter` (Rust, **MIT**, 6.0.0) parses and evaluates masterlist condition strings such as `checksum(...)`, `active(...)` — https://crates.io/crates/loot-condition-interpreter
- CLI: there is no separate CLI. LOOT.exe accepts `--game=<id>`, `--loot-data-path=<path>` and `--auto-sort` ("automatically sort the load order, apply the sorted load order, then quit"; requires `--game`) — https://loot.readthedocs.io/en/latest/app/usage/initialisation.html
- Data location: `%LOCALAPPDATA%\LOOT` by default, with a per-game "LOOT Folder" subfolder and a configurable "Masterlist Source" URL and "Masterlist prelude source" (same docs; local `tools\LOOT\docs\app\usage\settings.html`). The exact file path `...\LOOT\games\Skyrim Special Edition\masterlist.yaml` is **UNVERIFIED**, and no LOOT data folder exists on this machine.
- Masterlist URL: `https://raw.githubusercontent.com/loot/skyrimse/<branch>/masterlist.yaml`; branches `v0.26`, `v0.21` and `master` exist (~1.1 MB). Which branch LOOT 0.29 uses by default is **UNVERIFIED** (likely v0.26). Local fetch.
- Masterlist format: YAML 1.2. Top-level keys are `prelude`, `bash_tags`, `globals`, `groups`, `plugins`, and the prelude is replaced by the separate prelude file — https://loot-api.readthedocs.io/en/latest/metadata/file_structure.html
- Observed `v0.26` content:
  - ~3,162 plugin entries
  - field counts: `url` 1846, `clean` 1182, `msg` 701, `tag` 700, `dirty` 653, `after` 519, `inc` 278, `group` 194, `req` 177, `condition` 64
  - Heavy use of YAML anchors and merge keys, e.g. `- <<: *quickClean`; a consumer needs a YAML parser that supports merge keys
- Dirty-entry shape:
  ```yaml
  dirty:
    - <<: *quickClean
      crc: 0x17AB5E20
      util: '[SSEEdit v4.0.4](https://www.nexusmods.com/skyrimspecialedition/mods/164)'
      itm: 334
      udr: 92
      nav: 3
  ```
  The CRC is CRC32 of the whole file. Local: downloaded masterlist.
- Consuming it from TS: fetch the CC0 YAML directly and parse it (anchors and merge keys). Evaluate conditions by porting the grammar or wrapping the MIT condition interpreter. Using libloot itself, for sorting or full evaluation, means GPL-3.0 code, best kept in a separate process (see the GPL FAQ link in §1).
