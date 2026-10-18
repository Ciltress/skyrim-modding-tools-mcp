---
name: skyrim-modding-game-versions
description: SKSE plugins, Address Library and the game version - finding the mods that do not fit the installed Skyrim SE, and fixing each with a fitting file or, on the user's word, disabling it. Use after a game update, when checkGameVersion or healthcheck reports problems, or when an SKSE mod does nothing in the game.
---

# Mods that do not fit the game version

A game update breaks SKSE plugins (`.dll`), never plugins or scripts. The fix for a broken one is a
**fitting file** — a build of the same mod made for this game version — installed over it. Disabling
is the fallback, and happens only on the **user's word**, asked for each mod. The rules
`checkGameVersion` applies, the file names and the Nexus pages are in [`REFERENCE.md`](REFERENCE.md).

## Workflow

0. **Keep a save.** Before anything changes, tell the user to copy their latest save: a mod disabled
   or updated mid-playthrough can break it (REFERENCE, *Saves*). Done when the user has heard it.
1. **Check.** `checkGameVersion`. Done when you know, from its answer:
   - `skse`: installed and `forThisRuntime`. If not, that comes first — no SKSE plugin loads
     without it. SKSE goes into the game folder, which the user does by hand: give them `skse.note`.
   - `addressLibrary.installed`. If not, install Address Library like any mod (Nexus mod 32444,
     its "All in One" main file), then check again.
   - `problems`: each plugin's `mod`, `verdict`, `reason` and `nexusModId`.
2. **Find a fitting file**, for each mod in `problems` whose verdict is `refusedAtLastStart` or
   `willNotLoad`:
   - `listMods` with `text` set to the mod's name and `details: true`: the version and file installed.
   - `readNexusMod` with its `nexusModId` — without one, `searchNexus` by the mod's name and confirm
     the page with the user. A fitting file names this game version, a range holding it, or Address
     Library after 1.7.99 (REFERENCE, *A fitting file*). Check its `requirements` too: a newer build
     may need a newer SKSE or another mod.
   - Done when each mod has a fitting file, or you know it has none.
3. **Install it** over the mod: get it with `downloadNexusFile` (or the user downloads it), then
   `installMod` with `file`, `replace: true` and `name` set to the mod's name exactly as
   `checkGameVersion` gives it — without `name`, the file installs as a second mod beside the broken
   one. For a FOMOD installer, choose the options the installed mod has: its plugins (from step 2's
   `listMods`) show which patches and variants were chosen, and option names often name them; ask the
   user about the rest. Done when it succeeds with no `missingMasters`.
4. **Ask about the rest.** For a mod with no fitting file, tell the user what it does (the page's
   summary), that the game will not load its DLL, and ask whether to disable it. On their yes for
   this mod, `disableMod` with its name. Its `missingMasters` names mods whose plugins now stop the
   game from starting: tell the user, and disable each only on another yes. A `mayNotWork` mod loads
   and often still works: the user tries the game first, and it is updated when a fitting file
   exists, disabled only when they report it broken.
5. **Check again.** `checkGameVersion`. Done when every problem left is one the user decided to keep.
6. **Report**: the mods updated, disabled and kept, and each `modManager.nextStep`. The user starts
   the game with `skse64_loader.exe`; SKSE's log of that start makes the next check exact.
