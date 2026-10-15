# Research: integrations for a Skyrim SE / MO2 / LoreRim MCP server

Gathered 2026-10-15. Facts only. "Local:" = observed read-only on this machine (G:\LoreRim, Documents\My Games).
**UNVERIFIED** = could not confirm from a primary source.

## 1. Nexus Mods API

### API generations (status as of 2026-10)
- Three surfaces exist: **v1 REST** (labelled "Legacy" by Nexus), **v2 GraphQL** (labelled work in progress), and **v3 REST** ("current actively developed version"). https://github.com/nexus-mods
- v3 OpenAPI spec: `https://api.nexusmods.com/openapi.yaml`, server `https://api.nexusmods.com/v3`, docs https://api-docs.nexusmods.com/ . It is mostly author-side (uploads, mod-file versions, collections editing, bug reports). Its read endpoints (`/games/{domain}/mods/{id}`, `/mods/{id}/files`, `/games/{domain}/trending-mods`) are badged **Experimental**. It has **no md5 lookup** and no update-check endpoint. https://api.nexusmods.com/openapi.yaml
- v3 auth: header `apikey` (personal key from https://www.nexusmods.com/settings/api-keys) or `Authorization: Bearer <JWT>`. Deprecation policy: 90 days for stable, 10 days for beta. https://api.nexusmods.com/openapi.yaml
- GraphQL v2 page says the V1 REST API "will continue to be supported for the foreseeable future" and that v2 features "may change or disappear without notice". https://graphql.nexusmods.com/

### v1 REST (the stable read API)
- Base `https://api.nexusmods.com/v1/...json`. All requests need header `apikey`. Without a key you get HTTP 401 (verified by probe). https://app.swaggerhub.com/apis-docs/NexusMods/nexus-mods_public_api_params_in_form_data/1.0 (spec JSON: https://api.swaggerhub.com/apis/NexusMods/nexus-mods_public_api_params_in_form_data/1.0)
- Identification headers: the AUP says to send `Application-Name` (keep it constant across versions) and `Application-Version`, and forbids blank metadata or metadata that impersonates another app. https://help.nexusmods.com/article/114-api-acceptable-use-policy
- Nexus's own Node client also sends `Protocol-Version` and `User-Agent: NexusApiClient/<ver> (<os>; <arch>)`. https://github.com/Nexus-Mods/node-nexus-api/blob/master/src/Nexus.ts
- Endpoints relevant here (game domain `skyrimspecialedition`), from the v1 spec:
  - `GET /v1/users/validate.json`: validates the key and returns user info. It does **not** count toward the hourly limit. Response fields: `user_id, key, name, is_premium, is_supporter, email, profile_url`. https://github.com/Nexus-Mods/node-nexus-api/blob/master/src/types.ts
  - `GET /v1/games/{game}/mods/{id}.json`: mod info, cached for 5 minutes.
  - `GET /v1/games/{game}/mods/{mod_id}/files.json?category=main,update,optional,old_version,miscellaneous`: files list.
  - `GET /v1/games/{game}/mods/{mod_id}/files/{file_id}.json`: a single file.
  - `GET /v1/games/{game}/mods/{mod_id}/changelogs.json`: changelogs.
  - `GET /v1/games/{game}/mods/updated.json?period=1d|1w|1m`: mods updated in that period (only these three values), cached for 5 minutes.
  - `GET /v1/games/{game}/mods/md5_search/{md5}.json`: identifies a file by its MD5.
  - `GET /v1/games/{game}/mods/latest_added.json`, `latest_updated.json`, `trending.json`: 10 mods each.
  - `GET|POST|DELETE /v1/user/tracked_mods.json`, `GET /v1/user/endorsements.json`, `POST .../endorse.json` and `.../abstain.json`.
  - `GET .../files/{id}/download_link.json`: premium users get an array of CDN links. **Non-premium users must pass `key` and `expires` taken from an `nxm://` link generated on the website.** In effect, API downloads without visiting the site are premium-only.
  - (all endpoints above: v1 spec JSON)
- Local: MO2's `ModOrganizer.ini [Servers]` contains `premium=true` entries. This only suggests the user's account is premium; confirm with `users/validate`.

### Rate limits
- Current: **20,000 requests per 24 h, then 500 per hour** once the daily quota is used up (help article updated 2026-06-03). https://help.nexusmods.com/article/105-i-have-reached-a-daily-or-hourly-limit-api-requests-have-been-consumed-rate-limit-exceeded-what-does-this-mean
- The v1 swagger text still says 2,500 per day / 100 per hour. That figure is **outdated**. It also documents the response headers `X-RL-Hourly-Limit/Remaining/Reset` and `X-RL-Daily-Limit/Remaining/Reset`, HTTP 429 when a limit is exceeded, and an nginx 429 above roughly 30 requests per second. Limits are counted per user, so regenerating a key does not reset them. (v1 spec JSON)
- GraphQL v2: an anonymous probe returned no rate-limit headers. Its limits are **UNVERIFIED**.

### GraphQL v2
- Endpoint `POST https://api.nexusmods.com/v2/graphql`. "Most of GraphQL V2 is accessible without authentication, but some endpoints do require an OAuth token." https://graphql.nexusmods.com/
- Verified by anonymous probes on 2026-10-15:
  - `fileHash(md5)` and `fileHashes(md5s)` return `{fileName, fileSize, modFileId, gameId, modFile{modId,name,version}}`. md5 identification therefore works **without an API key**. It returns a list that can span several games, so filter by `gameId`.
  - `legacyModsByDomain(ids:[{gameDomain,modId}])` is a batch lookup returning `version` and `updatedAt`. This is useful for update checks across ~4,000 meta.ini mod IDs. Maximum batch size is **UNVERIFIED**.
  - `mods(filter, sort, offset, count)` works. Filter fields include `gameDomainName`, `updatedAt`, `hasUpdated`, `name`, `author` and `tag`. Sort fields include `endorsements`, `downloads`, `updatedAt` and `createdAt`. This replaces trending/latest.
  - Also available: `modFiles(modId, gameId)`; `modFileContents` (file paths inside archives); `collection` and `collectionRevision`.
- Other prior-art servers (houseCARL, nexus-mcp) also query v2 anonymously. See §5.

### Terms (Acceptable Use Policy, last updated 2020-12-01)
- Personal keys are "tolerated" for apps "in the testing stage of development or are intended for personal use only".
- Public-facing apps must be registered: contact support with a name, a short description and a logo. Registration gives the app a "slug" for SSO.
- Unacceptable uses:
  - using personal keys in public-facing applications;
  - storing user API keys on your own server, or using them without user-initiated action;
  - mass fetching data to rehost it ("scraping");
  - blank or impersonating request metadata.
- Source for all of the above: https://help.nexusmods.com/article/114-api-acceptable-use-policy
- The v1 docs add: "NEVER share your personal API keys with any other user, or include it as part of your own software." Only approved applications can use SSO (`https://github.com/Nexus-Mods/sso-integration-demo`). (v1 spec JSON)
- GraphQL page: full documentation and self-registration of OAuth clients are promised "once the API is complete". Today they are not available. https://graphql.nexusmods.com/
- The AUP says nothing explicit about download automation or caching. The premium/nxm rule on `download_link` is the effective control. **UNVERIFIED**: whether Nexus objects to a local tool caching API responses.

## 2. Mod Organizer 2: file formats and behaviour

- Local: MO2 **2.5.2** (`ModOrganizer.ini [General] version=2.5.2`). It is a portable instance (`portable.txt` contains "Created by Wabbajack"), with `gamePath=G:\LoreRim\Stock Game` and `selected_profile=Extreme`. 2.5.2 (2024-08-04) is still the newest MO2 GitHub release. https://github.com/ModOrganizer2/modorganizer/releases
- Local: profiles `Default`, `Extreme` and `Ultra`. `settings.ini` has `LocalSaves=true` and `LocalSettings=true`, so each profile carries its own `skyrim.ini`, `skyrimprefs.ini`, `skyrimcustom.ini` and (for Extreme/Ultra) a `saves\` folder. The profile `settings.ini [custom_overwrites]` maps executables to output mods, for example `Synthesis=LoreRim - Synthesis Output` and `xEdit64=LoreRim - xEdit64 Output`.

### modlist.txt
- Each line starts with a prefix: `+` enabled, `-` disabled, `*` foreign/unmanaged (DLC, CC). `#` lines are comments. The writer emits the header `# This file was automatically generated by Mod Organizer.` and CRLF line endings. https://github.com/ModOrganizer2/modorganizer/blob/master/src/profile.cpp (doWriteModlist, readModlist)
- **The file runs from highest priority at the top to lowest at the bottom.** It is written in reverse priority order, and "the priority are reversed to match the plugin list (highest wins)". (profile.cpp comments)
- Local confirmation: the top line is `-ADDING ANY MODS VOIDS SUPPORT - RULES IN DISCORD.GGBUNGALO_separator`, then `Testing Mods - Ignore If Empty_separator`, `DO NOT DISABLE - FINAL OVERWRITES_separator`, and so on. The bottom lines are `+Unofficial Skyrim Special Edition Patch`, `+Base Game, Unofficial Patches & Fixes_separator`, `+CORE_separator`.
- Separators are mods whose name ends in `_separator`.
- Mods found in `mods\` but missing from the file get high priority. Foreign mods get priority below 0. Backups and `overwrite` come last. (profile.cpp)
- Local, Default profile: 4,066 lines (3,945 `+`, 122 `-`). Extreme also ends with `*Creation Club: _ResourcePack`, `*DLC: Dawnguard` and similar lines.
- Local: the files are encoded as UTF-8 or ASCII, with no BOM.

### plugins.txt / loadorder.txt / lockedorder.txt
- `plugins.txt` is in the game's own format: `*Name.esp` for active plugins, a bare name for inactive ones, in load order.
  - **Primary plugins** (base masters, plus CC/AE files the game force-loads) are **omitted**.
  - It is written in the **system ANSI codepage** (`QStringConverter::Encoding::System`), not UTF-8.
  - Source: https://github.com/ModOrganizer2/modorganizer-game_gamebryo/blob/master/src/creation/creationgameplugins.cpp
- `loadorder.txt` is MO2's own complete order, including primary plugins. On refresh, MO2 reads `loadorder.txt` unless `plugins.txt` is newer, judged by file mtime. (creationgameplugins.cpp, getLoadOrder)
- Local, Default profile: `plugins.txt` has 3,410 `*` lines and no inactive lines. `loadorder.txt` has 3,490 entries. The 80 extra entries are exactly Skyrim/Update/DLC/CC/`_ResourcePack.esl`.
- Local, Extreme profile: `plugins.txt` has 3,444 active entries and starts with the game's own header `# This file is used by Skyrim to keep track of your downloaded content.`, so the game also rewrites it.
- `lockedorder.txt` has one `PluginName|priority` per line and pins plugins to load-order slots. Locally it is empty apart from the header. https://github.com/ModOrganizer2/modorganizer/blob/master/src/pluginlist.cpp (writeLockedOrder)
- `plugingroups.txt` has only the header locally. Its writer and semantics are **UNVERIFIED**; it was not found in the MO2 sources searched.
- `archives.txt` (786 lines locally) lists BSAs.

### mods\<name>\meta.ini
- `[General]` keys read and written by MO2:
  - `gameName`, `modid`, `version`, `newestVersion`, `ignoredVersion`, `installationFile`, `repository` (`Nexus` or empty), `url`, `hasCustomURL`;
  - `nexusFileStatus`, `category` (`"24,"`), `nexusCategory`, `nexusDescription` (BBCode, often many KB), `lastNexusQuery`, `lastNexusUpdate`, `nexusLastModified`;
  - `endorsed`, `tracked`, `converted`, `validated`, `color`, `notes`, `comments`, `author`, `uploader`, `uploaderUrl`.
  - Source: https://github.com/ModOrganizer2/modorganizer/blob/master/src/modinforegular.cpp
- `[installedFiles]` holds `1\modid=31826`, `1\fileid=119967`, `size=1`. The Nexus file ID is here, not in `[General]`. Local: present in 3,203 of 4,106 mods.
- Local key-casing is mixed: `gameName=SkyrimSE` vs `gamename=skyrimse`, `newestVersion` vs `newestversion`. 4,092 mods have meta.ini, 217 have `modid=0`, and 3,745 have `repository=Nexus`. A parser must be case-insensitive.
- A version prefix `d` means date scheme (local: USSEP `version=d2025.12.21.0`). `f` and `n` are other schemes. https://github.com/ModOrganizer2/modorganizer-uibase/blob/master/src/versioninfo.cpp
- Plugin data is also stored here, for example `FOMOD%20Plus\fomod=` (JSON of the FOMOD choices, in 722 mods).
- Local `nexusFileStatus` values include `1000` and `7`. The meaning of each value is **UNVERIFIED**.

### Overwrite, USVFS, conflicts
- USVFS shows mods to processes launched through MO2 only. The real `Data` folder is untouched. https://stepmodifications.org/wiki/Guide:Mod_Organizer
- A process **not** started by MO2 (such as an MCP server) sees only `Stock Game\Data`. To see the virtual Data folder it must compute it itself from modlist priority.
- On loose-file conflicts, the higher-priority mod (lower in MO2's left pane, higher in modlist.txt) wins. `overwrite` sits above all mods. Files that VFS-launched tools write without a mapped target go to `overwrite\`, or to a custom overwrite mod per executable (local settings.ini, above). (STEP guide; profile.cpp priority layout)
- BSA vs loose: the game's rule is that loose files beat BSA contents and BSAs follow plugin load order. Older guides describe a "Have MO manage archives" mode. **UNVERIFIED** whether 2.5.2 still has it. https://stepmodifications.org/wiki/Guide:Mod_Organizer

### Does MO2 overwrite external edits?
- On exit, the `~OrganizerCore` destructor calls `saveCurrentProfile()`. That writes modlist.txt (delayed writer), `initweaks.ini`, plugins.txt, loadorder.txt and lockedorder.txt from **in-memory state**. https://github.com/ModOrganizer2/modorganizer/blob/master/src/organizercore.cpp
- So an external edit made while MO2 runs is lost unless MO2 re-reads the file first.
- `refresh(saveChanges=true)` (F5, or `ModOrganizer.exe refresh`) first flushes pending modlist writes, then re-reads modlist from disk (`refreshModStatus`). Plugin lists are re-read by mtime. (organizercore.cpp; creationgameplugins.cpp)
- **Inference**: the safe external edit is to close MO2, edit, then restart. Or edit while MO2 has no pending changes and immediately trigger `refresh`.

### Python plugin API (mobase)
- Local: MO2 embeds Python 3.12 (`plugins\plugin_python\libs\mobase.cp312-win_amd64.pyd`) with PyQt6. `_socket` and `_asyncio` are available, so an in-process bridge (localhost HTTP or pipe) is technically possible. No existing MO2 "API bridge" plugin was found. https://www.modorganizer.org/python-plugins-doc/
- `IOrganizer` (uibase `imoinfo.h`):
  - paths: `profileName/profilePath/modsPath/overwritePath/downloadsPath`;
  - lists: `modList()`, `pluginList()`, `profile()`, `profileNames()`, `executablesList()`;
  - virtual files: `resolvePath()` (virtual→real), `findFiles()`, `getFileOrigins()`, `virtualFileTree()`;
  - actions: `startApplication()`, `waitForApplication()`, `refresh(saveChanges)`;
  - callbacks: `onAboutToRun`, `onFinishedRun`, `onNextRefresh`, `onProfileCreated/Renamed/Removed/Changed`;
  - plugin settings: `pluginSetting/setPersistent`.
  - Source: https://github.com/ModOrganizer2/modorganizer-uibase/blob/master/include/uibase/imoinfo.h
- `IModList`: `allMods`, `allModsByProfilePriority`, `getMod`, `state`, `setActive`, `priority`, `setPriority`, `onModInstalled/Removed/StateChanged/Moved`. `IPluginList`: `pluginNames`, `state/setState`, `priority`, `loadOrder/setLoadOrder`, `masters`, `origin`, `isLightFlagged/isMediumFlagged/isMasterFlagged`, `onRefreshed`, `onPluginStateChanged`. https://github.com/ModOrganizer2/modorganizer-uibase/blob/master/include/uibase/imodlist.h , .../ipluginlist.h
- Local: other installed MO2 plugins include LogParsingManager v5.4.2 (Hymlock, **CC BY-NC-ND 4.0**), "Crash Log Labeler" (Parapets' Crash Log Tools, `offline_mode=true`), Bethesda Plugin Manager, Form43Checker, ScriptExtenderPluginChecker and rootbuilder.

### ModOrganizer.exe command line (2.5.x)
- Global options: `--help`, `--multiple` (unsupported), `--pick`, `--logs` (duplicate logs to stdout), `-i/--instance NAME` (portable = empty), `-p/--profile NAME`.
- Commands:
  - `run [-e] [-a ARGS] [-c CWD] NAME`: run a file, or with `-e` a configured executable such as `"SKSE"`, under the VFS;
  - `refresh` ("same as F5");
  - `reload-plugin PLUGIN`;
  - `download URL [-g game -n name -m modname -v version -s source]`;
  - `crashdump`.
- Commands can be forwarded to an already-running primary MO2 process.
- A bare `moshortcut://<instance>:<executable>` (portable: `moshortcut://:<exe>`) also works, and `nxm://` links are accepted.
- Source: https://github.com/ModOrganizer2/modorganizer/blob/master/src/commandline.cpp , .../src/moshortcut.cpp
- While a launched program runs, MO2 locks its UI (`UILocker::PreventExit`). (commandline.cpp, RunCommand)
- Local executables (ModOrganizer.ini `[customExecutables]`, 33 entries): `LoreRim` (skse64_loader), `SKSE`, `xEdit64`, `xEdit QAC`, `Synthesis`, `Nemesis`, `Reqtificator`, `DynDOLOD`, `TexGen`, `LOOT`, `ReSaver`, `PCA SE`, `Creation Kit` and others. Fields per entry: `title`, `binary`, `arguments`, `workingDirectory`, `steamAppID`, `hide`, `ownicon`, `toolbar`.

## 3. Wabbajack and user changes

- Wabbajack latest release is 4.2.3.0 (2026-09-09). https://github.com/wabbajack-tools/wabbajack/releases
- On install or update, **every file in the install folder that the modlist does not account for is deleted**, except:
  - files in the downloads folder;
  - the `.wabbajack` file itself;
  - anything under `profiles\<name>\saves\...` (any depth);
  - BSAs already up to date;
  - any path containing a component starting with `[NoDelete]`. This is case-insensitive, whitespace is stripped first (so `[No Delete]` also counts), and it also matches a *file* named `[NoDelete]...`.
  - Source: https://github.com/wabbajack-tools/wabbajack/blob/main/Wabbajack.Installer/FileDeletionRules.cs (refactored 2026-09-12, "No behaviour change")
- Current code asks the user to confirm before deleting: "Save files, downloads and [NoDelete] folders will be preserved." https://github.com/wabbajack-tools/wabbajack/blob/main/Wabbajack.Installer/AInstaller.cs (OptimizeModlist). Which release first shipped the dialog is **UNVERIFIED**.
- **Inference from that code**:
  - user-made profiles are wiped except their `saves\`, unless the profile folder is named `[NoDelete]...`;
  - user files in `overwrite\` are wiped;
  - modlist.txt and plugins.txt are replaced by the list's copies.
- Community guidance:
  - prefix your own mods with `[NoDelete] ` in MO2's left pane;
  - after an update, those mods may be moved to the bottom or disabled and plugin positions scrambled. The "Mod Keeper" MO2 plugin saves and restores priorities and states; its tips say to click "Save Priorities" before updating.
  - Sources: https://genesismodlist.com/modifying-install/ , https://vivanewvegas.moddinglinked.com/wabbajack.html , https://www.nexusmods.com/site/mods/1768
- LoreRim official:
  - "Any mods you have added will be deleted when updating." Updating means re-running the install with the same paths and "overwrite existing modlist" ticked. Back up saves first, because a new game may be needed. https://lorerim.com/read-me
  - Rule 11: "If you make any changes to the mod lists, note that we cannot offer you help for issues that arise from those changes." Only listed MCM options and the bottom "optional mods" are "safe to modify". https://lorerim.com/support/safe-to-modify
  - Profiles in the readme are "Default" (2D tree LODs, no grass LODs, lighter ENB) and "Ultra". Saves are not compatible across profiles. The local install also has an `Extreme` profile, which the readme does not document. https://lorerim.com/read-me
  - Local: LoreRim's modlist.txt carries a "Testing Mods - Ignore If Empty" separator near the top. Its first separator reads "ADDING ANY MODS VOIDS SUPPORT - RULES IN DISCORD.GGBUNGALO".
  - No LoreRim-published `[NoDelete]` guidance was found (**UNVERIFIED**; it may be on Discord).
- Game version: the LoreRim readme says "The specific version used is 1.7.99". CrashLoggerSSE v1.25.0 (2026-08-21) added "support Skyrim AE 1.7.99". The local crash logs show **Skyrim SSE v1.6.1170**, SKSE 2.2.6 and CrashLogger 1.23.1, which suggests the local install predates a LoreRim update. https://lorerim.com/read-me , https://github.com/alandtse/CrashLoggerSSE/releases

## 4. Crash analysis

### Crash Logger SSE (local v1.23.1; latest v1.25.0, 2026-08-21)
- Repo https://github.com/alandtse/CrashLoggerSSE. The README states the license as GPL-3.0-or-later with modding and linking exceptions ("Originally based on code under MIT"). GitHub's API reports MIT, from the LICENSE file. The repo has no format documentation; the structure below is from the local logs.
- Location: `Documents\My Games\Skyrim Special Edition\SKSE\crash-YYYY-MM-DD-HH-MM-SS.log`. `CrashLogger.log` confirms "Crash Logs will be written to ...\SKSE". Local: 10 logs of 67–247 KB, about 5,000 lines each. One 575-byte log stops after the AV analysis.
- Local config `mods\LoreRim - MCM and INI Settings\SKSE\Plugins\CrashLogger.ini`: `Max Crash Logs = 20`, `Auto Open Crash Log = true`, `Crash Log Write Minidump = false`, plus thread-context keyword lists (Papyrus VM, Havok, Rendering, Audio, Job).
- Section order observed in all local logs:
  1. Header: `CRASH TIME:`, `Skyrim SSE v1.6.1170`, `CrashLoggerSSE v1-23-1-0 <build date>`, then `Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x… SkyrimSE.exe+0FA9FF0<TAB>mov ecx, [rbx+0x10] | FUN_…`, then Exception Flags, Exception Thread ID, and `Access Violation: Tried to read memory at 0x…`.
  2. `ACCESS VIOLATION ANALYSIS:`: instruction, memory operand, base register value ("likely invalid"), computed address.
  3. `POSSIBLE RELEVANT OBJECTS:`: `RSP+DF8: (Character*) "Fire Mage" [0x0008B95E] ("Sunderstone.esp")`. This is the type, name, FormID and **originating plugin**, and the most useful section for mod attribution.
  4. `PROCESS INFO:`: PID, uptime, working dir, command line, exe MD5, size and mtime.
  5. `THREAD CONTEXT (HEURISTIC):`: `Likely Role: Rendering`.
  6. `SYSTEM SPECS:`: OS, CPU, GPU(s), physical, virtual and process memory, page faults, GPU memory, VM detection.
  7. `CALL STACK ([P]robable / [S]tack scan):`: `[ n][P|S] 0xADDR module+offset<TAB>instr | symbol -> addressLibID+0xoff`. SKSE DLL frames carry source paths and C++ signatures when PDBs exist. This is where the faulting DLL usually shows up.
  8. `REGISTERS:`: RAX–R15 with type annotations.
  9. `STACK:`: `[RSP+off] value (type) …`, cross-referencing "See RSP+…" into POSSIBLE RELEVANT OBJECTS.
  10. `MODULES:`: DLL name and base address.
  11. `SKSE PLUGINS:`: `name.dll vX`.
  12. `PLUGINS:`: `Light: 3334 Regular: 178 Total: 3512`, then `[ 0] Skyrim.esm` … `[FE:D01] x.esp`, i.e. load-order index → plugin.

### Existing analyzers
- **Phostwood's Skyrim Crash Log Analyzer**:
  - Web app https://phostwood.github.io/crash-analyzer/skyrim.html , repo https://github.com/Phostwood/crash-analyzer . Licensed **GPL-3.0** (GitHub API); pushed 2026-05-29.
  - Pure client-side JS. Rule data lives in `js/diagnoses.js` (~348 KB), `crashIndicatorsMap.js` (named groups of string indicators such as `nvwgf2umx.dll` or `Interface/Quest_Journal.swf`, each with a description), `highestPriorityIndicators.js` (de-noised view of relevant objects, the probable call stack and registers), `dllCompatibleSkyrimVersionsMap.js`, `essentialModsMap.js` and `explainersMap.js`.
  - Parses Crash Logger, .NET Script Framework and Trainwreck logs. Claims to diagnose "75-90% of crashes with identifiable causes".
  - Reusing its rules makes a derived work GPL-3.0.
  - Related: "Phostwood's QLP" MO2 plugin and the Sovnkrasch public log upload service (ToU 2026-02-23: uploads are public and cannot be deleted). https://phostwood.github.io/crash-analyzer/TermsOfUse.html (also `TermsOfUse.html` in the repo)
- **Parapets' Crash Log Tools / Crash Log Labeler** (MO2 plugin): labels addresses using the Address Library database. It clones a repo at first start unless offline mode is on. https://nexusmods.com/skyrimspecialedition/mods/66743 , fork for MO2 2.5: https://nexusmods.com/skyrimspecialedition/mods/113668
- **Log Parsing Manager** (MO2 plugin, Hymlock): regex-based parsing of crash logs and Papyrus logs. **CC BY-NC-ND 4.0**, so no derivatives. https://nexusmods.com/skyrimspecialedition/mods/135040 (local README)
- **Skyrim Crash Decoder** (skyrimcrashdecoder.com): paste-and-report website. Rules are not open (**UNVERIFIED**).
- **CLASSIC** (Buffout 4, Fallout 4): YAML-database scanner; licence NOASSERTION per GitHub. Shown as a pattern reference only. https://github.com/evildarkarchon/CLASSIC-Fallout4
- **ModWrench** `mw_diagnose_crash` / `mw_crash_whisperer` (MIT, see §5): parses Crash Logger SSE, Buffout 4, NetScriptFramework and BepInEx logs.
- Community warning: post the raw log, not an analyzer's summary. Trainwreck logs are less informative. (r/skyrimmods guidance, via search; **UNVERIFIED** primary link)

### Papyrus log
- Enable it in the active INI under `[Papyrus]`: `bEnableLogging=1`, `bEnableTrace=1`, `bLoadDebugInformation=1`. The last one adds line numbers and costs memory.
- Output goes to `Documents\My Games\Skyrim Special Edition\Logs\Script\Papyrus.0.log`. It rotates: 0 is newest, then 1, 2, 3. https://stepmodifications.org/wiki/Guide:Skyrim_INI/Papyrus , https://www.nexusmods.com/skyrim/articles/368 (2010s source, still accurate)
- Local: with `LocalSettings=true`, the **profile's** `skyrim.ini` is the active one. All three profiles have `bEnableLogging=0`, `bEnableTrace=0` and `bLoadDebugInformation=0`, and `Logs\` does not exist under My Games. Local: a `Papyrus Profiler` mod is installed but disabled.
- Common patterns:
  - `Cannot open store for class "X", missing file?`: a .pex is missing from Data\Scripts.
  - `Unable to bind script X to Y because their base types do not match`: often harmless, comes from mismatched records.
  - `Unable to call X - no native object bound to the script object, or object is of incorrect type`: the object is None or deleted, often an ActiveMagicEffect.
  - `Suspended stack count is over our warning threshold`: too many waiting stacks.
  - `VM is freezing` / `VM is frozen`, followed by a full stack dump: the VM was overloaded for ~5 s. Whether data is lost is disputed.
  - `iMaxStackDepth` limits recursion.
  - Sources: https://ck.uesp.net/wiki/Papyrus_Runtime_Errors , https://www.nexusmods.com/skyrimspecialedition/articles/4625 , https://ck.uesp.net/wiki/User:DavidJCobb/Stack_dumping , https://skyrimck.uesp.net/wiki/INI_Settings_(Papyrus)

### SKSE logs (same SKSE folder)
- Local: 246 files. They include `skse64.log` (runtime version, plugin directory `G:\LoreRim\Stock Game\Data\SKSE\Plugins\`, load results per plugin), `skse64_loader.log`, `CrashLogger.log`, `EngineFixes.log`, `po3_*.log`, `PapyrusUtilDev.log` and one `<PluginName>.log` per SKSE DLL. All are rewritten on each launch.

## 5. Prior-art MCP servers

- **houseCARL** (Avick3110): https://github.com/Avick3110/houseCARL , Nexus https://www.nexusmods.com/skyrimspecialedition/mods/181738
  - C# .NET 9, stdio, Windows x64, **GPL-3.0-only** (because of Mutagen). 44 stars, ~3,976 commits, README at 2.0.0, 2026 activity; no tagged releases.
  - 31 `housecarl_*` tools: records, check, apply, create, remove, forward, merge/compact plugin, NIF inspect/set, Papyrus compile/decompile, BSA list/extract/repack, SKSE and SkyPatcher layers, `nexus_search/mod/graphql/check_updates/identify` (no API key), `set_mo2_instance`, `load_order_status`.
  - Reads MO2 `modlist/plugins/loadorder.txt` directly, checks freshness per call, and reads "MO2's VFS conflict chain". MO2 need not run. Requires Claude Code ≥ 2.1.143.
  - It is the closest prior art for plugin-record work.
- **ModWrench** (171county): https://github.com/171county/modwrench , npm `@modwrench/cli` 0.2.4 (first published 2026-06-09, last 2026-09-17)
  - **TypeScript/Node, MIT**. 53 tools, 52 read-only.
  - Nexus integration (15 tools: search, changelogs, files, trending/updated, archive preview, **md5 reverse lookup**, endorse). The user's personal key is stored in the OS credential manager. The README explicitly flags that Nexus's AUP treats personal keys in third-party tools as tolerated, and that the app is unregistered.
  - Also mod.io, Thunderstore, and a "Workbench" that reads MO2/Vortex/r2modman load order, parses crash logs, checks LOOT-masterlist conflicts and SKSE patch-day survival, and runs "Doctors" (setup checks: MO2 location, missing masters, overwrite clutter, two crash loggers).
  - Uses MCP Apps UI pages. The closest prior art to this project's scope.
- **nexus-mcp** (fr1pp): https://github.com/fr1pp/nexus-mcp (Glama https://glama.ai/mcp/servers/kwa426ze1c)
  - JavaScript, read-only, GraphQL v2, works anonymously (optional key).
  - Tools: `search_games`, `search_mods`, `get_mod`, `get_mod_files`, `search_collections`, `get_collection`, `get_user`, `run_graphql`.
  - Licence not stated; Glama marks maintenance as "Slowing".
  - Note: the npm name `nexus-mcp` belongs to an unrelated OpenRouter project.
- **SehtMCP** (tel-0s): https://github.com/tel-0s/SehtMCP . C# .NET 10, GPL-3.0-only (Mutagen), 0.3.0 dev release, 4 commits, 2 stars. 52 tools for plugin authoring and validation, navmesh generation, NIF inspection, and `mo2_profile_inspect`.
- **SkyrimCK-MCP** (Pyrhame): https://github.com/Pyrhame/SkyrimCK-MCP . C# .NET 8 on esper, **MIT**, alpha, 1 commit. ESP read/write aimed at blind modders.
- **chim** (mojibake-dev): https://github.com/mojibake-dev/chim . Python 3.11, **MIT**, early (5 commits). Byte-level ESP/ESM/ESL and .ess editing, Papyrus compile, save cleaning.
- **houseCARL-Linux**: GPL-3.0 fork adding Amethyst Mod Manager. https://github.com/justinmosley-hub/houseCARL-Linux
- Official MCP registry (`registry.modelcontextprotocol.io/v0/servers?search=`): **no** hits for skyrim, nexus mods, mod-organizer, bethesda, xedit or mutagen (2026-10-15).
- npm search found only `@modwrench/*`. PyPI was not searched systematically (**UNVERIFIED**).
- No MCP server bridging live MO2 state (a Python plugin) was found.

## 6. VS Code integration

- An extension contributes `contributes.mcpServerDefinitionProviders` (`id`, `label`) in package.json and calls `vscode.lm.registerMcpServerDefinitionProvider(id, provider)`. The provider has:
  - `provideMcpServerDefinitions()` → `McpStdioServerDefinition` (command/args/env) or `McpHttpServerDefinition` (Streamable HTTP);
  - `onDidChangeMcpServerDefinitions`;
  - `resolveMcpServerDefinition()`, which runs before start; returning undefined or throwing stops the start.
  - Guide last updated 2026-10-14: https://code.visualstudio.com/api/extension-guides/ai/mcp
- Status: it shipped as an "MCP extension API" in **VS Code 1.101 (May 2025)**, and the types are in stable `vscode.d.ts` (not a proposed API). An extension therefore needs `engines.vscode >= 1.101.0`. https://code.visualstudio.com/updates/v1_101 , https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts
- Servers registered this way are consumed by VS Code's own chat (agent mode, tools picker). (MCP guide)
- Claude Code's VS Code extension (needs VS Code ≥ 1.94):
  - uses Claude Code's own MCP config: `~/.claude.json` (local/user scopes), project `.mcp.json`, plugin-provided servers, managed settings, claude.ai connectors;
  - managed via `/mcp` in the chat panel or `claude mcp add`.
  - Its docs **do not mention** VS Code `mcpServerDefinitionProviders` or VS Code's own `mcp.json`. That Claude Code ignores them is therefore **UNVERIFIED but undocumented**.
  - The extension runs a hidden built-in `ide` MCP server (`mcp__ide__getDiagnostics`, `mcp__ide__executeCode`).
  - Sources: https://code.claude.com/docs/en/vs-code , https://code.claude.com/docs/en/mcp
- To ship to Claude Code, the documented paths are `.mcp.json` / `claude mcp add`, or a Claude Code plugin (`.mcp.json` at plugin root, `${CLAUDE_PLUGIN_ROOT}`). (code.claude.com/docs/en/mcp)
- Existing VS Code extensions for Skyrim modding (Marketplace query, 2026-10-15):
  - `joelday.papyrus-lang-vscode` "Papyrus": v2026.1014.13, updated 2026-10-14, ~31k installs. Language server, linting, PPJ build tasks, debugger for SSE/FO4. https://github.com/joelday/papyrus-lang
  - `Dylbill.skyrim-script-compiler` (v0.0.9, 2025-05)
  - `Idrinth.papyrus-lint-vscode` (v3.2.0, 2026-10)
  - `MrTrilB.papyrus-tools` (2025-10)
  - `thmsn.papyrus-formatter` (2025-10)
  - older: `Scrivener07.papyrus` (2018), `anwar.papyrus-language-support` (2023)
  - No ESP/ESM plugin viewer extension was found on the Marketplace.
  - (Marketplace gallery API `extensionquery`; many "skyrim" hits are spam listings.)
