---
name: skyrim-modding-basics
description: How Skyrim SE mods work - plugins, masters, FormIDs, load order versus mod order, overrides and conflicts, light plugins, archives, game versions and SKSE, mod managers (Mod Organizer, Amethyst). Read before any authoring, analysis or installing a mod; when a FormID, load-order or conflict question comes up; when a game-version or SKSE mismatch is suspected; or to choose an external tool such as xEdit or the Creation Kit.
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
6. The mod manager — Mod Organizer, or Amethyst on Linux — keeps every **mod** in its own folder
   and shows the game one `Data` folder layered from them.
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

## The workflow

Every authoring task runs this loop.

0. **Read the skill of the records you will write**, with `readSkill`: `items-and-crafting` for weapons,
   armor, other items, their enchantments and recipes; `magic` for spells, magic effects and
   enchantments; `npcs`; `leveled-lists`. Each holds the vanilla records and values its records are
   written with. Done when you have read every family the task touches.
1. **Look up.** `findRecords` by name — `text`, narrowed with `types` such as `["WEAP"]` — or by
   FormID and editor ID with `records`. Done when you hold the FormID of every record you will change
   or point at.
2. **Get the text.**
   - A record of the base game or another mod: `addPatch` copies its winning version into the project
     and answers each copy's path and text.
   - A new record: `newProject` once, then write the file where its answer's `writeRecordsTo` says —
     the project's plugin folder, in the type's group folder — mirroring a vanilla record of the same
     type read with `readRecord`: the same field names and nesting, other values. Leave out `FormKey`.
   - One of the project's own records: its file is already there.
3. **Edit** with your file tools — only the fields the task names; the rest stays as copied. Take every
   link — FormID or editor ID — from a record you read or a `findRecords` answer. Scripts and files such as meshes have folders of their own
   ([`REFERENCE.md`](REFERENCE.md), *What a project looks like*).
4. **Build.** `buildProject`. New records get their FormIDs here, answered in `assignedFormIds`. A
   link to a record — a new one of the project, or a vanilla one — may be written as its editor ID
   (`ObjectEffect: MyEnchantment`): the build writes that record's FormID into the file and lists it
   in `resolvedLinks`. A link it cannot resolve, or a broken one, fails the build with the list of
   offenders: fix each and build again. Done when the build succeeds.
5. **Deploy**, when the user wants the mod in the game: `deployProject`. Done when it succeeds and the
   user has heard its `modManager.nextStep`, if it has one.
6. **Pull** after the user worked on the deployed plugin in the Creation Kit or xEdit: commit the
   project, `pullProject`, review `git diff`, then build and deploy.

When a change has no effect in game, `readRecord` with `allVersions: true` shows which plugin wins.

## Installing someone else's mod

`listMods` says what is installed already — by name, with each mod's Nexus `modId` — so look
there before installing a mod or a requirement twice.

1. **Check it.** `searchNexus`, then `readNexusMod`: its `requirements` and `dlcRequirements` must be
   in the instance first — install those first, the same way. Without these tools (no Nexus API key),
   ask the user what the mod page says it needs.
2. **Get the file.** `downloadNexusFile` with the main file's `fileId`, plus optional files the user
   wants. Without that tool (no premium account), the user downloads it into the downloads folder.
3. **Install.** `installMod` with the file. A FOMOD installer answers its steps first: choose with the
   user where it matters, then call again with `choices`. Done when it succeeds, `missingMasters` is
   empty, and the user has heard `modManager.nextStep`, if there is one.

## Where to look next

- [`REFERENCE.md`](REFERENCE.md) — plugins and flags, FormIDs, load order, overrides and patches,
  mod order and archives, game versions and SKSE, Papyrus and saves, where errors show up, the
  Creation Kit's role.
- [`TOOLS.md`](TOOLS.md) — the community's tools, what each is for, and when to send the user to one.
- Record families, one skill each: `items-and-crafting`, `magic`, `npcs`, `leveled-lists`.
