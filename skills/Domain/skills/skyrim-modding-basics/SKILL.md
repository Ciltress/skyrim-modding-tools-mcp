---
name: skyrim-modding-basics
description: How Skyrim SE mods work - plugins, masters, FormIDs, load order versus mod order, overrides and conflicts, light plugins, archives, game versions and SKSE, Mod Organizer. Read before any authoring or analysis; when a FormID, load-order or conflict question comes up; when a game-version or SKSE mismatch is suspected; or to choose an external tool such as xEdit or the Creation Kit.
---

# Skyrim modding basics

The model every other skill on this server builds on. Hold these in mind on every task; the detail
is in [`REFERENCE.md`](REFERENCE.md).

## The model in eight lines

1. The game loads **plugins** (`.esm`, `.esp`, `.esl`) in **load order**. Each holds **records**.
2. A record's identity is its **FormID**: the plugin that first defined it plus a local number, written
   `087835:Skyrim.esm`. The hex FormID seen in game prefixes a load-order slot and moves with it.
3. A later plugin **overrides** a record by carrying its own complete copy. The last override in load
   order wins *whole* — fields are never merged. Two disagreeing overrides are a **conflict**, and the
   loser's changes are gone.
4. A plugin can only reference and override records of its **masters**, which must load before it.
5. **Light plugins** (ESL-flagged) take no slot in the 254-plugin limit and hold at most 4,096 new
   records. A new project is a light plugin until it outgrows that.
6. Mod Organizer keeps every **mod** in its own folder and shows the game one virtual `Data` folder.
   **Mod order** decides which *file* wins; load order decides which *record* wins.
7. SKSE plugins (`.dll`) are bound to one game version; plugins and Papyrus scripts are not.
8. Scripts and their variables live in the player's save, so a scripted mod is never safely removed
   mid-playthrough.

## How a mod is authored here

A mod is a **project**: text in git, one file per record, built into a plugin and deployed into the
instance. Change a record by editing its text file with your standard file tools — read, edit, write
— and leave the built plugin to the build. When a fix touches someone else's record, write the
override into your own project: a patch survives the other mod's next update, an edit to its plugin
does not.

## Where to look next

- [`REFERENCE.md`](REFERENCE.md) — plugins and flags, FormIDs, load order, overrides and patches,
  mod order and archives, game versions and SKSE, Papyrus and saves, where errors show up, the
  Creation Kit's role.
- [`TOOLS.md`](TOOLS.md) — the community's tools, what each is for, and when to send the user to one.
- Record families, one skill each: `items-and-crafting`, `magic`, `npcs`, `leveled-lists`.

<!-- STEP 2: add the tool workflow (look up, build, deploy, pull) once the tools exist. -->
