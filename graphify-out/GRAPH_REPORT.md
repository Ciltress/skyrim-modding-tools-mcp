# Graph Report - skyrim-modding-tools-mcp  (2026-10-20)

## Corpus Check
- 129 files · ~189,284 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .example 1)

## Summary
- 1893 nodes · 4724 edges · 94 communities (84 shown, 10 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 237 edges (avg confidence: 0.85)
- Token cost: 789,945 input · 0 output

## Community Hubs (Navigation)
- Helper Session and Commands
- Backend Fakes and Result Types
- C# Helper Source Files
- Record Files and Links
- Project Build and Patch
- npm Package Manifest
- Nexus MO2 Crash-Log Research
- Ollama Eval Harness
- Nexus Catalogue and Downloads
- Platform and External Tools
- Server and Transport Tests
- Nexus Mod Reading
- HTTP Transport and Env
- Tool Handler Modules
- Domain Modeling Skills
- Setup Registration
- Mutagen Helper and License ADRs
- Instance and Plugin Resolution
- Record Index and FormKeys
- Tool Docs and Capability Gate
- Helper Client and Engine
- Effect Casting Analysis
- Linux MO2 Proton Research
- Mod List Parsing Tests
- Skills Discovery and Handlers
- Handler Registry
- Plugin and Load-Order Vocabulary
- SKSE Plugin Checks
- Game Versions Skill
- Setup Entry Point
- MO2 Profile Management
- Server Guides
- Tool-Count and Eval ADRs
- Engines and Local Environment
- Mod Install Metadata
- Installer Tests and FOMOD Types
- System Setup Installers
- Profiles, Budget and Evals Docs
- Engines and Tooling Research
- Modding Tool Landscape
- NPC Skill
- Amethyst and Proton Tests
- Mod List and Disabling
- Server Info and Entry
- Amethyst Manager
- AppServer Core
- Tool Profiles
- Operational Tools Docs
- Text Project Workflow ADRs
- Plugin and FormID Basics
- MO2 Instance Reading
- FOMOD XML Parsing
- Game Version Check
- Papyrus Compiler Research
- Early Local Model Evals
- Amethyst Linux Research
- Eval Round 21 (OpenClaw)
- Path Settings
- Skyrim Engine Connection
- MO2 Refresh and Overwrite
- Filesystem Paths and Compiler
- Skill Record Examples
- Backend Factory and Config
- Mod Installation
- CI and Smoke Tests
- ModManager Interface
- SkyrimBackend Interface
- Response Budget
- TypeScript Config
- Nexus Publishing Research
- OpenClaw Eval Harness
- Leveled Lists Skill
- Mo2Manager Implementation
- FOMOD Installer Logic
- Handler Contract Tests
- Hosting Configuration
- Project Documentation Index
- Nexus Tools and Gating
- Helper Project Dependencies
- Eval Server Calls
- Eval YAML Checks
- MCP Server Manifest
- Install Load-Order Placement
- OS and Mod-Manager Seams
- Helper Check Script
- Authoring Workflow Tools
- Project Notes (Voice Types)
- SKSE Plugin PE Reader
- Eval Task Runner
- Self-Documenting Server
- Game Downgrade and SKSE
- Instance Binding Vocabulary
- OpenClaw Proxy
- Host and Origin Allow-Lists

## God Nodes (most connected - your core abstractions)
1. `Session` - 41 edges
2. `Instance` - 38 edges
3. `SkyrimInstanceBackend` - 37 edges
4. `RecordFiles` - 33 edges
5. `RecordIndex` - 31 edges
6. `AppServer` - 31 edges
7. `Research: Linux, MO2 under Proton, Platform, Local Models` - 29 edges
8. `InMemorySkyrimBackend` - 28 edges
9. `BaseHandler` - 28 edges
10. `Research: Nexus, MO2, Crash Logs, Prior Art` - 28 edges

## Surprising Connections (you probably didn't know these)
- `Write paths run against a real backend once` --semantically_similar_to--> `CI smoke test step`  [INFERRED] [semantically similar]
  AGENTS.md → .github/workflows/ci.yml
- `Words that lead people astray` --semantically_similar_to--> `CONTEXT.md (domain vocabulary)`  [INFERRED] [semantically similar]
  docs/Tool-Router.md → CONTEXT.md
- `Per-session rate limit (token bucket)` --semantically_similar_to--> `Response budget`  [INFERRED] [semantically similar]
  docs/Hosting.md → CONTEXT.md
- `Skill discovery (no rebuild, cached per process)` --references--> `discoverSkills()`  [EXTRACTED]
  skills/README.md → src/lib/skills.ts
- `Docs and skills served to clients at runtime` --semantically_similar_to--> `Server documents itself (resources and tools)`  [INFERRED] [semantically similar]
  AGENTS.md → docs/MCP-Tools.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Golden path: patch another mod's records (addPatch, buildProject, deployProject)** — docs_tool_reference_addpatch, docs_tool_reference_buildproject, docs_tool_reference_deployproject [EXTRACTED 1.00]
- **Golden path: find a mod on Nexus, check it, install it** — docs_tool_reference_searchnexus, docs_tool_reference_readnexusmod, docs_tool_reference_downloadnexusfile, docs_tool_reference_installmod [EXTRACTED 1.00]
- **Gates in front of an HTTP session (origin, host, rate limit, credential)** — docs_hosting_origin_allow_list, docs_hosting_host_allow_list, docs_hosting_rate_limit, docs_hosting_bearer_token_per_session [EXTRACTED 1.00]
- **Text project lifecycle: build, deploy, pull refereed by git** — docs_adr_0004_mods_are_authored_as_text_projects_text_project, docs_adr_0004_mods_are_authored_as_text_projects_build, docs_adr_0004_mods_are_authored_as_text_projects_deploy, docs_adr_0004_mods_are_authored_as_text_projects_pull, docs_adr_0004_mods_are_authored_as_text_projects_git_as_referee [EXTRACTED 1.00]
- **GPL-3.0 modding ecosystem the project builds on** — docs_adr_0006_gpl_3_gpl_3_license, docs_adr_0003_plugins_through_a_mutagen_helper_mutagen, docs_research_2026_10_15_spriggit_embedding_spike_spriggit, docs_adr_0006_gpl_3_loot, docs_adr_0006_gpl_3_synthesis [EXTRACTED 1.00]
- **Helper's embedded Spriggit text-format stack** — docs_adr_0003_plugins_through_a_mutagen_helper_mutagen_helper, docs_research_2026_10_15_spriggit_embedding_spike_serialization_source_generator, docs_research_2026_10_15_spriggit_embedding_spike_mutagenyamlconverter, docs_research_2026_10_15_spriggit_embedding_spike_spriggit_customization, docs_research_2026_10_15_spriggit_embedding_spike_version_pins [EXTRACTED 1.00]
- **Papyrus Compiler Alternatives (CK, Caprica, papyrus-lang, russo)** — docs_research_2026_10_15_engines_and_tooling_papyrus_compiler, docs_research_2026_10_15_engines_and_tooling_caprica, docs_research_2026_10_15_engines_and_tooling_papyrus_lang, docs_research_2026_10_15_engines_and_tooling_russo_papyrus_compiler, docs_research_2026_10_15_linux_mo2_and_platform_ck_papyrus_compiler_linux, docs_research_2026_10_15_linux_mo2_and_platform_papyrusc, docs_research_2026_10_15_linux_mo2_and_platform_russo_papyrus_compiler [INFERRED 0.85]
- **Mod-Manager Bindings Sharing One Shape (MO2, MO2 under Proton, Amethyst)** — docs_research_2026_10_15_linux_mo2_and_platform_three_bindings, docs_research_2026_10_15_linux_mo2_and_platform_amethyst_mod_manager, docs_research_2026_10_15_linux_mo2_and_platform_amethyst_modlist, docs_research_2026_10_15_linux_mo2_and_platform_mo2_lint, docs_research_2026_10_15_linux_mo2_and_platform_mo2_ini_path_encoding, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_mo2_modlist_txt, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_mo2_plugins_txt [INFERRED 0.85]
- **Prior-Art Skyrim and Nexus MCP Servers** — docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_housecarl, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_modwrench, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_nexus_mcp, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_sehtmcp, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_skyrimck_mcp, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_chim, docs_research_2026_10_15_nexus_mo2_crashlogs_prior_art_housecarl_linux [EXTRACTED 1.00]
- **Record-family skills extend the basics authoring loop** — skills_domain_skills_skyrim_modding_basics_skill_authoring_workflow, skills_domain_skills_skyrim_modding_items_and_crafting_skill, skills_domain_skills_skyrim_modding_magic_skill, skills_domain_skills_skyrim_modding_npcs_skill, skills_domain_skills_skyrim_modding_leveled_lists_skill [EXTRACTED 1.00]
- **Symptom-to-cause diagnosis tables across record families** — skills_domain_skills_skyrim_modding_basics_reference_where_errors_show_up, skills_domain_skills_skyrim_modding_items_and_crafting_reference_typical_bugs, skills_domain_skills_skyrim_modding_magic_reference_typical_bugs, skills_domain_skills_skyrim_modding_npcs_reference_typical_bugs, skills_domain_skills_skyrim_modding_leveled_lists_reference_typical_bugs [INFERRED 0.75]
- **Strategies for avoiding record conflicts under the rule of one** — skills_domain_skills_skyrim_modding_basics_reference_patch, skills_domain_skills_skyrim_modding_basics_reference_merged_patch, skills_domain_skills_skyrim_modding_basics_reference_distribution_frameworks, skills_domain_skills_skyrim_modding_leveled_lists_reference_list_fixes, skills_domain_skills_skyrim_modding_npcs_reference_distribution_instead_of_edits [INFERRED 0.85]

## Communities (94 total, 10 thin omitted)

### Community 0 - "Helper Session and Commands"
Cohesion: 0.11
Nodes (7): Archives, HelperException, Code, LoadedPlugin, Session, Cache, Index

### Community 1 - "Backend Fakes and Result Types"
Cohesion: 0.07
Nodes (29): InstallerQuestions, ProfileChange, GameVersionCheck, AddPatchRequest, AddPatchResult, BuildResult, DeployResult, InstallModQuestions (+21 more)

### Community 2 - "C# Helper Source Files"
Cohesion: 0.07
Nodes (3): SkyrimHelper, PeVersion, Customization

### Community 3 - "Record Files and Links"
Cohesion: 0.12
Nodes (4): RecordFiles, RecordLinks, Replacement, Target

### Community 4 - "Project Build and Patch"
Cohesion: 0.12
Nodes (40): HelperError, assignFormIds(), belongsAt(), CopiedEscape, copiedEscapes(), createProject(), DeployState, editorIdOf() (+32 more)

### Community 5 - "npm Package Manifest"
Cohesion: 0.05
Nodes (39): author, bin, skyrim-modding-tools-mcp, dependencies, dotenv, @modelcontextprotocol/sdk, description, devDependencies (+31 more)

### Community 6 - "Nexus MO2 Crash-Log Research"
Cohesion: 0.09
Nodes (38): Research: Nexus, MO2, Crash Logs, Prior Art, chim, Claude Code VS Code Extension MCP Config, Crash Log Section Structure, Crash Logger SSE, houseCARL, houseCARL-Linux, Log Parsing Manager (CC BY-NC-ND) (+30 more)

### Community 7 - "Ollama Eval Harness"
Cohesion: 0.05
Nodes (29): allTurns, client, entry, FILE_TOOLS, fileToolNames, laterTurns, logStream, MAX_TURNS (+21 more)

### Community 8 - "Nexus Catalogue and Downloads"
Cohesion: 0.10
Nodes (12): NexusCatalogue, NexusError, safeFileName(), NexusAccount, NexusDownload, matchesAny(), SkyrimInstanceBackend, fakeNexus() (+4 more)

### Community 9 - "Platform and External Tools"
Cohesion: 0.09
Nodes (21): EngineOptions, CompileOptions, CompilerUnavailableError, compileScripts(), hasUncommittedChanges(), MOD_SOURCE_FOLDERS, papyrusCommand(), run (+13 more)

### Community 10 - "Server and Transport Tests"
Cohesion: 0.09
Nodes (19): vitest, Backend, HealthReport, PermanentBackendError, PROFILES, fakeBackend(), FakeBackendOptions, ACCEPTED (+11 more)

### Community 11 - "Nexus Mod Reading"
Cohesion: 0.11
Nodes (23): bbcodeToText(), CURRENT_FILES, cutAtLine(), DownloadMeta, ENTITIES, fileInfo(), FileNode, FullModNode (+15 more)

### Community 12 - "HTTP Transport and Env"
Cohesion: 0.14
Nodes (20): parseList(), CORS_EXPOSED_HEADERS, CORS_REQUEST_HEADERS, createRateLimiter(), extractBearerToken(), hostAllowed(), MAX_HTTP_BODY_BYTES, normalizeOrigin() (+12 more)

### Community 13 - "Tool Handler Modules"
Cohesion: 0.21
Nodes (19): @modelcontextprotocol/sdk, asRequestError(), coerceArgs(), fromText(), limitArg(), offsetArg(), optionalBoolean(), optionalChoice() (+11 more)

### Community 14 - "Domain Modeling Skills"
Cohesion: 0.14
Nodes (28): skyrim-modding-basics skill, findRecords tool, readRecord tool, Items and crafting - reference, Armor and armor addons (ARMA chosen by wearer's race), Biped slots, Constructible object (COBJ) recipes and workbench keywords, Item record types (WEAP, ARMO, ARMA, AMMO, ALCH, INGR, BOOK, MISC, COBJ) (+20 more)

### Community 15 - "Setup Registration"
Cohesion: 0.14
Nodes (22): dotenv, FAMILY_SKILLS, envValue(), setEnvValues(), describeProgram(), ENTRY, ENV_FILE, helper() (+14 more)

### Community 16 - "Mutagen Helper and License ADRs"
Cohesion: 0.11
Nodes (21): ADR-0003: Plugins read and written by a Mutagen helper, .NET runtime (not SDK) requirement, Mutagen, Mutagen C# helper over stdio, ADR-0006: The project is GPL-3.0, not MIT, houseCARL, LOOT, MIT template the server started from (+13 more)

### Community 17 - "Instance and Plugin Resolution"
Cohesion: 0.13
Nodes (8): AmethystManager, readJson(), safeList(), sameFile(), stamp(), Instance, PluginEntry, findCaseInsensitive()

### Community 18 - "Record Index and FormKeys"
Cohesion: 0.12
Nodes (11): Entry, EditorId, FormKey, GetterType, Name, Plugins, Signature, Type (+3 more)

### Community 19 - "Tool Docs and Capability Gate"
Cohesion: 0.13
Nodes (19): evaluateGate(), GATED_FEATURES, GatedFeature, GateResult, gatingEnabled(), PROJECT_ROOT, cell(), collectToolFamilies() (+11 more)

### Community 20 - "Helper Client and Engine"
Cohesion: 0.12
Nodes (14): Plugin helper (C# .NET process on Mutagen), The server (TypeScript, src/), Backend seam (AppBackend, createBackend), Engine (helper owner, load order kept in step), Mutagen (plugin library), Spriggit text format, SessionExpiredError, HelperClient (+6 more)

### Community 22 - "Linux MO2 Proton Research"
Cohesion: 0.14
Nodes (23): Research: Linux, MO2 under Proton, Platform, Local Models, Amethyst Stub MO2 Instances, CachyOS Default btrfs (no casefold), Case-Alias Symlinks, CI on ubuntu-latest (helper linux-x64 publish), Docker Option, dosdevices Drive-Letter Mapping, Fluorine Manager (+15 more)

### Community 23 - "Mod List Parsing Tests"
Cohesion: 0.13
Nodes (18): HelperMissingError, parseModList(), readModList(), asWinePath(), COOL_MOD, FOMOD_MOD, game(), hostDrives() (+10 more)

### Community 24 - "Skills Discovery and Handlers"
Cohesion: 0.21
Nodes (17): SkillsHandlers, discoverSkills(), findSkill(), parseFrontmatter(), readSkillFile(), resolveSkill(), Skill, SKILL_URI_PREFIX (+9 more)

### Community 25 - "Handler Registry"
Cohesion: 0.15
Nodes (10): AppBackend, BaseHandler, createHandlers(), ModsHandlers, NexusHandlers, ProjectsHandlers, RecordsHandlers, allTools (+2 more)

### Community 26 - "Plugin and Load-Order Vocabulary"
Cohesion: 0.14
Nodes (23): Build, Conflict, Deploy, FormID, Light plugin (ESL flag), Link (record field pointing at a FormID), Load order, Master (+15 more)

### Community 27 - "SKSE Plugin Checks"
Cohesion: 0.13
Nodes (21): addressLibraryFile(), BEFORE_V5, GameInput, GameProblem, judgeGame(), predict(), Prediction, R16 (+13 more)

### Community 28 - "Game Versions Skill"
Cohesion: 0.21
Nodes (21): Game versions and SKSE (1.5.97 to 1.7.104), downloadNexusFile tool, Installing someone else's mod (check, get file, install), installMod tool, listMods tool, readNexusMod tool, searchNexus tool, Address Library (+13 more)

### Community 29 - "Setup Entry Point"
Cohesion: 0.22
Nodes (18): chooseModManager(), createModManager(), readConfiguration(), currentPlatform(), askInstance(), compiler(), currentEnv(), display() (+10 more)

### Community 30 - "MO2 Profile Management"
Cohesion: 0.20
Nodes (17): canonical(), IniPaths, Mo2Options, activatePlugins(), disableMod(), enableMod(), readLines(), refreshIfRunning() (+9 more)

### Community 31 - "Server Guides"
Cohesion: 0.23
Nodes (15): Extending the server (tool, family, guide, skill, rename), DocsHandlers, extractSection(), GUIDE_URI_PREFIX, guideById(), guideByUri(), GuideDefinition, guideIndex() (+7 more)

### Community 32 - "Tool-Count and Eval ADRs"
Cohesion: 0.11
Nodes (15): ADR-0001: The tool count is a cost, not a goal, Small local model (128k window) as design target, Tool profiles, Tool schema token cost per turn, ADR-0002: Composite tools where the protocol is the hard part, Composite tool, Lock-write-activate-unlock edit cycle, Instance (any manager's setup for Skyrim) (+7 more)

### Community 33 - "Engines and Local Environment"
Cohesion: 0.12
Nodes (21): Local .NET Runtimes (no SDK installed), esplugin (Rust), Plugin Header HEDR 1.71 / Form Version 44, JS/TS ESP Libraries (none maintained), libloadorder (Rust), Local Environment Observed (Steam 1.7.104, LoreRim 1.6.1170), LOOT, loot-condition-interpreter (+13 more)

### Community 34 - "Mod Install Metadata"
Cohesion: 0.10
Nodes (21): CHOOSE, compareVersions(), cut(), DATA_FOLDERS, Flags, FomodCondition, FomodGroup, FomodLeaf (+13 more)

### Community 35 - "Installer Tests and FOMOD Types"
Cohesion: 0.10
Nodes (11): ArchiveListing, FileState, FomodConfig, FomodFile, FomodOption, InstallEnvironment, file(), folder() (+3 more)

### Community 36 - "System Setup Installers"
Cohesion: 0.13
Nodes (12): Run, installCommand(), linuxSetup(), PackageManager, PACKAGES, Prerequisite, RunningProgram, RunResult (+4 more)

### Community 37 - "Profiles, Budget and Evals Docs"
Cohesion: 0.14
Nodes (16): Client tier, Cold session, Feature (optional backend capability), First-try success, Gating, Response budget, Tool profile (MCP_PROFILE), Local models through Ollama (+8 more)

### Community 38 - "Engines and Tooling Research"
Cohesion: 0.13
Nodes (16): Research: Engines and Tooling, ba2 Crate (BSA reader/writer), BSA v105 Archive Format, Champollion Decompiler, FormKey Notation (local ID:origin plugin), houseCARL, libloot, libloot-nodejs Wrapper (experimental) (+8 more)

### Community 39 - "Modding Tool Landscape"
Cohesion: 0.16
Nodes (18): Distribution frameworks (SPID, KID, SkyPatcher), Load order (plugins.txt), Mod order, files and archives (virtual Data, overwrite, profiles), Mod order decides files, load order decides records, The modding tool landscape (TOOLS.md), Amethyst Mod Manager (Linux), Creation Kit (CK), EasyNPC (+10 more)

### Community 40 - "NPC Skill"
Cohesion: 0.15
Nodes (19): Papyrus scripts and saves, ReSaver, Leveled list types (LVLI, LVLN, LVSP), Script effects (ActiveMagicEffect), NPCs - reference, AI packages, Factions (membership, relations, crime, vendors), Followers (vanilla follower recipe) (+11 more)

### Community 41 - "Amethyst and Proton Tests"
Cohesion: 0.15
Nodes (14): AmethystOptions, linuxPlatform(), makeBackend(), makeSetup(), manager(), roots, scriptedHelper(), VANILLA (+6 more)

### Community 42 - "Mod List and Disabling"
Cohesion: 0.17
Nodes (14): findMod(), listedMods(), ModError, ownerOf(), plugin(), pluginFiles(), samePath(), DisableModRequest (+6 more)

### Community 43 - "Server Info and Entry"
Cohesion: 0.13
Nodes (11): stdio transport, REQUIRED_ENV, HERE, packageJson, RESOURCE_SCHEME, SERVER_INFO, ServerDependencies, declaredNames (+3 more)

### Community 44 - "Amethyst Manager"
Cohesion: 0.18
Nodes (15): Mod manager, amethystHasSkyrim(), amethystRunning(), AmethystSetup, amethystSockets(), configFolders(), connects(), defaultRun() (+7 more)

### Community 45 - "AppServer Core"
Cohesion: 0.22
Nodes (3): isPermanent(), AppServer, withTimeout()

### Community 46 - "Tool Profiles"
Cohesion: 0.15
Nodes (15): ANALYSIS, applyProfile(), CORE_WRITE, DEFAULT_PROFILE, GUIDANCE, INSTALLED, MOD_WRITE, NEXUS_READ (+7 more)

### Community 47 - "Operational Tools Docs"
Cohesion: 0.15
Nodes (16): Pull, Linux setup with Amethyst, OpenClaw registration (skills, agent, workspace), Tool annotations (readOnly, destructive, idempotent, openWorld), Golden paths (copy-pasteable workflows), healthcheck tool, Troubleshooting matrix, checkGameVersion (+8 more)

### Community 48 - "Text Project Workflow ADRs"
Cohesion: 0.14
Nodes (13): ADR-0004: A mod is authored as a text project, not as a plugin, Build step: assigns permanent FormIDs, Deploy step: refuses to overwrite a changed plugin, FormID written against its defining plugin (087835:Skyrim.esm), Pull step: brings external edits back into the text, Text project (one text file per record, in git), ADR-0005: The Creation Kit is used only through its command line, Creation Kit command-line switches (-GenerateLips, -ConvertToESL) (+5 more)

### Community 49 - "Plugin and FormID Basics"
Cohesion: 0.17
Nodes (17): Skyrim modding basics - reference, Base records and references (REFR/ACHR), Editor ID, FormID / FormKey (defining plugin + local number), New record FormIDs assigned by buildProject (from 000800), Plugin header version 1.70 / 1.71, ITM, UDR and dirty plugins, Light plugin (ESL flag, FE slot, 4,096 records) (+9 more)

### Community 50 - "MO2 Instance Reading"
Cohesion: 0.18
Nodes (16): activeInPluginsTxt(), BASE_MASTERS, decodeQtValue(), listLines(), loadOrderFingerprint(), Mo2LintInstance, mo2LintPrefix(), parseIni() (+8 more)

### Community 52 - "Game Version Check"
Cohesion: 0.19
Nodes (12): checkGameVersion(), GameVersionUnknownError, modifiedAt(), MY_GAMES, SKSE_FILES, skseInGame(), skseLog(), hasSksePlugins() (+4 more)

### Community 53 - "Papyrus Compiler Research"
Cohesion: 0.16
Nodes (15): Caprica, Creation Kit Command-Line Switches, Creation Kit Downgrade Patcher (1.7.99), CK Standalone Tools (LipGenerator, LIPFuzer, Archive), Creation Kit Platform Extended (CKPE), Creation Kit (SSE), PapyrusCompiler.exe (SSE), TESV_Papyrus_Flags.flg (+7 more)

### Community 54 - "Early Local Model Evals"
Cohesion: 0.14
Nodes (13): Claude Code Behind Ollama (tool search off, 4,096-char cut), core Tool Profile, Local Model Eval Rounds 1-2 (gemma4:26b, qwen2.5-coder:3b), gemma4:26b Speed on RTX 5080, gemma4 Tool-Call Parsing Issues, MCP Clients for Ollama Models, Ollama Anthropic-Compatible /v1/messages, Ollama Tool-Calling API (+5 more)

### Community 55 - "Amethyst Linux Research"
Cohesion: 0.18
Nodes (13): amethyst-mod-manager-cli, Amethyst Hardlink Deploy (Data_Core), Amethyst deploy_state.json, Amethyst filegraph Catalog (Rust), Amethyst IPC Socket (nxm links only), Amethyst Mod Manager, Amethyst modlist.txt (MO2 format, * = locked), Amethyst paths.json (+5 more)

### Community 56 - "Eval Round 21 (OpenClaw)"
Cohesion: 0.19
Nodes (14): addPatch misused to make new records, AGENTS.md workspace file carrying server instructions, Backslash at a line end refused as a copied escape, built_with_warnings build answer, warnings first, gemma4:12b, gemma4:26b, gemma4:e4b, OpenClaw as the eval client (+6 more)

### Community 57 - "Path Settings"
Cohesion: 0.23
Nodes (13): AMETHYST_FLATPAK_ID, closingBrace(), expandBraced(), expandWord(), PATH_SETTINGS, pathSetting, readPathSettings(), required() (+5 more)

### Community 58 - "Skyrim Engine Connection"
Cohesion: 0.17
Nodes (3): SkyrimEngine, HelperTransport, SkyrimInstanceBackendOptions

### Community 59 - "MO2 Refresh and Overwrite"
Cohesion: 0.16
Nodes (13): Mod Organizer overwrite-folder copy guard, Amethyst mod manager, MO2 under Proton: path mapping and refused deploy, Mod Organizer 2 (MO2), Proton, DelayedFileWriter 200 ms pending window, MOMultiProcess: one primary MO2, commands forwarded, MO2 does not watch profile files (+5 more)

### Community 60 - "Filesystem Paths and Compiler"
Cohesion: 0.17
Nodes (8): rendered, root, size, target, checksumMatches(), downloadCompiler(), PAPYRUS_COMPILER, skyrimInstances()

### Community 61 - "Skill Record Examples"
Cohesion: 0.18
Nodes (11): Editor-ID links resolved by the build (resolvedLinks), readSkill tool, Books and notes table (BookText block), New weapon example (AshenHatchet + RecipeAshenHatchet), Weapon kind table (mirror, AnimationType, keyword, ImpactDataSet), Where a new record goes (vanilla loot and blacksmith lists table), Destruction damage spell table (fire, frost, shock), New spell example (MendingLight + SpellTomeMendingLight) (+3 more)

### Community 62 - "Backend Factory and Config"
Cohesion: 0.18
Nodes (13): BackendOptions, Configuration, createBackend(), DEFAULT_PROJECTS_DIR, defaultHelperPath(), explainMissingEnv(), missingEnv(), MOD_MANAGERS (+5 more)

### Community 63 - "Mod Installation"
Cohesion: 0.18
Nodes (12): checkRoot(), defaultModName(), folderName(), InstallError, plainLayout(), PluginHeader, pluginOrder(), topFolders() (+4 more)

### Community 64 - "CI and Smoke Tests"
Cohesion: 0.14
Nodes (9): CI build job (build, smoke, helper), CI helper build and check, CI smoke test step, Test instance (portable MO2 on a clean game, or throwaway Amethyst profile), child, exited, failures, responses (+1 more)

### Community 67 - "Response Budget"
Cohesion: 0.27
Nodes (10): CappedResult, capToolResult(), GENERIC_NARROWING_HINT, narrowingHint(), PROFILE_RESPONSE_BUDGETS, resolveResponseBudget(), ResponseBudgetError, toolResultBytes() (+2 more)

### Community 68 - "TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir, skipLibCheck (+5 more)

### Community 69 - "Nexus Publishing Research"
Cohesion: 0.18
Nodes (11): Research: Nexus publishing API and MO2 refresh semantics, apikey header auth (personal key), BUTR.NexusUploader, Digitalroot.ModUploader, Mod file version metadata (name, version, file_category), Nexus Mods Upload API (v3), Mod pages cannot be created through the API, PHLemp/nexus-mods-mcp (+3 more)

### Community 70 - "OpenClaw Eval Harness"
Cohesion: 0.19
Nodes (11): callRecord(), DENIED_TOOLS, killTree(), NOT_ALLOWED, openClawConfigFile(), openClawEntry(), openClawVersion(), runOpenClaw() (+3 more)

### Community 71 - "Leveled Lists Skill"
Cohesion: 0.22
Nodes (12): Merged patches (Bashed Patch, Merged Patch, Synthesis), Where errors show up (symptom to log table), Crash Logger SSE, Synthesis (Mutagen patcher runner), Wrye Bash (Bashed Patch), xEdit (SSEEdit) and SSEDump, Leveled lists - reference, ChanceNone written as a fraction in project text (+4 more)

### Community 74 - "Handler Contract Tests"
Cohesion: 0.23
Nodes (11): SAMPLE, asText(), cases(), catalogue, FAILURE_IN_PAYLOAD, handlersFrom(), NO_BACKEND_CALL_EXPECTED, outcome() (+3 more)

### Community 75 - "Hosting Configuration"
Cohesion: 0.20
Nodes (11): CI test job (unit and type tests), Per-session bearer token (SKYRIM_ACCEPTED_TOKENS), Mod Organizer under Proton (experimental), Path settings read as a POSIX shell would, Session bound to its token, Streamable HTTP transport (/mcp), TLS terminated in front of the server, Wine prefix drive resolution (SKYRIM_WINE_PREFIX) (+3 more)

### Community 76 - "Project Documentation Index"
Cohesion: 0.42
Nodes (9): AGENTS.md (guidance for agents working on the repo), CONTEXT.md (domain vocabulary), Router (intent vocabulary), Tool, Tool family, Hosting guide (stdio and Streamable HTTP), How this server behaves (MCP-Tools guide), Tool reference (generated) (+1 more)

### Community 77 - "Nexus Tools and Gating"
Cohesion: 0.25
Nodes (10): Downloaded file, FOMOD installer, Nexus file, Nexus mod, downloadNexusFile, installMod, listMods, readNexusMod (+2 more)

### Community 78 - "Helper Project Dependencies"
Cohesion: 0.20
Nodes (9): net10.0, Mutagen.Bethesda.Core ([0.54.0]), Mutagen.Bethesda.Serialization ([1.38.6]), Mutagen.Bethesda.Serialization.SourceGenerator ([1.38.6]), Mutagen.Bethesda.Serialization.Yaml ([1.38.6]), Mutagen.Bethesda.Skyrim ([0.54.0]), Noggog.CSharpExt ([4.3.0]), SharpCompress ([0.50.4]) (+1 more)

### Community 79 - "Eval Server Calls"
Cohesion: 0.20
Nodes (10): callServer(), callServerJson(), effectsOf(), effectTexts(), fail(), newRecords(), projectRecords(), recordAnywhere() (+2 more)

### Community 80 - "Eval YAML Checks"
Cohesion: 0.28
Nodes (8): builtProject(), filesUnder(), leftEscapes(), recordText(), resultOf(), leftEscape(), scalarValue(), translatedValue()

### Community 81 - "MCP Server Manifest"
Cohesion: 0.22
Nodes (8): description, name, packages, repository, source, url, $schema, version

### Community 82 - "Install Load-Order Placement"
Cohesion: 0.25
Nodes (7): canonicalFolders(), findDataRoot(), join(), normalize(), ordered(), placeInLoadOrder(), trimmedNames()

### Community 83 - "OS and Mod-Manager Seams"
Cohesion: 0.29
Nodes (4): CI workflow (ci.yml), ADR-0007: The operating system and the mod manager are separate seams, Third-party Papyrus compiler on Linux, Platform seam (chosen once in createBackend())

### Community 84 - "Helper Check Script"
Cohesion: 0.25
Nodes (4): child, executable, pending, root

### Community 85 - "Authoring Workflow Tools"
Cohesion: 0.29
Nodes (8): Project folder layout (plugin/, scripts/, assets/, build/), addPatch tool, Authoring workflow (read skill, look up, get text, edit, build, deploy, pull), buildProject tool, deployProject tool, newProject tool, Mod as a project (text in git, one file per record), pullProject tool

### Community 88 - "Eval Task Runner"
Cohesion: 0.29
Nodes (7): callInText(), emptyProjects(), has(), insideProjects(), runFileTool(), runTask(), runTaskOpenClaw()

### Community 89 - "Self-Documenting Server"
Cohesion: 0.53
Nodes (5): Guide, Skill, Server documents itself (resources and tools), readServerGuide, readSkill

### Community 90 - "Game Downgrade and SKSE"
Cohesion: 0.47
Nodes (6): Address Library, SKSE (2.3.1 for 1.7.104), Skyrim SE 1.7.x Update (1.7.99 / 1.7.104), Amethyst SKSE Plugin Compatibility Checker, DepotDownloader, Game Downgrade Routes (download_depot, patchers)

### Community 91 - "Instance Binding Vocabulary"
Cohesion: 0.67
Nodes (4): Backend (AppBackend), Binding (server to one instance), Instance, Profile (mod manager's)

## Knowledge Gaps
- **95 isolated node(s):** `Code`, `FormKey`, `EditorId`, `Name`, `Type` (+90 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 474 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Plugin helper (C# .NET process on Mutagen)` connect `Helper Client and Engine` to `CI and Smoke Tests`, `Mutagen Helper and License ADRs`, `C# Helper Source Files`, `OS and Mod-Manager Seams`?**
  _High betweenness centrality (0.242) - this node is a cross-community bridge._
- **What connects `Code`, `FormKey`, `EditorId` to the rest of the system?**
  _95 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Helper Session and Commands` be split into smaller, more focused modules?**
  _Cohesion score 0.11248185776487664 - nodes in this community are weakly interconnected._
- **Why does `Session` connect `Helper Session and Commands` to `C# Helper Source Files`, `Record Index and FormKeys`, `Effect Casting Analysis`, `Project Notes (Voice Types)`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Should `Backend Fakes and Result Types` be split into smaller, more focused modules?**
  _Cohesion score 0.07474600870827286 - nodes in this community are weakly interconnected._
- **Why does `Research: Linux, MO2 under Proton, Platform, Local Models` connect `Linux MO2 Proton Research` to `Engines and Local Environment`, `Nexus Publishing Research`, `Engines and Tooling Research`, `Hosting Configuration`, `Operational Tools Docs`, `Papyrus Compiler Research`, `Early Local Model Evals`, `Amethyst Linux Research`, `Game Downgrade and SKSE`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Should `C# Helper Source Files` be split into smaller, more focused modules?**
  _Cohesion score 0.07137254901960784 - nodes in this community are weakly interconnected._