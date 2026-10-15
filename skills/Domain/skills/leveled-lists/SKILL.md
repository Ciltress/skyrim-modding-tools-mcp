---
name: leveled-lists
description: Leveled item, NPC and spell lists in Skyrim SE - how the game picks from them, and why several mods editing one list conflict. Use when adding items, enemies or spells to the world, when loot, merchant stock or spawns look wrong, or when merging lists from several mods.
---

# Leveled lists

Read [`REFERENCE.md`](REFERENCE.md) before touching a leveled list: it covers the three list types,
how a pick works, where lists are used, the conflict problem and its fixes, and the typical bugs.
Fundamentals — overrides, patches — are in the `skyrim-modding-basics` skill.

## Workflow

The loop in `skyrim-modding-basics` — look up, get the text, edit, build, deploy — with these for lists:

- **Look up** with `types` from `LVLI`, `LVLN`, `LVSP`. To find the list that hands out a kind of
  thing, search by its editor-ID words (`text: "LItemWeapon"`, `"LCharBandit"`) and read candidates.
- **Adding to an existing list**: `addPatch` the list, then append your entries to the copy, every
  entry already in it kept. A new item or NPC goes into a list once a build has given it its FormID.
- **Other mods changing the same list**: `readRecord` with `allVersions: true` shows every version.
  Their additions belong in your copy too, or your override drops them (REFERENCE, *The conflict
  problem*).
- **Done** when built with the copy holding the winning version's entries, every other mod's
  additions you mean to keep, and yours.
- **Diagnosing**: `readRecord` with `allVersions: true` on the list and on any list nested in it, then
  match the symptom in REFERENCE, *Typical bugs*.
