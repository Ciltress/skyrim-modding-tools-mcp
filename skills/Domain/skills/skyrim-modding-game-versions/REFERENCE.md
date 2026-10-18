# Game versions — reference

## Game versions, SKSE builds, Address Library files

| Game version | SKSE build | Address Library's file, in `Data/SKSE/Plugins` |
| --- | --- | --- |
| 1.5.97 | 2.0.20 | `version-1-5-97-0.bin` |
| 1.6.640 | 2.2.3 | `versionlib-1-6-640-0.bin` |
| 1.6.1170 (Steam), 1.6.1179 (GOG) | 2.2.6 (a Steam and a GOG build) | `versionlib-1-6-1170-0.bin`, GOG's `versionlib-1-6-1179-0.bin` |
| 1.7.104 | 2.3.1 | `versionlib-1-7-104-0.bin` |

- `checkGameVersion` answers the game's version as `game.runtime`, read from `SkyrimSE.exe`.
- **SKSE** (Nexus mod 30379, skse.silverlock.org) offers one build per game version, Steam and GOG
  apart; Epic and the Windows Store have none. It lives in the **game folder**, beside
  `SkyrimSE.exe`: `skse64_loader.exe`, and `skse64_1_7_104.dll` named for its game version. The game
  runs SKSE only when started through `skse64_loader.exe`.
- **Address Library** (Nexus mod 32444) is a mod like any other: its "All in One" main file holds the
  `.bin` for every game version up to 1.7.104. 1.7.99 changed its database; plugins built for the
  old one may look addresses up wrong (*The rules*, `mayNotWork`).

## SKSE's log

SKSE rewrites `skse64.log` at every start through the loader: `Documents/My Games/Skyrim Special
Edition/SKSE/skse64.log` (`Skyrim Special Edition GOG` for GOG; under Proton, the prefix's
`drive_c/users/steamuser/Documents`). One line per DLL — `loaded correctly`, or why not: `disabled,
incompatible with current runtime version`, `no version data`. `checkGameVersion` uses it only when it
is this game folder's, of this game version, and no older than the DLL (`log.used`, `log.why`).

## The rules

What SKSE and Address Library do with a DLL in `Data/SKSE/Plugins`, as `checkGameVersion` judges it.
Each DLL counts once: the copy the game loads, from the highest mod that has it.

| Verdict | Means |
| --- | --- |
| `refusedAtLastStart` | SKSE's log says it did not load it. A fact, not a prediction. |
| `willNotLoad` | SKSE will refuse it, by the rules below. |
| `mayNotWork` | It loads, and may misbehave: try the game. |

A DLL **will not load** when it is:

- 32-bit — made for Skyrim LE.
- On 1.5.97: without the entry point 1.5.97's SKSE asks for — made for 1.6 or later.
- On 1.6 and later: without the version data SKSE 1.6+ reads — made for 1.5.97 only.
- Bound to game versions, and this one is not among them (`runtimes` names those it lists).
- Version-independent but built before 1.6.629 without saying it fits the newer game structs — or
  built for those structs, on a game before 1.6.629.
- Built on Address Library, while this game version's `.bin` is missing.
- Asking for a newer SKSE than the one installed.

A DLL **may not work** when it is built on Address Library, linked before 2025-05-26 without the flag
for 1.7.99's database, and the game is 1.7.99 or later. SKSE loads it; whether it finds the right game
code is open. Amethyst Mod Manager calls these incompatible; many still work.

## A fitting file

On the mod's page (`readNexusMod` → `files`), a file fits when its name, version or description names
this game version ("1.7.104"), or a range holding it — "1.6.1170+", or "NG" for a build on
CommonLibSSE-NG, which runs on several game versions — and it was `uploaded` after that version came
out: a range written earlier cannot know it. The 1.7 versions came out in August 2026 (SKSE's and
Address Library's builds for 1.7.104 were uploaded 2026-08-27). "AE" names the 1.6 versions.

A newer main file than the one installed (`listMods` → `nexus.version`) is the usual candidate; its
`requirements` may now name a newer SKSE. Whether it fits is settled by installing it and running
`checkGameVersion` again. When the page offers nothing, the mod's author has not
caught up: a replacement mod (`searchNexus`), or disabling it, is up to the user. So is the other way
round — the game kept at the version its mods are built for — which happens outside this server.

## Saves

- A save holds the scripts and data of every mod that ran, and SKSE keeps a co-save (`.skse`) beside
  each `.ess`. A mod disabled mid-playthrough leaves its traces orphaned: quests stall, items vanish,
  and a save can stop loading.
- The user keeps a copy of their latest save before any mod is updated or disabled, and tests on a
  copy. A new game is the safe test of a changed mod list.
- A `mayNotWork` DLL that finds the wrong game code can corrupt a save without crashing: another
  reason to test on a copy.
