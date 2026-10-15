# NPCs — reference

<!-- STEP 2: add each record's shape in a project (Spriggit YAML) once the spike produces real output. -->

## The records around an NPC

```
NPC_  Lydia  ───── race (RACE) · class (CLAS) · voice type (VTYP) · combat style (CSTY)
  │               factions (FACT, with rank) · outfits (OTFT) · AI packages (PACK)
  │               spells (SPEL, LVSP) · perks (PERK) · inventory (items, LVLI) · death item (LVLI)
  │               template (NPC_ or LVLN) · head parts · face data → FaceGen files
  └─ ACHR  one placed Lydia in a cell (a reference)
```

The `NPC_` is the **base record**. Where she stands is an `ACHR` **reference** in a cell. Most mods
change the base; a quest that needs *this* Lydia points at the reference.

## The NPC record

| Area | Fields | Notes |
| --- | --- | --- |
| **Flags** | Female, Essential, Protected, Unique, Respawn, Summonable, Auto-calc stats, PC level mult, Simple actor, Invulnerable, Doesn't bleed… | *Essential*: can't die, falls to bleedout. *Protected*: only the player can kill. *Unique*: one of her. *Respawn*: generic NPCs in respawning cells |
| **Level** | A fixed level, or *PC level mult* with a minimum and maximum | Spawned NPCs are further shaped by the cell's encounter zone |
| **Stats** | Health, magicka, stamina, skills | With *Auto-calc stats*, derived from class, race and level; offsets on top |
| **Identity** | Race, class, voice type, name, short name | |
| **Inventory** | Items and leveled lists, death item | Gold, gear; death item is extra loot on death |
| **Outfits** | Default outfit, sleep outfit | What she wears, separately from what she carries |
| **Magic** | Spells and leveled spells, perks | Racial abilities come from the race, not here |
| **Factions** | Faction + rank | Who she belongs to; drives hostility, crime, vendors |
| **AI** | Aggression, confidence, morality, assistance, mood; AI packages; combat style | |
| **Appearance** | Head parts (hair, eyes, brows, beard), face morphs, tint layers, height, weight, skin | Needs matching FaceGen files (below) |
| **Template** | Another NPC or a leveled NPC list, plus *template flags* | See the next section |

## Templates

An NPC can take parts of itself from a **template** — another NPC or a leveled NPC list (`LVLN`).
Thirteen **template flags** pick which parts: *Traits, Stats, Factions, Spell List, AI Data, AI
Packages, Model/Animation, Base Data, Inventory, Script, Default Pack List, Attack Data, Keywords*.

**A field covered by a set template flag is ignored on the NPC itself.** Editing a bandit's inventory
does nothing while *Inventory* comes from its template — change the template, or clear the flag. This
is the most common "my edit has no effect" on generic NPCs.

## FaceGen

The game does not build faces from the record at runtime. It loads pre-generated files:

```
meshes\actors\character\FaceGenData\FaceGeom\<plugin>\<FormID>.nif
textures\actors\character\FaceGenData\FaceTint\<plugin>\<FormID>.dds
```

`<plugin>` is the plugin that **first defined** the NPC — `Skyrim.esm` for Lydia, even when another
mod changes her — and `<FormID>` is her local number as eight hex digits (`000A2C94.nif`).

- Change any appearance field — race, head parts, morphs, tints, weight — and the FaceGen files must be
  **regenerated**, in the Creation Kit (select the NPC, *Ctrl+F4*). A project can't produce them
  without the Creation Kit; plan a manual step.
- **Dark face** (or grey face): the files don't match the record that wins. The classic cause is two
  appearance mods where **mod order** gives one mod's FaceGen files while **load order** gives the
  other's record. Fix by aligning both orders, or let EasyNPC build a consistent set.

## Outfits and inventory

- An **outfit** (`OTFT`) is a list of armor and leveled lists the NPC wears; the default outfit is
  equipped on load, the sleep outfit in bed.
- **Inventory** is what she carries: weapons, gold, potions. Weapons in the inventory get equipped;
  armor there usually does not, unless better than the outfit.
- A save keeps an actor's equipped outfit. Changing the outfit record does not redress an NPC the
  player has already met; a script's `SetOutfit` does.

## Factions

- **Membership** with a rank. Rank `-1` reads as "not a member" in conditions — vanilla uses it to mark
  *potential* membership, e.g. `CurrentFollowerFaction`.
- **Relations** between factions — neutral, enemy, ally, friend — decide who fights whom.
- **Crime faction**: whose guards track the bounty for crimes against her.
- **Vendors** are set up on a faction: what it buys (a form list of keywords), the merchant container
  holding stock, hours.

## AI packages

- An NPC's **AI packages** run the first one whose conditions and schedule pass, top of the list first.
  **Quest alias packages** sit above her own and win while the quest runs.
- Packages come from templates — *Sandbox*, *Travel*, *Sleep*, *Eat*, *Sit*, *Follow*, *Escort*… —
  with a location, a schedule and conditions.
- Changes apply when the AI re-evaluates; a script forces it with `EvaluatePackage()`.

## Race, class, voice type

- **Race**: skeleton, body, base stats, racial abilities, which voice types fit. A *new* race is
  expensive: every armor addon, hair and dialogue condition in the game is written for vanilla races.
  Prefer a vanilla race.
- **Class**: skill weights and how health, magicka and stamina grow — only matters with *Auto-calc
  stats*.
- **Voice type**: generic dialogue — greetings, combat, follower lines — is filtered by voice type. A
  new voice type has none of it. Pick a vanilla voice type that already has the lines the NPC needs.

## Followers

The vanilla recipe:

- membership in `PotentialFollowerFaction` (rank 0) and in `CurrentFollowerFaction` at rank `-1`;
- a voice type with follower dialogue;
- for some NPCs, a friendly relationship with the player first.

The follower framework then offers the recruit dialogue. Follower mods (NFF, AFT…) add their own
factions on top.

## What a save keeps

Once the player has met an NPC, the save holds her runtime state: inventory, equipped outfit, changed
factions, actor values, position, death. Base-record edits to those parts won't show in that save.
Test NPC changes on a new game, or from the main menu with `coc <cell>`.

## Distribution instead of edits

To give *many* NPCs a spell, perk, item, outfit or faction, prefer **SPID** (`*_DISTR.ini`, matched by
faction, race, keyword, level…) over overriding each NPC. Overrides conflict with every other mod
touching those NPCs; SPID applies at runtime without overriding anything. Edit records for *specific*
NPCs.

## Typical bugs

| Symptom | Usual cause |
| --- | --- |
| Dark or grey face | FaceGen files don't match the winning record: mod order and load order disagree, or appearance changed without regenerating |
| Edit has no effect | A template flag covers the field; a later plugin overrides the NPC; or the save kept her state |
| Wrong clothes | Outfit vs inventory confusion; or the save kept the old outfit |
| Won't do what her packages say | A higher package or a quest alias package wins; conditions or schedule fail; no re-evaluation yet |
| No greetings or combat lines | A new or unusual voice type |
| Can't be recruited | Missing follower factions, unsuitable voice type, relationship too low |
| Dies though she should not | Neither *Essential* nor *Protected*; or a quest alias set the flag only while running |
| Level wildly off | PC-level multiplier limits, or the encounter zone of where she spawns |

## Sources

- UESP, *Mod File Format*: [NPC_](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/NPC_)
- The Creation Kit wiki (ck.uesp.net): *Actor*, *Faction*, *Outfit*, *Package*, *Class*, *Race*
