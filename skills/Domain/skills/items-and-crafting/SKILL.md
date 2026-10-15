---
name: items-and-crafting
description: Weapons, armor, ammo, potions, ingredients, books, misc items, and crafting and tempering recipes in Skyrim SE. Use when creating or changing an item or recipe, or diagnosing one - invisible armor, a recipe missing at the workbench, an item that perks or merchants ignore.
---

# Items and crafting

Read [`REFERENCE.md`](REFERENCE.md) before touching an item record: it covers the item record types,
the keywords gameplay hangs on, armor and its addons, recipes, how an item reaches the player, and
the typical bugs. Fundamentals — FormIDs, overrides, patches — are in the `skyrim-modding-basics`
skill.

## Workflow

The loop in `skyrim-modding-basics` — look up, get the text, edit, build, deploy — with these for items:

- **Look up** with `types` from `WEAP`, `ARMO`, `ARMA`, `AMMO`, `ALCH`, `INGR`, `BOOK`, `MISC`, `COBJ`.
  An item's recipes are records of their own that point at it: `findRecords` with the item's editor ID
  as `text` and `types: ["COBJ"]` finds the crafting and the tempering recipe.
- **A new weapon or armor** starts from `readRecord` on a vanilla one of the same kind, and for armor
  on the addon its `Armature` lists too. Build in the order of the links: the addon, then the armor
  that lists it; the item, then its recipes and the leveled lists that hand it out. New meshes and
  textures go into `assets/`.
- **Done** when the item is built with every keyword its kind needs (REFERENCE, *Keywords carry the
  gameplay*) and a route brings it to the player (REFERENCE, *How an item reaches the player*).
- **Diagnosing**: `readRecord` with `allVersions: true` on the item and on its recipes, then match the
  symptom in REFERENCE, *Typical bugs*.
