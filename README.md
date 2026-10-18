# skyrim-modding-tools-mcp

An MCP server for **Skyrim Special Edition modding** with Mod Organizer 2 on Windows, or Amethyst
Mod Manager on Linux. It lets an AI agent look records up across your whole load order — who defines
a sword, which mods change it, and how — and **author mods and patches as text**: records are YAML
files in a git-versioned project, built into a plugin and deployed into the mod manager. The Creation Kit stays for what only it can do (placing
objects, navmesh); its work is pulled back into the text.

Plugins are read and written by [Mutagen](https://github.com/Mutagen-Modding/Mutagen); the text is
[Spriggit](https://github.com/Mutagen-Modding/Spriggit)'s format.

## What it offers

| Tool | Does |
| --- | --- |
| `findRecords` | Search the active load order by name or editor ID; resolve FormIDs to names and back |
| `readRecord` | One record as project text — the winning version, one plugin's, or every version side by side |
| `newProject` | Start a new mod |
| `addPatch` | Copy existing records into a patch as overrides, from their winning version, to change them without touching the original mod |
| `buildProject` | Text → plugin: assigns FormIDs to new records, checks every reference, compiles Papyrus scripts |
| `deployProject` | Build → Mod Organizer: mod folder, enabled, plugin at the end of the load order |
| `pullProject` | Changes made in the Creation Kit or xEdit → back into the text |
| `searchNexus` | Find Skyrim SE mods on Nexus Mods by name, or list the most endorsed, downloaded or updated — with an API key |
| `readNexusMod` | One Nexus mod page: description, requirements (SKSE, other mods, DLC), the files it offers — with an API key |
| `downloadNexusFile` | A file of a Nexus mod into the instance's downloads folder — with a premium account's API key |
| `installMod` | A downloaded file → a mod: unpacked, its FOMOD installer answered, enabled, its plugins active |
| `disableMod` | A mod disabled, on the user's word: its plugins out of the load order, its files kept — and which plugins now miss a master |
| `listMods` | The mods installed, in priority order: enabled or not, their plugins, their Nexus record, whether they carry SKSE plugins |
| `checkGameVersion` | Whether SKSE, Address Library and each SKSE plugin fit the game version — SKSE's own log of the last start first, then the rules SKSE applies |

Plus `healthcheck`, and the server's own guides (`readServerGuide`) and modding skills (`readSkill`):
how plugins, FormIDs, load order and conflicts work, the community's tools, and one reference per
record family — items and crafting, magic, NPCs, leveled lists.

## Requirements

- **Skyrim Special Edition** 1.5.97 to 1.7.x, managed by **Mod Organizer 2** (2.5) on Windows, or
  **Amethyst Mod Manager** (2.5) on Linux. Mod Organizer under Proton is experimental
  ([`docs/Hosting.md`](docs/Hosting.md) §5).
- **Node.js 24** and **git**. `npm run setup` brings the rest: the .NET 10 SDK, and on Linux a Papyrus
  compiler.
- Optional: **Git LFS**, if you keep your projects in git and they hold meshes or textures — the
  projects folder's `.gitattributes` sends those to it once it is installed. Without it, git keeps them
  as ordinary files.
- For compiling Papyrus scripts (optional otherwise): the **Creation Kit** (free on Steam) for its
  vanilla script sources; on Windows its compiler needs **.NET Framework 3.5** (Windows Features).

## Setup

**Windows**, in PowerShell — the first two lines only for what you do not have yet, then open a new
PowerShell:

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
winget install --exact --id Git.Git
git clone https://github.com/Ciltress/skyrim-modding-tools-mcp
cd skyrim-modding-tools-mcp
npm run setup
```

**Linux** (CachyOS, Arch):

```bash
sudo pacman -S --needed nodejs npm git
git clone https://github.com/Ciltress/skyrim-modding-tools-mcp ~/skyrim-modding-tools-mcp
cd ~/skyrim-modding-tools-mcp
npm run setup
```

`npm run setup` installs the .NET 10 SDK if it is missing, builds the server and its
plugin helper, and finds your mod manager — it asks for the Mod Organizer instance only when it finds
none, and for your Nexus Mods API key if you want the Nexus tools. It registers the server with
Claude Code, Claude Desktop, VS Code and OpenClaw — in OpenClaw with a "Skyrim Modding" agent that has
the modding skills and a workspace telling it how to use the server — and ends with a healthcheck: the
instance, profile and game version it found. Everything it installs, downloads or registers, it asks
about first.

**Updating:** `git pull && npm run setup`, then restart your client. A client still running the server
keeps the plugin helper in use; setup then names what to close.

**By hand** instead — the settings file and each client's registration, ready to copy:
[`docs/Hosting.md`](docs/Hosting.md) §1.1.

**Work on a test instance.** Deploys write into the instance's mods and profile. A dedicated
portable Mod Organizer on a clean game is the safe place to learn the tools — and if your instance
was installed by Wabbajack, an update deletes every mod it did not install.

## Configuration

See [`.env.example`](.env.example). A path may start with `~` and use `$NAME` or `${NAME:-default}`, as
in a shell, on every system; a relative one is taken from the server's folder
([`docs/Hosting.md`](docs/Hosting.md) §1.1).

| Variable | Default | Effect |
| --- | --- | --- |
| `SKYRIM_MOD_MANAGER` | found by itself | `mo2` (Mod Organizer 2) or `amethyst` (Amethyst Mod Manager, Linux). Unset: Mod Organizer when `SKYRIM_MO2_INSTANCE` is set, else Amethyst when it has Skyrim set up |
| `SKYRIM_MO2_INSTANCE` | — (required with Mod Organizer) | The Mod Organizer instance folder; the server follows its selected profile |
| `SKYRIM_WINE_PREFIX` | found by itself for MO2-LINT | Mod Organizer under Proton: the Wine prefix it runs in, to read its ini's Windows paths |
| `SKYRIM_AMETHYST_DIR` | found by itself | Amethyst's config folder, if it is neither the Flatpak's nor `~/.config`'s |
| `NEXUS_API_KEY` | none | Your personal Nexus Mods API key; `healthcheck` shows its account. Without it the Nexus tools are not offered; `downloadNexusFile` is offered only when Nexus confirms a premium account |
| `SKYRIM_PROJECTS_DIR` | `./projects` | Where projects live |
| `SKYRIM_CK_DIR` | the instance's game folder | The Creation Kit, for its Papyrus compiler and vanilla script sources |
| `SKYRIM_PAPYRUS_COMPILER` | the Creation Kit's (Windows); on Linux `papyrus-compiler` on `PATH`, else `tools/papyrus-compiler/papyrus` beside the server or in your home folder | `PapyrusCompiler.exe`, or russo-2025's `papyrus-compiler`, which runs on Linux |
| `SKYRIM_HELPER_PATH` | `helper/bin/SkyrimHelper(.exe)` | The built plugin helper |
| `MCP_PROFILE` | `all` | `core`, `readonly` or `all` — which tools are listed and callable |
| `MCP_MAX_RESPONSE_BYTES` | per profile | Ceiling on one answer; `0` removes it |
| `MCP_TRANSPORT` | `stdio` | `http` for Streamable HTTP at `/mcp` — see [`docs/Hosting.md`](docs/Hosting.md) |
| `SKYRIM_ACCEPTED_TOKENS` | none | HTTP mode: the bearer tokens callers may present |

## Documentation

| Document | For |
| --- | --- |
| [`docs/Tool-Router.md`](docs/Tool-Router.md) | Which tool does what, in the words people use |
| [`docs/MCP-Tools.md`](docs/MCP-Tools.md) | How the server behaves: rules, architecture, workflows, errors, troubleshooting |
| [`docs/Tool-Reference.md`](docs/Tool-Reference.md) | Every tool and argument — generated, never edited by hand |
| [`skills/`](skills) | The modding knowledge the server serves to agents |
| [`CONTEXT.md`](CONTEXT.md), [`docs/adr`](docs/adr) | Vocabulary and design decisions |
| [`docs/research`](docs/research) | The research the design rests on |
| [`AGENTS.md`](AGENTS.md) | Working on this code |
| [`docs/Hosting.md`](docs/Hosting.md) | stdio, Streamable HTTP, Docker |

The guides are served to clients too: ask the running server with `readServerGuide`.

## Development

```bash
npm run build:helper   # dotnet publish helper/SkyrimHelper -> helper/bin
npm run build          # tsc -> dist/
npm test               # vitest, fully offline: no game, no helper needed
npx tsc --noEmit       # type check only
npm run docs:tools     # regenerate docs/Tool-Reference.md after changing a tool (needs a build)
npm run smoke          # the built server over real stdio
```

## License

GPL-3.0 — see [`LICENSE`](LICENSE). The plugin engine, Mutagen, is GPL-3.0; [ADR-0006](docs/adr/0006-gpl-3.md)
explains why the whole project follows it. Copyright © 2026 Andreas Breit; co-authored with Claude
(Anthropic).
