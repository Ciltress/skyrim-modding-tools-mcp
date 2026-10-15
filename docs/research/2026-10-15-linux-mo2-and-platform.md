# Research: Linux (CachyOS) — Amethyst, MO2 under Proton, the platform, and local models

Gathered 2026-10-15. Facts only. Primary sources: the Amethyst Mod Manager source (`main` at
`edde06e`, 2026-10-10, = v2.5.4) and its wiki; MO2-LINT (the former rockerbacon installer, `main` at
`641758c`, 2026-10-14, and tag 6.0.6 for the old Bash version); Fluorine Manager (`f007be9`); Jackify
(`4134bdf`); Steam Tinker Launch (`8550ab2`); MO2 (`4ba22f0`); Proton (`proton-11.0-2e`); Wine
(`5b6b854`); Mutagen (`dev` at `414371e`); dotnet/runtime (`release/10.0` at `591ede8`); Ollama
(`00bef57`) and the docs of the MCP clients named in §10. Every URL was fetched today unless marked.
"Local:" means observed read-only on this Windows machine. **UNVERIFIED** means no primary source was
found. Earlier findings are not repeated: Skyrim 1.7.x, SKSE 2.3.1, Address Library and Papyrus basics
are in [engines-and-tooling](2026-10-15-engines-and-tooling.md) §4 and §6, and MO2's `refresh` on
Windows is in [nexus-publishing-and-mo2-refresh](2026-10-15-nexus-publishing-and-mo2-refresh.md) §2.

Abbreviations: `AMM` = https://github.com/ChrisDKN/Amethyst-Mod-Manager/blob/edde06e518c0a3ca5ba47a8bbf065c4ecc4a8f92 ;
`LINT` = https://github.com/Furglitch/modorganizer2-linux-installer/blob/641758cec786d155e68bc1e3a4ba895cf7137885 ;
`MO2` = https://github.com/ModOrganizer2/modorganizer/blob/4ba22f0d8b6f9e08e44008b8395cd774551b4ebe ;
`PROTON` = https://github.com/ValveSoftware/Proton/blob/proton-11.0-2e/proton ;
`WINE` = https://github.com/wine-mirror/wine/blob/5b6b85421c2a2161728b2a55e9f09271770a3eb0 .

## 1. Amethyst Mod Manager (the brother's actual setup)

### 1.1 What it is
- Official repo: **ChrisDKN/Amethyst-Mod-Manager** (the URL the AUR package and the Nexus page point
  to). GPL-3.0, Python (PySide6 GUI) plus one required Rust extension (`native/amethyst_filegraph`,
  the file-conflict catalog). Created 2026-02-21; 1,192 stars. https://github.com/ChrisDKN/Amethyst-Mod-Manager
- Very active: v2.5.4 on 2026-10-10, v2.5.5-beta.3 on 2026-10-15, releases roughly weekly. Branches
  `main`, `Testing`, `Resources`. Assets: x86_64/aarch64 AppImage and a Flatpak bundle.
  https://github.com/ChrisDKN/Amethyst-Mod-Manager/releases
- "Git version" can mean three things (ask, §13): a source checkout (`git clone` + `meson install`,
  launched as `amethyst-mod-manager` / `amethyst-mod-manager-cli`, which are `exec python3 -m run_qt` /
  `-m cli`) — AMM/amethyst-mod-manager, wiki "Building from source"
  https://github.com/ChrisDKN/Amethyst-Mod-Manager/wiki ; the AUR package `amethyst-mod-manager`
  (2.5.4-1, release-based, 17 votes); or the AUR fork `amethyst-mod-manager-no-update-check-git`
  (1.3.9.r1163, built from `fur-git/Amethyst-Mod-Manager-no-update-notice`, 0 votes).
  https://aur.archlinux.org/packages/amethyst-mod-manager
- It is a **native Linux manager, not MO2**: "Mo2 style interface", Nexus and Wabbajack installs,
  libloot built in, "Deploy as symlinks, Hardlinks or as a VFS", detects games from Steam, Heroic,
  Lutris and Faugus; "almost 100 games". AMM/README.md
- Finding Skyrim SE: the handler `SkyrimSE` (`game_id` `skyrim_se`, Steam id `489830`, launcher exe
  `SkyrimSELauncher.exe`) — AMM/src/Games/Bethesda/skyrim_se.py. Steam libraries are read from
  `libraryfolders.vdf` under `~/.local/share/Steam`, `~/.steam/steam`, `~/.steam/root`, Flatpak and
  Snap roots (AMM/src/Utils/launchers/steam.py L33-41). The prefix is found by
  `_find_prefix_for_load()`: a saved non-Steam shortcut appid, then `steam_id` (489830), then Lutris,
  Faugus, Bottles (AMM/src/Games/base_game.py L2395-2420), and stored as the **`pfx` directory**
  (`…/steamapps/compatdata/489830/pfx`), since every in-prefix path is built as
  `prefix / "drive_c/users/steamuser/…"` (AMM/src/Games/Bethesda/skyrim_se.py L491-494).
- It works **in the game's own Proton prefix**; Windows tools (xEdit, Synthesis, Pandora, CK) are run
  with `proton run` in that prefix (wiki FAQ "Running some wizard tools on Steam deck…";
  AMM/src/Utils/bethesda/synthesis.py header). https://github.com/ChrisDKN/Amethyst-Mod-Manager/wiki/1.-FAQ

### 1.2 On-disk model
| What | Where | Source |
|---|---|---|
| App config | `$XDG_CONFIG_HOME/AmethystModManager` (default `~/.config/AmethystModManager`) | AMM/src/Utils/config_paths.py L5-31 |
| Per-game paths | `~/.config/AmethystModManager/games/<game name>/paths.json`: `game_path`, `prefix_path`, `prefix_path_cleared`, `deploy_mode` (`hardlink` default, `symlink`, `copy`), `staging_path`, `save_path_override`, `shortcut_appid`, plus `script_extender_swap`, `profile_ini_files`, `profile_saves`, `plugins_txt_filename` | base_game.py L2251-2257, L2475-2530; fallout_3.py L535-557 |
| Deploy state | `games/<game>/deploy_state.json`: `last_deployed`, `deploy_active`, `last_deploy_mode`, `last_active_profile`, `recovery_context` | base_game.py L2137-2245 |
| Staging root ("profile root") | New games: `~/Games/Amethyst/<game name>/` (must be on the game's filesystem for hardlinks). Older installs: `~/.config/AmethystModManager/Profiles/<game>/`; `$MOD_MANAGER_PROFILES_DIR` overrides; a custom `staging_path` is itself the root | config_paths.py L75-137; base_game.py L1866-1877 |
| Mods | `<root>/mods/<ModName>/` (one folder per mod, MO2-style) | profiles/structure.py |
| Overwrite | `<root>/overwrite/` ("MO2-compatible catch-all") | profiles/structure.py |
| Root files | `<root>/Root_Folder/` (deployed to the game root), `<root>/Applications/` | profiles/structure.py |
| Profiles | `<root>/profiles/<Profile>/modlist.txt`, `plugins.txt`, `loadorder.txt`, `profile_state.json`; the first is called `default` | profiles/structure.py; plugins/__init__.py |
| Profile-specific mods | flag in `profile_state.json` → `<profile>/mods`, `<profile>/overwrite`, `<profile>/filemap.txt` | base_game.py L1955-2020 |
| Downloads | `[paths] download_cache_path` in `amethyst.ini`, else `~/.config/AmethystModManager/download_cache/` | config_paths.py L466-491 |
| Logs | `~/.config/AmethystModManager/logs/` | config_paths.py L184-191 |

- **modlist.txt is MO2's format**, and the code says so: "Read and write a MO2-compatible
  modlist.txt": `+Name` enabled, `-Name` disabled, `*Name` "enabled, always-on (cannot be toggled)",
  `<Name>_separator` separators (always written with `-`); "line 0 (top) = highest priority". Written
  with **LF**, UTF-8 with surrogateescape, atomically. AMM/src/Utils/mods/modlist.py L1-14, L143-164
- The MO2-stub module states it outright: "our modlist is already MO2's exact on-disk format".
  AMM/src/Utils/mo2/stub.py header. **Difference: in MO2, `*` marks unmanaged entries (DLC, Creation
  Club) that have no mod folder; in Amethyst `*` is a locked but real mod.**
- The GUI shows priority 0 at the bottom by default (reversible) — display only; the file order is
  MO2's. wiki FAQ.
- Mod folders also carry MO2-style `meta.ini` (Nexus, mod.io, Thunderstore keys).
  AMM/src/Utils/mods/metadata.py
- Conflict state lives in the Rust "filegraph" catalog; `filemap.txt` is now a legacy export
  (`amethyst-mod-manager-cli export-filemap <game> <profile>`). AMM/native/amethyst_filegraph/README.md ;
  AMM/src/Utils/filegraph/deploy.py ("legacy filemap.txt input is not supported"); AMM/src/cli.py L386-420

### 1.3 Deploy
- Deploy is a **manual, separate action**: "press deploy on the top bar … Whenever you make a change
  … You will need to deploy again". Deploy runs restore first. The game is then launched normally
  from Steam; Amethyst need not be running. wiki https://github.com/ChrisDKN/Amethyst-Mod-Manager/wiki/5.-Deploy-and-Restore ,
  FAQ "Do I need to run the game from the manager?"
- Data-folder games (Skyrim): `move_to_core` moves the vanilla contents of `<game>/Data` into a
  sibling **`Data_Core/`**, then `deploy_filemap` links every winning mod file into `<game>/Data`, then
  `deploy_core` links the vanilla files back for paths no mod covers. Modes: `HARDLINK` (default, same
  filesystem), `SYMLINK`, `COPY`. AMM/src/Utils/deployment/__init__.py header; standard.py L466-477,
  L561-600, L1370-1381
- **While deployed, `<game>/Data` is a real folder holding the merged load order** — a native tool
  reading `Data` sees what the game sees, without any VFS.
- Restore (`restore_data_core`): files in `Data` that are not symlinks, have `nlink == 1`, do not
  match the size/mtime recorded at deploy, are not vanilla and not owned by the deployment are
  **moved to `overwrite/`**; then `Data` is cleared and `Data_Core` moved back. Edited deployed copies
  are rescued "to their exact catalogued source". AMM/src/Utils/deployment/standard.py L1513-1570.
  Wiki: "Do not manually install mods while a profile is deployed — They will be moved to overwrite".
- Hardlink caveat: a deployed hardlink shares its inode with the staged file, so writing **in place**
  through `Data` also changes the staged mod file (inference from hardlink semantics; the code's
  rescue rule above handles replaced files).
- Optional **VFS mode**: "Mods are deployed to the profile instead of the game so the game directory
  is not touched". It wraps the launch in a bubblewrap mount namespace (default backend: a
  "materialized profile-local shadow tree"; legacy fuse-overlayfs backend needs `bwrap`,
  `fuse-overlayfs`, `fusermount3`). The merged view is visible only to the launched process.
  wiki FAQ; AMM/src/Utils/vfs/__init__.py; AMM/src/Utils/vfs/runtime.sh
- **Case-alias symlinks** (on by default, switchable in Quick Configure): `data`/`DATA` → `Data` in
  the game root and other casings for every Data subfolder (`textures`, `TEXTURES` → `Textures`) to
  avoid Wine's case-insensitive directory scans; measured load time 2:45 → 1:35 on a ~500-mod list.
  https://github.com/ChrisDKN/Amethyst-Mod-Manager/wiki/Case-Alias-Symlinks
- Script extender: with `script_extender_swap` (default true) the deploy renames `skse64_loader.exe`
  to the launcher's name and backs up `SkyrimSELauncher.exe`, so Steam's Play starts SKSE. Routing
  rules send `skse64_1*.dll`, `skse64_loader.exe`, ENB files and `d3dcompiler_47.dll` to the game
  root. wiki FAQ "How do I launch script extender"; AMM/src/Games/Bethesda/skyrim_se.py (custom_routing_rules)

### 1.4 Plugins and load order
- Profile files, Skyrim SE flags: `plugins_use_star_prefix = True`, `plugins_include_vanilla = False`,
  `supports_esl_flag = True`, `vanilla_ccc_filename = "Skyrim.ccc"`. "Vanilla incl. Skyrim.ccc content
  (and _ResourcePack.esl …) stays OUT of plugins.txt". `primary_plugin_order` pins the five masters,
  four CC files and `_ResourcePack.esl` first. AMM/src/Games/Bethesda/skyrim_se.py L33-56
- `plugins.txt`: `*Name.esp` enabled, bare `Name.esp` disabled, order = load order; written with
  **LF**, encoded **cp1252** when possible else UTF-8; read tolerating both; `#` lines skipped.
  `loadorder.txt`: "the full load order including vanilla plugins", bare names, UTF-8.
  AMM/src/Utils/plugins/__init__.py L1-20, L117-224, L315-352
- On deploy the profile's `plugins.txt` is **copied** (not symlinked; GOG builds cannot read a
  symlink) to `pfx/drive_c/users/steamuser/AppData/Local/Skyrim Special Edition/plugins.txt` (and the
  `… GOG` folder if present); restore deletes it. AMM/src/Games/Bethesda/fallout_3.py L724-824;
  skyrim_se.py L491-492
- Light plugins are ordinary `*Name.esl` lines; an ESLifier wizard exists. Load order sorting uses
  libloot when built. AMM/README.md; AMM/src/Utils/bethesda/eslifier.py

### 1.5 Can an outside tool add a mod and enable its plugin?
- **CLI** (`amethyst-mod-manager-cli`, or the AppImage with arguments): `list-games`,
  `list-profiles <game>`, `deploy <game> <profile>`, `launch <game> [--profile] [--no-deploy]`,
  `restore <game>`, `export-filemap`, `clear-credentials`. `<game>` = name, `skyrim_se` or `489830`;
  profile names are case-sensitive. **No add-mod, enable or refresh command.**
  AMM/src/cli.py L1-16, L423-470; https://github.com/ChrisDKN/Amethyst-Mod-Manager/wiki/9.-CLI-Mode
- **IPC**: one Unix socket per running GUI, at `$XDG_RUNTIME_DIR/amethyst-mod-manager.sock`,
  `~/.local/share/AmethystModManager/amethyst-mod-manager.sock`, a Flatpak per-app path, or
  `/tmp/amethyst-mod-manager-<uid>.sock`. It accepts one JSON object `{"nxm_url": "…"}` (nxm, modl,
  ror2mm links), max 256 KiB. **No refresh message.** AMM/src/Nexus/nxm_handler.py L80-150, L977-1090
- **No file watching**: no `QFileSystemWatcher`/inotify in the GUI (grep of `src/gui_qt/*.py` and
  `src/`); a Refresh button re-reads from disk (`_reload_modlist(rescan_index=True)`,
  AMM/src/gui_qt/app.py L19209-19220).
- **External edits to modlist.txt**: every GUI save takes a per-file lock, re-reads the file and
  **keeps "externally added" entries** (names it never saw) by prepending them; entries it already
  knew are written from its in-memory state, so an external flip or reorder of a known line is lost
  on the next GUI edit. AMM/src/gui_qt/modlist_model.py L1256-1310. Background installs use
  `prepend_mod` (read-modify-write under the same lock). AMM/src/Utils/mods/modlist.py L167-190
- `sync_modlist_with_mods_folder` prepends any unlisted `mods/` folder as a **disabled** entry and
  drops entries whose folder is gone. AMM/src/Utils/mods/modlist.py L332-347
- External edits to `plugins.txt`/`loadorder.txt`: reads are mtime-cached and re-parsed when the file
  changes; whether the GUI's plugin save preserves foreign lines like the modlist save does is
  **UNVERIFIED** (AMM/src/gui_qt/plugin_state.py L860-900, L1717-1740 write whole lists).
- Running? `pgrep -f run_qt` (source/AUR: `python3 -m run_qt`, so `comm` is `python3`), or a live
  connect to one of the sockets above. AMM/amethyst-mod-manager; nxm_handler.py `_is_live`.

### 1.6 Downloads, FOMOD, meta, overwrite
- nxm: registers `amethystmodmanager-nxm.desktop` for `x-scheme-handler/nxm`; a second process hands
  the link to the running one over the socket. AMM/src/Nexus/nxm_handler.py L1-30, L173
- FOMOD (`src/Utils/fomod/`), BAIN, Nexus collections, Wabbajack lists; `meta.ini` per mod; an
  `overwrite/` that collects runtime-generated files on restore and is deployed back next time.
  AMM file tree; wiki "Deploy and Restore" § Runtime generated files

### 1.7 SKSE, Papyrus, Creation Kit
- SKSE: `frameworks = {"Script Extender": "skse64_loader.exe"}`; a PE reader checks every SKSE DLL's
  `SKSEPlugin_Version` export against the runtime and Address Library. It treats Address-Library
  plugins built before 2025-05-26 without the "Address Library v5" flag as **incompatible with
  runtime ≥ 1.7.99**. AMM/src/Utils/bethesda/skse_plugins.py L1-24, L193-245
- Creation Kit: a wizard installs CKPE and runs `CreationKit.exe` in the prefix.
  AMM/src/Utils/bethesda/creation_kit.py. Nothing for Papyrus compilation was found (no compiler in
  the tree).
- It fabricates **stub MO2 instances** (`ModOrganizer.ini` with `Z:` paths + the profile's
  `modlist.txt`) for Windows tools that read MO2 (PGPatcher, ESLifier). AMM/src/Utils/mo2/stub.py,
  dummy.py

### 1.8 Amethyst profile vs MO2 instance, side by side
| | MO2 instance | Amethyst |
|---|---|---|
| Settings | `ModOrganizer.ini` in the instance | `~/.config/AmethystModManager/games/<game>/paths.json` |
| Active profile | `[General] selected_profile` | `deploy_state.json` `last_active_profile` / `last_deployed` |
| Mods, overwrite | `mods/`, `overwrite/` | same names under the staging root |
| modlist.txt | CRLF, header comment, `*` = unmanaged | LF, no header, `*` = locked mod |
| plugins.txt | system codepage, CRLF | cp1252/UTF-8, LF; copied into the prefix on deploy |
| loadorder.txt | MO2's full order | full order incl. vanilla |
| Game sees | USVFS at launch | real files in `<game>/Data` (hardlinks) or a bwrap view (VFS mode) |
| Live re-read | `ModOrganizer.exe refresh` | none; Refresh button only |

## 2. MO2 on Linux under Proton/Wine: how it is run in 2026

| Route | Status (2026-10) | MO2 | Where MO2 / instance | Prefix | Launch |
|---|---|---|---|---|---|
| **MO2-LINT** (was rockerbacon/modorganizer2-linux-installer) | Active; repo transferred to Furglitch (old URL 301s); rewritten in Python; 7.0.3 on 2026-10-07; AUR `modorganizer2-installer-bin` 7.0.3 | 2.5.2 | Portable instance = MO2 folder, default `~/Games/mo2-lint/mo2-skyrim_se-steam/` | **the game's own** `compatdata/489830/pfx` | Steam Play compat tool `mo2_489830_proton_redirector` swaps the launcher for `mo2-redirector.exe` |
| MO2-LINT 6.x (Bash, ≤ 2025-11) | Unsupported since v7 | 2.5.2 | `~/Games/mod-organizer-2-skyrimspecialedition/modorganizer2/ModOrganizer.exe` | game's prefix | game exe replaced by a C redirector reading `modorganizer2/instance_path.txt` |
| **Jackify** (Wabbajack lists) | Active (alpha); AUR `jackify-bin` 0.8.1.3 | from the list | the modlist folder (portable) | a **non-Steam shortcut's** own compatdata | Steam shortcut to `ModOrganizer.exe` |
| **Fluorine Manager** (NaK's successor) | Active, v0.4.0 2026-10-02; AUR `fluorine-manager-bin` | native Linux port of MO2 | portable instances (`ModOrganizer.ini`) | user-chosen, `~/.config/fluorine/config.json` `prefix_path` | native binary; FUSE VFS |
| NaK | **Archived** 2026-05: "replaced by … Fluorine Manager" | — | — | — | — |
| Steam Tinker Launch | v12.12 (2023); master 2025-07 | **hard-coded 2.4.4** | `~/.config/steamtinkerlaunch/mo2/compatdata/pfx/drive_c/Modding/MO2/` (standalone) or the game prefix `drive_c/Modding/MO2` | own or game's | `WINEPREFIX=… wine ModOrganizer.exe -i <instance>` (**global** instances) |
| Lutris / Bottles / Heroic | MO2-LINT: "does not support Lutris"; Heroic (GOG/Epic) supported | — | — | Heroic's prefix | Heroic launch option |
| CachyOS-specific package | none found in AUR searches for `modorganizer`, `mo2`; CachyOS repo contents **UNVERIFIED** | | | | |

Sources: https://github.com/Furglitch/modorganizer2-linux-installer (API: `created_at` 2019,
`pushed_at` 2026-10-14) and its README "Originally developed by rockerbacon as a Bash script … fully
rewritten in Python"; https://github.com/SulfurNitride/NaK (archived, README);
https://github.com/SulfurNitride/Fluorine-Manager/blob/f007be930ae6417e5f91c00bad0e2e622927b7b7/README.md ;
https://github.com/Omni-guides/Jackify ; STL https://github.com/sonic2kk/steamtinkerlaunch/blob/8550ab26a712b7f5f6d0947070181446b9de61fd/steamtinkerlaunch
L288-303, L17394-17400, L17917; AUR RPC searches.

### 2.1 MO2-LINT 7 in detail (the likeliest "MO2 on CachyOS" route)
- `mo2-lint install skyrim_se [<dir>]`; default dir from `~/.config/mo2-lint/settings.toml`:
  `root_folder = '~/Games/mo2-lint'`, `folder_name = 'mo2-{game}-{launcher}'`. LINT/configs/settings.toml;
  LINT/docs/guide/install.md
- **"choose a Portable installation, not a Global one. This is the only supported installation
  type"**. MO2 is unpacked straight into the instance dir, so `ModOrganizer.exe` and
  `ModOrganizer.ini` sit side by side. LINT/docs/getting-started/first-launch.md; LINT/src/mo2-lint/step/external_resources.py L150-189
- Prefix: `protontricks.get_prefix(489830)` — the game's prefix — then winetricks `win10 arial
  fontsmooth=rgb xaudio2_7=native xact d3dcompiler_43 d3dcompiler_47`, VC++ runtimes, a `.reg` that
  makes `.ini`/`.txt`/folders open on the Linux desktop via `wine2linux`.
  LINT/src/mo2-lint/step/configure_prefix.py L29-80, L171-195; LINT/configs/game_info.yml L486-500; LINT/configs/tweaks.reg
- Launch: a Steam compat tool in `~/.local/share/Steam/compatibilitytools.d/mo2_489830_proton_redirector/`
  whose `proton` script rewrites `run|waitforexitandrun <game>/SkyrimSELauncher.exe` into
  `<game>/mo2-redirector.exe`; the redirector (a Windows exe) reads `~/.config/mo2-lint/state.json`
  through `Z:` and runs `Z:\…\ModOrganizer.exe`. Default Proton "Proton 11.0".
  LINT/src/steam-proton-wrapper/proton; LINT/src/mo2-lint/util/steam/proton_wrapper.py L20-25;
  LINT/src/redirector/__init__.py L15-18, L307-330
- **`~/.config/mo2-lint/state.json` lists every instance with POSIX `instance_path`, `game_path`,
  launcher, appids and the Proton wrapper** — a ready index for discovery ("Do not manually edit").
  LINT/src/mo2-lint/util/state_file.py L187-220; LINT/docs/troubleshooting/instance-and-data-issues.md
- nxm: `~/.local/share/applications/…` desktop entry → `~/.local/share/mo2-lint/nxm-handler`; with
  MO2 running it runs `protontricks -c "wine '<instance>/nxmhandler.exe' '<url>'" 489830` with
  `PROTON_VERSION` set; otherwise `steam://launch/489830`. LINT/configs/nxm-handler.desktop;
  LINT/src/nxm-handler/__init__.py L129-228
- SKSE: the game info pins **SKSE 2.3.1 for runtime 1.7.104** (Nexus mod 30379 file 795992), 2.3.0 for
  1.7.99, 2.2.6 for 1.6.1170. LINT/configs/game_info.yml L500-556
- Tested against **Proton 11.0 only**; 10.0-4 has known MO2 issues; GameMode (`gamemoderun`) "will
  cause MO2 to fail to launch"; paths outside `$HOME` need `STEAM_COMPAT_MOUNTS`.
  LINT/docs/getting-started/requirements.md; LINT/docs/troubleshooting/launch-issues.md

### 2.2 Does USVFS work under Proton?
- Yes for MO2 2.5.x on x86_64 per MO2-LINT, which ships stock MO2 2.5.2 (USVFS) and needs a patched
  USVFS only on ARM64 ("2.5.2-woa.1 … includes the USVFS fix"). LINT/configs/resource_info.yml;
  LINT/docs/getting-started/requirements.md
- History: MO2 2.5.0 did not start under Proton until Wine 8.21 (MR 3931, "windows.ui: Support accent
  colors in uisettings3_GetColorValue", merged 2023-11-16); STL still pins 2.4.4 because of it.
  https://gitlab.winehq.org/wine/wine/-/merge_requests/3931 ; STL L17396
- Cost: Amethyst's author measured a ~500-mod Skyrim list at ~5:15 from MO2 on Linux vs ~2:45 for a
  hardlink deploy. wiki Case-Alias-Symlinks (single-user benchmark).
- Fluorine replaces USVFS with FUSE (USVFS optional, "experimental"), mounting **over the game's Data
  folder** (`m_mountPoint = m_dataDirPath`). Fluorine README; src/src/fuseconnector.cpp L507-523
  (Fluorine commit above).

## 3. Paths under Wine/Proton

### 3.1 Prefix layout and drive letters
- Proton prefix = `<library>/steamapps/compatdata/<appid>/pfx/`; Proton sets `WINEPREFIX` to it from
  `STEAM_COMPAT_DATA_PATH`. PROTON L635, L1724, L2147
- Drives: Proton creates `dosdevices/c:` → `../drive_c` and `dosdevices/z:` → `/`; with the compat
  options `gamedrive`/`steamdrive` it adds `s:` → the game's library root and `t:` → the Steam dir.
  PROTON L329-349, L1015-1019
- **`z:` is not always `/`**: Amethyst resolves the `dosdevices/z:` symlink first because of
  "prefixes where Z: points to a UUID mount (e.g. /mnt/c3edc2f9-.../) rather than /". Jackify writes
  `D:` for Steam Deck SD-card libraries. AMM/src/Utils/wine/paths.py; Jackify
  https://github.com/Omni-guides/Jackify/blob/4134bdf729d750ec5078ba8d649edc2edf54a4b6/jackify/backend/handlers/path_handler_mo2.py L296-330
- So a drive letter is mapped by `readlink <prefix>/dosdevices/<letter>:` (lower-case letter + colon),
  which is exactly what MO2-LINT's `wine2linux` does. LINT/configs/wine2linux
- User folders: `pfx/drive_c/users/steamuser/{Documents,AppData/Local,AppData/Roaming}`; Proton
  symlinks the old names (`My Documents`, `Local Settings/Application Data`) to them. PROTON L957-968
- Skyrim inside the prefix: `…/steamuser/Documents/My Games/Skyrim Special Edition/` (INIs, Saves,
  `SKSE/` logs and crash logs, `Logs/Script/Papyrus.0.log`) and
  `…/steamuser/AppData/Local/Skyrim Special Edition/plugins.txt`. AMM/src/Games/Bethesda/fallout_3.py
  L878 + skyrim_se.py L491-494; Fluorine src/src/wineprefix.cpp L185-208; Mutagen GameLocator (§5)
- Registry hives are files in `pfx/` (`system.reg`, and by Wine convention `user.reg`). PROTON
  L697-740. MO2's global `CurrentInstance` lives in HKCU `Software\Mod Organizer Team\Mod Organizer`
  (QSettings("Mod Organizer Team","Mod Organizer")), so under Wine in `pfx/user.reg` (inference).
  MO2/src/settings.cpp L2492-2508
- MO2 **global** instances: `QStandardPaths::AppLocalDataLocation` = `%LOCALAPPDATA%/ModOrganizer/<name>`
  = `pfx/drive_c/users/steamuser/AppData/Local/ModOrganizer/<name>` under Wine.
  MO2/src/instancemanager.cpp L587-596

### 3.2 How `ModOrganizer.ini` stores paths
- MO2 itself: `gamePath` is written as a **QByteArray of the native-separator path**:
  `setDirectory` → `QDir::toNativeSeparators(path).toUtf8()`; read back with `QString::fromUtf8`.
  In the file that is `gamePath=@ByteArray(Z:\\home\\…)` (Qt doubles backslashes).
  MO2/src/settings.cpp L660-673
- `base_directory`, `mod_directory`, `download_directory`, `profiles_directory`,
  `overwrite_directory`, `cache_directory` are plain QStrings stored **as given**; the default is
  `%BASE_DIR%/<name>` with a forward slash, and every read goes through `QDir::fromNativeSeparators`,
  so `\` and `/` both work. MO2/src/settings.cpp L1626-1760. What a user-picked folder looks like under
  Wine (likely `Z:/home/…` from a Qt dialog) is **UNVERIFIED**.
- Executables: `binary` = `QFileInfo::filePath()`, `workingDirectory` as given.
  MO2/src/executableslist.cpp L98-126
- Third-party writers differ:
  - MO2-LINT writes `gamePath=Z:\\home\\…` **without** `@ByteArray(…)` (string with doubled
    backslashes) and executables' `binary` the same way. LINT/src/shared/mo2_ini.py L17-36, L95-150
  - Jackify writes `gamePath=@ByteArray(Z:\\home\\…)` in one path and a collapsed single-backslash
    form in another, `binary = Z:/…/skse64_loader.exe` with forward slashes, and rewrites
    `Z:/home` → `Z:/var/home` on Fedora Atomic-style systems. Jackify path_handler_mo2.py L55-62, L205-252, L515-519
  - Fluorine, although native, **stores Wine paths** ("save the paths as wine paths in case you move
    to MO2 via proton/wine"): `storePathForIni` → `normalizePathForWine` → `Z:` + backslashes, and maps
    `Z:` back on read; it only maps the `Z:` drive. Fluorine src/src/settings.cpp L44-71;
    libs/uibase/src/utility.cpp L694-789; docs/FAQ.md
- A reader therefore has to accept: `@ByteArray(...)` or bare, quoted or not, `\\`, `\` or `/`,
  `Z:`/`D:`/`S:`/`C:` drives, `%BASE_DIR%`, and native POSIX paths.

## 4. Detecting and refreshing a running MO2 under Proton
- `/proc/<pid>/comm`: Wine calls `prctl(PR_SET_NAME, basename)` after stripping the directory, and
  the kernel truncates to 15 characters, so **`ModOrganizer.ex`**. WINE/dlls/ntdll/unix/env.c L483-505
- `/proc/<pid>/cmdline`: Wine rewrites argv in place to the **Windows command line** (`rebuild_argv`,
  `build_argv(&params->CommandLine)`), e.g. `Z:\home\u\Games\mo2-lint\mo2-skyrim_se-steam\ModOrganizer.exe`.
  WINE/dlls/ntdll/unix/env.c L508-533; WINE/dlls/ntdll/unix/process.c L81, L442, L611. MO2-LINT
  detects MO2 by substring-matching `Z:<instance>\ModOrganizer.exe` in any process's cmdline; v6 used
  `pgrep -f "Z:\\…\\modorganizer2\\ModOrganizer.exe"`. LINT/src/nxm-handler/__init__.py L102-126;
  v6 https://github.com/Furglitch/modorganizer2-linux-installer/blob/93f64fdd08e06c61f92306a4a67b18701554a95a/handlers/modorganizer2-nxm-broker.sh
- `/proc/<pid>/exe` points at Wine's loader ELF (`<loader>-preloader`, i.e. `wine-preloader` in
  current Wine, `wine64-preloader` in older builds), not at `ModOrganizer.exe`. WINE/dlls/ntdll/unix/loader.c L439-468
- `/proc/<pid>/environ` (same uid) carries `WINEPREFIX` and `STEAM_COMPAT_DATA_PATH` for Proton
  launches (PROTON L1724), which names the prefix needed to map the cmdline's drive letter.
- **Delivering `refresh`**: MO2's single-instance channel is a `QSharedMemory` + `QLocalServer` named
  `mo-43d1a3ad-eeb0-4818-97c9-eda5216c29b5` (MO2/src/multiprocess.cpp L7-38). Under Wine both are
  named objects in that prefix's **wineserver**, which is keyed by the prefix directory
  (`/tmp/.wine-<uid>/server-<dev>-<inode>`). WINE/server/request.c L627-638. So a second
  `ModOrganizer.exe refresh` reaches the running MO2 **only when started in the same prefix by a
  compatible Wine**: a client with another protocol version aborts with "version mismatch … Or maybe
  the wrong wineserver is still running?". WINE/dlls/ntdll/unix/server.c L1659-1665
- Working precedent: both MO2-LINT generations deliver nxm links into a running MO2 exactly this way —
  `protontricks -c "wine '<instance>/nxmhandler.exe' '<url>'" 489830` with `PROTON_VERSION` pinned to
  the instance's Proton (v7), or `protontricks-launch --appid 489830 …/nxmhandler.exe <url>` (v6) —
  and `nxmhandler.exe` just `ShellExecute`s `ModOrganizer.exe <link>`, which forwards to the primary.
  https://github.com/ModOrganizer2/modorganizer-nxmhandler/blob/2f97332d44d9f357fbf4009e31724eeb1a42bcb8/src/main.cpp L47-80.
  `refresh` over the same path is **UNVERIFIED at runtime**.
- protontricks: `protontricks -c <COMMAND> <APPID>`, `protontricks-launch --appid <APPID> <PROGRAM>`,
  `$PROTON_VERSION`, `$STEAM_COMPAT_DATA_PATH`; Arch `extra/protontricks` 1.14.1.
  https://github.com/Matoking/protontricks/blob/23f19063999bb016fc8e1be048b76e4c5e4c78dc/README.md L55-90
- Without protontricks: `STEAM_COMPAT_DATA_PATH=<compatdata> STEAM_COMPAT_CLIENT_INSTALL_PATH=<steam>
  python3 <proton dir>/proton run <exe> …` is how Amethyst runs tools in a game prefix (under the Steam
  Linux Runtime entry point for game launches). AMM/src/Utils/launchers/steam.py L520-560
- As on Windows, `refresh` with no MO2 running **starts the GUI**, and MO2-LINT warns against
  launching MO2 "directly through Wine or Protontricks" ("can break the prefix") — check first.
  LINT/docs/getting-started/first-launch.md
- Fluorine (native): same `RefreshCommand` and the same key, but as a **Unix socket**; it probes
  liveness by connecting ("If not, the shm/socket is stale"). Fluorine src/src/commandline.cpp L59;
  src/src/multiprocess.cpp L9-31. Qt picks the platform-specific socket path for a bare name
  (https://doc.qt.io/qt-6/qlocalserver.html); the exact path is **UNVERIFIED**.

## 5. Mutagen and .NET 10 on Linux
- Mutagen's CI builds and tests `Mutagen.Records.Linux.sln` on `ubuntu-latest` with .NET `10.0.*`
  (Windows builds the full `.sln`). https://github.com/Mutagen-Modding/Mutagen/blob/414371eedc94a3e0c28f082180e0492df67ab8ca/.github/workflows/ci-build.yml
- Since 2026-04-03 (`e65ecc44a8`, "IProtonPrefixProvider for ini and data folder lookup improvements
  on Proton") `GameLocator` uses GameFinder's `SteamHandler` without a registry on Linux and looks for
  `Plugins.txt`, INIs and My Documents in `<compatdata>/pfx/drive_c/users/steamuser/…`; GOG and Xbox
  lookups are Windows-only; registry lookups (`HKLM\SOFTWARE\WOW6432Node\Bethesda Softworks\…`) are
  Windows-only. Present in 0.54.0 (the helper's pin). Mutagen GameLocator.cs L23-58, L181-218;
  commit https://github.com/Mutagen-Modding/Mutagen/commit/e65ecc44a82bc8c68677f21c356c7b4ad68e96c6
- The helper passes every plugin path explicitly (`SkyrimMod.Create(release).FromPath(new ModPath(key,
  path))`), so it never needs `GameLocator`. Local: helper/SkyrimHelper/Session.cs L70-112
- Case risks for localized plugins: strings are looked up in `Path.Combine(dataDir, "Strings")` with
  pattern `{ModName}*STRINGS`, and archives with `*.bsa`, through `EnumerateFiles`
  (Mutagen StringsFolderLookupFactory.cs L49-64; GetApplicableArchivePaths.cs L71-72). .NET's
  pattern matching follows "the case sensitivity of the temporary folder" — case-sensitive on Linux.
  https://learn.microsoft.com/en-us/dotnet/api/system.io.enumerationoptions.matchcasing . A mod with
  `strings/` or `.STRINGS` vs `.strings` mismatches would miss (**UNVERIFIED** in practice).
- Synthesis on Linux: Amethyst runs **Windows** Synthesis inside a Proton prefix with the Windows .NET
  SDK installed (AMM/src/Utils/bethesda/synthesis.py header); a native Linux Synthesis was not found.
- .NET on Arch/CachyOS: `extra/dotnet-runtime` and `dotnet-sdk` 10.0.12 (2026-09-10), depending on
  `icu`, `krb5`, `libunwind`, `openssl`, `zlib`; `dotnet-runtime-9.0` also exists.
  https://archlinux.org/packages/extra/x86_64/dotnet-runtime/
- ICU is mandatory unless invariant: "On Linux, if the ICU package is not installed, the application
  will fail to start." The helper deliberately is **not** invariant (Mutagen's YAML writer formats with
  the `en` culture). https://github.com/dotnet/runtime/blob/main/docs/design/features/globalization-invariant-mode.md ;
  local helper csproj. A self-contained `linux-x64` publish still loads the system ICU.
- `<CETCompat>false</CETCompat>` is a Windows (shadow-stack) setting; no Linux effect (inference).

## 6. Reading `SkyrimSE.exe`'s version on Linux
- **`FileVersionInfo` returns nothing useful for a native PE on Unix**: it only reads managed-assembly
  metadata ("If this ever becomes a problem, we can implement a full-fledged Win32 resource parser;
  that would also enable support for native Win32 PE files on Unix"). The helper's `gameVersion`
  (`FileVersionInfo.GetVersionInfo`, Session.cs L62-68) would report `0.0.0.0` on Linux.
  https://github.com/dotnet/runtime/blob/591ede817344fa749dd1af56d7e73b356da3e71a/src/libraries/System.Diagnostics.FileVersionInfo/src/System/Diagnostics/FileVersionInfo.Unix.cs L12-40
- Working approach (Amethyst, Python): find `RT_VERSION` (type 16) in the resource directory, prefer
  the StringFileInfo `FileVersion` string, fall back to `VS_FIXEDFILEINFO` (signature `0xFEEF04BD`,
  `dwFileVersionMS/LS` at +8/+12), because "Older Skyrim EXEs leave the fixed version at 1.0.0.0".
  https://github.com/ChrisDKN/Amethyst-Mod-Manager/blob/edde06e518c0a3ca5ba47a8bbf065c4ecc4a8f92/src/Utils/executables/icon.py L47-90
- In .NET the same is doable with `System.Reflection.PortableExecutable.PEReader` (sections/data
  directories) plus a small resource-tree walk; no maintained NuGet parser was evaluated.

## 7. Papyrus on Linux
- **CK compiler**: Local: `PapyrusCompiler.exe`, `PCompiler.dll` and `Antlr3.Runtime.dll` are 32-bit
  **pure IL** (COR flags `ILONLY`, metadata `v2.0.50727`), `PapyrusAssembler.exe` is native x86. So it
  needs a .NET Framework 2.0-compatible CLR: real .NET 3.5 in a prefix (`winetricks dotnet35`), or
  Mono/wine-mono (Arch `extra/mono` 6.12, `extra/wine-mono` 11.3.0). No report of either working was
  found (**UNVERIFIED**); a Nexus forum post describes an "unable to locate script" failure on Linux
  (search snippet only). https://archlinux.org/packages/extra/x86_64/mono/
- **russo-2025/papyrus-compiler** (MIT, V): 2026.03.15 ships `papyrus-compiler-ubuntu.tar.gz`
  (earlier `-linux`). `compile -i <dir|psc> -o <dir> -h <headers dir> [-nocache -silent -original
  -stats -check -no-debug-info -verbose]`. **No flags-file argument** and a single `-h` directory in
  the docs; `-original` "Uses the original Papyrus compiler" (i.e. shells out to Bethesda's — Windows
  only). Documented differences: multi-line string literals are accepted, and string-literal casing is
  preserved where the CK compiler reuses earlier casing — so output is **not byte-identical** for such
  scripts. https://github.com/russo-2025/papyrus-compiler/blob/b9dc9951f4264084c8ded6721b20f0d81c021d58/README.md
- **papyrus-lang 4.0 `papyrusc`** (MIT): CI publishes NativeAOT `papyrusc` for `win-x64`,
  `linux-x64`, `osx-arm64`, `osx-x64`, gated on byte-identical PEX ("Byte-identical PEX is the gate";
  "Tier 2 (`--ck-compiler`) is not implemented yet"). **No 4.x release yet** — the latest is
  v3.3.0-prerelease.1 (2024-10-04), VSIX only. https://github.com/joelday/papyrus-lang/blob/7a873bde139362e1581bfa3ad2836fdc06ce8189/.github/workflows/ci.yml
  L180-231; README
- **Caprica**: only Windows assets (`Caprica.v0.3.0.7z`, 2023); dormant since 2024-06.
  https://github.com/Orvid/Caprica/releases
- Vanilla sources: `Data/Source/Scripts` vs `Data/Scripts/Source` both occur (local CK has the former;
  the server already imports both, externalTools.ts L47-50). On Linux the folder names must be matched
  case-insensitively (§9).

## 8. Game version, SKSE and downgrading
- SKSE 2.3.1 targets 1.7.104 (engines doc §4); MO2-LINT installs it for 1.7.104 (§2.1). Under Proton
  SKSE runs via `skse64_loader.exe` — Amethyst renames it to `SkyrimSELauncher.exe` so Steam's Play
  starts it; MO2 setups start it from MO2. How many popular SKSE plugins support 1.7.x: **UNVERIFIED**;
  Amethyst's checker flags pre-2025-05-26 Address-Library plugins as incompatible with ≥ 1.7.99 (§1.7).
- Downgrade routes (legitimate, owned copy):
  - Steam console `download_depot 489830 <depot> <manifest>` per depot, then copy files over; manifest
    IDs for 1.6.1170 are published in the Nexus article "Skyrim Manifest List (SSE/AE)"
    (https://nexusmods.com/skyrimspecialedition/articles/6536 — 403 to fetchers; IDs **UNVERIFIED**;
    secondary guides disagree on the 489833 manifest). Works from Linux Steam too (`steam://open/console`, inference).
  - **DepotDownloader** 3.4.0 (SteamRE) ships `linux-x64`; `-app 489830 -depot <id> -manifest <id>
    -username <user> -os windows -dir <dir>` (needs `-os windows` on Linux; the default is the host OS).
    https://github.com/SteamRE/DepotDownloader/blob/master/README.md
  - wSkeever's "Skyrim Downgrade Patcher", reportedly updated to go from 1.7.99 to 1.6.1170/1.5.97
    (https://onmsft.com/?p=60181, secondary; Nexus page not fetched). A Windows tool; under Wine
    **UNVERIFIED**.
  - Wabbajack "Stock Game" copies (Jackify, Amethyst's Wabbajack support) carry the list's game version.
  - Steam verify/auto-update restores 1.7.104; no official Steam beta branch for 1.6.1170 was found.

## 9. Case sensitivity
- Wine: an exact-case `fstatat` first; on a miss, `find_file_in_dir` reads the whole directory and
  compares case-insensitively ("the hard way"). A directory is treated as case-insensitive when it has
  the ext4 **casefold** flag (`EXT4_CASEFOLD_FL`) or is a CIOPFS FUSE mount.
  WINE/dlls/ntdll/unix/file.c L1300-1325, L2975-3010
- Proton sets the casefold bit on a new prefix's `drive_c` (silently ignored where unsupported); it
  does **not** casefold `steamapps/common` or mod folders. PROTON L487-501, L996-1002
- CachyOS's installer defaults to **btrfs** (choices btrfs, xfs, ext4, f2fs, zfs); btrfs has no
  casefold, so on a default CachyOS install nothing is case-insensitive.
  https://github.com/CachyOS/cachyos-calamares/blob/5f098957d35f5272c2519ab496f237be1de7118b/src/modules/partition/partition.conf L56-60
- Skyrim asks for `data`, `Data\MESHES`, `Data\TEXTURES` etc. constantly; Amethyst answers with
  case-alias symlinks (§1.3). A native tool walking `Data` with case aliases present sees **duplicate
  directories** (`Textures`, `textures`, `TEXTURES`) that are the same folder — dedupe by inode/realpath.
- Consequence for a native reader: `meshes` vs `Meshes`, `Scripts/Source` vs `scripts/source`,
  `Strings` vs `strings`, `.ESP` vs `.esp` are different paths. Mod-file conflict resolution and
  plugin lookup must compare lower-cased relative paths (as Amethyst's filemap does, with
  `filemap_casing_pins` to choose the deployed spelling). AMM/src/Games/Bethesda/skyrim_se.py.

## 10. Local models: Ollama and MCP clients on Linux

### 10.1 Ollama's API
- Native `/api/chat` takes `tools` as JSON-Schema functions; replies carry `tool_calls` whose
  `arguments` is a **JSON object**; results go back as `{"role":"tool","tool_name":…}`; parallel calls
  are supported. https://github.com/ollama/ollama/blob/00bef57a9f5b1abadbdfa40222c9bf7a5a1cd657/docs/capabilities/tool-calling.mdx
- **Default context by VRAM: < 24 GiB → 4k, 24–48 GiB → 32k, ≥ 48 GiB → 256k**; "agents, and coding
  tools should be set to at least 64000 tokens"; `OLLAMA_CONTEXT_LENGTH=64000 ollama serve`; check
  with `ollama ps`. docs/context-length.mdx
- Anthropic-compatible `/v1/messages` (tools, tool results, streaming); "**Tool-choice controls,
  deferred tools, and hosted web search are not fully supported**"; `tool_choice` unchecked.
  docs/api/anthropic-compatibility.mdx L36, L274-318
- No documented limit on the number of tools was found. Tool-call parsing is per model family; open
  issues/PRs in ollama/ollama (titles only, via GitHub search): #17407 "api: coerce tool call
  arguments declared with oneOf", #18468 "gemma4 renderer drops tool parameters named `description`,
  `type`, `properties`, `required` or `nullable`", #18390 "gemma4: tool-call object keys containing
  spaces are left unquoted … and the whole call is dropped", #18649 trailing tokens reject a valid call.

### 10.2 Clients that run stdio MCP servers with Ollama models
| Client | Model path | MCP transports / launch | Tool control | Source |
|---|---|---|---|---|
| **Claude Code** | Ollama's Anthropic API: `ollama launch claude`, or `ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY=""` | stdio/HTTP as usual | **Tool search is disabled when `ANTHROPIC_BASE_URL` is non-first-party → all MCP tools load upfront**; upfront descriptions and server instructions are cut at 4,096 chars; output warning at 10k tokens, cap 25k (`MAX_MCP_OUTPUT_TOKENS`) | ollama docs/integrations/claude-code.mdx; https://code.claude.com/docs/en/mcp |
| **ollmcp** (mcp-client-for-ollama, MIT, active) | Ollama native | stdio (default), SSE, Streamable HTTP; `ollmcp mcp add <name> -- <cmd>`, `--servers-json`, `--claude-desktop` | enable/disable tools and servers live; `num_ctx` setting; human-in-the-loop | https://github.com/jonigl/mcp-client-for-ollama |
| **oterm** (MIT, active) | Ollama native (via pydantic-ai) | stdio (`command`,`args`,`env`,`cwd`), Streamable HTTP | per-chat tool selection; names `{server}_{tool}` ≤ 64 chars; **stdio children inherit only HOME, LOGNAME, PATH, SHELL, TERM, USER** — every other env var must be declared | https://github.com/ggozad/oterm/blob/HEAD/docs/mcp/index.md |
| **Kit** (succeeds mcphost, which is archived) | Ollama among providers | `mcpServers` `type: local` `command: [...]`, remote URLs | per-server `allowedTools` | https://github.com/mark3labs/kit ; https://github.com/mark3labs/mcphost |
| **Open WebUI** ≥ 0.6.31 | Ollama | **Streamable HTTP only**; stdio needs the `mcpo` proxy | admin-gated | https://github.com/open-webui/docs/blob/main/docs/features/extensibility/mcp.mdx |
| **Goose** | Ollama provider (`goose configure`) | extensions (stdio command); details not fetched (**UNVERIFIED**) | | ollama docs/integrations/goose.mdx |
| **Continue** | Ollama provider | `type: stdio|sse|streamable-http`, `command`, `args`, `env`; "MCP can only be used in the agent mode" | | https://docs.continue.dev/customize/deep-dives/mcp |
| **LM Studio** ≥ 0.3.17 | its own runtime, not Ollama | Cursor-style `mcp.json` | warns servers built for Claude/ChatGPT "might use excessive amounts of tokens … trigger frequent context overflows" | https://lmstudio.ai/docs/app/mcp |

### 10.3 What the vendors say about small models
- oterm: "Smaller LLMs are often less capable with tools … try reducing the number of tools attached
  to a chat, increasing the context size, or using a larger LLM."
- Open WebUI: "a model may ignore tools, send incorrect arguments, or fail to complete a multi-step
  task. Try a stronger model with reliable native tool calling."
- Ollama recommends tool-capable models via its search filter (https://ollama.com/search?c=tools)
  and uses `qwen3` in every tool example. Meta's Llama 3.1 note that the 8B model cannot reliably hold
  a conversation alongside tool definitions is **UNVERIFIED** (page moved; not re-fetched).
- Failure modes with primary evidence: dropped calls on unexpected key shapes, parameters named like
  JSON-Schema keywords dropped (gemma4), `oneOf` arguments needing coercion (§10.1).

### 10.4 Protocol and client features that help
- MCP `tools/list` supports pagination and `notifications/tools/list_changed` (`listChanged`) in
  revisions 2025-11-25 and 2026-07-28 (the latter adds a caching utility).
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx
- Client-side filtering exists in Kit (`allowedTools`), ollmcp and oterm (toggles); Claude Code's
  deferral (`ENABLE_TOOL_SEARCH`, `_meta["anthropic/alwaysLoad"]`) does not apply behind Ollama.

## 11. Docker (second option, brief)
- An image would need Node ≥ 24.18, the .NET 10 runtime **with ICU**, a Linux Papyrus compiler
  (russo, or papyrusc once released), git; bind mounts of the game folder, the staging root/MO2
  instance, `~/.config/AmethystModManager` and the Proton prefix **at identical absolute paths**
  (the INIs, `paths.json` and `state.json` hold absolute paths), and `--user $(id -u):$(id -g)` so
  written files keep the owner. Hardlink-based deploys require the same filesystem inside and out.
- stdio MCP servers in Docker are run as `docker run --rm -i …` (oterm's documented example).
- Detecting/refreshing MO2 from a container needs the host PID namespace and `/tmp/.wine-<uid>`
  (inference). Mutagen/Synthesis in Docker: no report found (**UNVERIFIED**). Fluorine and MO2-LINT
  use containers only for their own builds/tests.

## 12. CI
- The repo's CI already runs vitest, `tsc` and the smoke test on `ubuntu-latest` with
  `setup-node` 24.18.0 (local `.github/workflows/ci.yml`). Nothing there builds the helper.
- GitHub's Ubuntu 24.04 image (20261004) preinstalls .NET SDKs **10.0.112–10.0.401** and Node 22;
  **`ubuntu-latest` moves to Ubuntu 26.04 in November 2026**.
  https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
- Mutagen's own CI (above) proves `dotnet build/test` of Mutagen on Ubuntu with `actions/setup-dotnet`
  `10.0.*`; adding `dotnet publish helper/SkyrimHelper -r linux-x64` to CI has no known blocker.

## What this means for skyrim-modding-tools-mcp

**Paths**
- Three bindings, one shape: Windows MO2, MO2 under Proton, Amethyst. All three have `mods/`,
  `overwrite/`, `profiles/<p>/{modlist,plugins,loadorder}.txt`; they differ in where settings live
  (`ModOrganizer.ini` vs `paths.json` + `deploy_state.json`) and in `*` semantics.
- Amethyst discovery: `~/.config/AmethystModManager/games/Skyrim Special Edition/paths.json`
  (`game_path`, `prefix_path` = `…/compatdata/489830/pfx`, `staging_path` or the legacy
  `~/.config/AmethystModManager/Profiles/Skyrim Special Edition`), active profile from
  `deploy_state.json`.
- MO2-under-Proton discovery: `~/.config/mo2-lint/state.json` (POSIX paths) when MO2-LINT made it;
  otherwise the user names the instance dir. Every path read from `ModOrganizer.ini` must be decoded
  (bare or `@ByteArray`, `\\`/`\`/`/`) and mapped through `<prefix>/dosdevices/<x>:` — `Z:` is
  usually `/` but not always; `C:` is `pfx/drive_c`. The prefix comes from `state.json`, the running
  process's `WINEPREFIX`, or `compatdata/489830/pfx`.
- Game-side files live in the prefix: `…/steamuser/AppData/Local/Skyrim Special Edition/plugins.txt`
  (Amethyst writes it only while deployed) and `…/steamuser/Documents/My Games/Skyrim Special Edition/`
  (INIs, `SKSE/` logs, crash logs, Papyrus logs).

**Helper binary**
- Publish `linux-x64` (self-contained or framework-dependent on Arch's `dotnet-runtime` 10.0.12); ICU
  must be present (`icu` is a hard dependency of the Arch runtime package). No Mutagen API the helper
  uses needs the registry.
- Localized strings/BSA lookups inside Mutagen match file names case-sensitively on Linux — test with
  vanilla `Skyrim.esm` (strings in BSAs) on a real Linux install.

**Game version**
- Replace `FileVersionInfo` with a PE `RT_VERSION` parser (StringFileInfo first, fixed info second);
  on Linux the current code returns `0.0.0.0`, which `headerVersion` would treat as pre-1.6.1130.

**Papyrus**
- On Linux there is no maintained, byte-identical compiler release today. Options in order of
  fidelity: CK `PapyrusCompiler.exe` in the game prefix via Proton/protontricks with .NET 3.5 (or Mono
  — pure IL, both UNVERIFIED); papyrusc 4.0 once released (linux-x64 NativeAOT, byte-identical gate);
  russo's compiler now (Linux build, MIT, but no flags file, single header dir, known differences).
- Import dirs must be found case-insensitively (`Scripts/Source`, `Source/Scripts`, lower-case variants).

**Mod-manager running / refresh**
- Amethyst: no refresh IPC and no watcher. A safe write is "add a new mod folder + prepend a new
  `+Name` line + add `*Plugin.esp` to plugins.txt and loadorder.txt"; the GUI keeps unknown modlist
  lines on its next save, but changes to lines it knows are overwritten. After writing, the user must
  press **Refresh and Deploy** (or the server runs `amethyst-mod-manager-cli deploy 489830 <profile>`,
  which restores and redeploys the whole profile — only when the GUI is closed, inference). Running =
  live socket at `$XDG_RUNTIME_DIR/amethyst-mod-manager.sock` or `pgrep -f run_qt`.
- While deployed, `<game>/Data` holds the real merged files (hardlinks); never write into `Data`
  directly — a restore moves unknown files to `overwrite/`.
- MO2 under Proton: detect by scanning `/proc/*/cmdline` for `ModOrganizer.exe` (comm is
  `ModOrganizer.ex`), map the Windows path with that process's `WINEPREFIX`, compare with the
  instance. Refresh = run `ModOrganizer.exe -p <profile> refresh` **inside that prefix with the same
  Proton** (`protontricks -c 'wine …' 489830` + `PROTON_VERSION`, or `proton run`); never when MO2 is
  not running. Runtime confirmation is still needed.
- Fluorine (if ever used): native process, same ini (Wine paths), same `refresh` CLI over a Unix socket.

**Case sensitivity**
- Every lookup in Data, mods and overwrite must be case-insensitive and must dedupe Amethyst's
  case-alias symlinks (same realpath). Resolution order is by lower-cased relative path.

**Local models**
- Behind Ollama, Claude Code loads every MCP tool upfront and cuts descriptions/instructions at 4,096
  chars — the `core` tool profile and the response budget matter most there. Default Ollama context is
  4k below 24 GiB VRAM; the server's instructions should not assume 64k. Keep argument schemas flat,
  no root `oneOf`/`anyOf`, no parameters named `type`/`description`/`properties`/`required`.
- oterm passes no env vars to stdio servers except six basics: configuration must be declarable in
  `env` (or a config file). Open WebUI needs the server's Streamable HTTP mode.

**Docker**: only with identical-path bind mounts and host PID access for MO2 detection; low value
over a native install.

**CI**: add a `dotnet publish -r linux-x64` job and run the helper's unit tests on ubuntu; pin
`ubuntu-24.04` or test 26.04 before November.

### Questions only the brother can answer
1. Which Amethyst build exactly: AUR `amethyst-mod-manager`, the `-no-update-check-git` fork, a source
   checkout (which branch: `main` or `Testing`), AppImage or Flatpak? (Flatpak changes config and
   socket paths.)
2. Deploy mode for Skyrim (hardlink, symlink or VFS) and whether case-alias symlinks are on.
3. Where his staging root is (`~/Games/Amethyst/Skyrim Special Edition` or `~/.config/AmethystModManager/Profiles/…`
   or custom), and his profile names; does he use profile-specific mods?
4. Steam library path and filesystem (btrfs default?), and which Proton version Skyrim uses.
5. For the MO2-under-Proton binding: does he (or will he) run MO2 at all, and via MO2-LINT, Jackify or
   by hand — i.e. where is the instance and which prefix?
6. Is SKSE 2.3.1 installed through Amethyst (with the launcher swap)? Does he want to stay on 1.7.104
   or downgrade?
7. Is the Creation Kit installed in his Steam library (vanilla `Scripts.zip` / `Source/Scripts`)? Is
   .NET 3.5 or Mono acceptable in his game prefix?
8. Which Ollama models and GPU VRAM; which MCP client he will use with them (Claude Code via
   `ollama launch claude`, ollmcp, oterm, Open WebUI); stdio or HTTP.
9. Does he run Amethyst while the server writes (GUI open), and is he willing to press Refresh/Deploy
   after each server write?
