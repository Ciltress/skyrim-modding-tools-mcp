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
  on the addon its `Armature` lists too. A new record that points at another new one — the armor at
  its addon, a recipe at its item, an enchanted weapon at its enchantment — names it by its editor ID;
  one build gives both their FormIDs and writes the link. New meshes and textures go into `assets/`.
- **Done** when the item is built with every keyword its kind needs (REFERENCE, *Keywords carry the
  gameplay*) and a route brings it to the player (REFERENCE, *How an item reaches the player*).
- **Diagnosing**: `readRecord` with `allVersions: true` on the item and on its recipes, then match the
  symptom in REFERENCE, *Typical bugs*.

## A new weapon, as it builds

A war axe and its forge recipe: two files in the project's plugin folder, mirroring `IronWarAxe` and
`RecipeWeaponIronWarAxe`. Each link is copied from the record mirrored: the editor ID `readRecord`
shows beside each of its FormIDs — keywords, sounds, impact set, materials. The recipe's
`CreatedObject` is the new axe's own editor ID. The build writes all their FormIDs. Neither file has a
`FormKey` line: the build gives each new record its own.

```yaml
# plugin/Weapons/AshenHatchet.yaml
EditorID: AshenHatchet
Name:
  TargetLanguage: English
  Value: Ashen Hatchet
Model:
  File: Weapons\Iron\WarAxe.nif
EquipmentType: RightHand
Keywords:
- WeapMaterialIron
- WeapTypeWarAxe
- VendorItemWeapon
ImpactDataSet: WPNzAxeImpactSet
FirstPersonModel: 1stPersonIronWarAxe
EquipSound: WPNAxe1HandDrawSD
UnequipSound: WPNAxe1HandSheatheSD
BasicStats:
  Value: 45
  Weight: 10
  Damage: 9
Data:
  AnimationType: OneHandAxe
  Speed: 0.9
  Reach: 1
  Skill: OneHanded
  Stagger: 0.85
Critical:
  Damage: 4
  PercentMult: 1

# plugin/ConstructibleObjects/RecipeAshenHatchet.yaml
EditorID: RecipeAshenHatchet
Items:
- Item:
    Item: IngotIron
    Count: 2
- Item:
    Item: LeatherStrips
    Count: 1
CreatedObject: AshenHatchet
WorkbenchKeyword: CraftingSmithingForge
CreatedObjectCount: 1
```

Another kind of weapon mirrors the iron one of its kind the same way. Its lines that differ by kind:

| Kind | Mirror | `AnimationType` | `WeapType…` keyword | `EquipmentType` | `ImpactDataSet` |
|---|---|---|---|---|---|
| Sword | `IronSword` | `OneHandSword` | `WeapTypeSword` | `RightHand` | `WPNzBlade1HandImpactSet` |
| Dagger | `IronDagger` | `OneHandDagger` | `WeapTypeDagger` | `RightHand` | `WPNzBlade1HandImpactSet` |
| War axe | `IronWarAxe` | `OneHandAxe` | `WeapTypeWarAxe` | `RightHand` | `WPNzAxeImpactSet` |
| Mace | `IronMace` | `OneHandMace` | `WeapTypeMace` | `RightHand` | `WPNzBluntImpactSet` |
| Greatsword | `IronGreatsword` | `TwoHandSword` | `WeapTypeGreatsword` | `BothHands` | `WPNzBlade2HandImpactSet` |
| Battleaxe | `IronBattleaxe` | `TwoHandAxe` | `WeapTypeBattleaxe` | `BothHands` | `WPNzAxeLargeImpactSet` |
| Warhammer | `IronWarhammer` | `TwoHandAxe` | `WeapTypeWarhammer` | `BothHands` | `WPNzBlunt2HandImpactSet` |
| Bow | `LongBow` | `Bow` | `WeapTypeBow` | `BothHands` | `WPNzArrowImpactSet` |

Its `Model`, `FirstPersonModel`, `EquipSound` and `UnequipSound` are the mirrored weapon's, as
`readRecord` shows them; `Data`'s `Skill` is `OneHanded`, `TwoHanded` or `Archery`.

## An enchanted weapon

A weapon names its enchantment as `ObjectEffect`, and holds its charge as `EnchantmentAmount` — 500
on the vanilla `EnchIronSwordFire01`. The enchantment is a vanilla one, named as it is, or a new one
in `ObjectEffects/` that names the vanilla effect of its element:

| Element | Vanilla enchantment | Its `BaseEffect` |
|---|---|---|
| Fire | `EnchWeaponFireDamage01` | `EnchFireDamageFFContact` |
| Frost | `EnchWeaponFrostDamage01` | `EnchFrostDamageFFContact` |
| Shock | `EnchWeaponShockDamage01` | `EnchShockDamageFFContact` |

A new frost enchantment, and the weapon's two lines that carry it:

```yaml
# plugin/ObjectEffects/EnchRimeEdge.yaml
EditorID: EnchRimeEdge
Name:
  TargetLanguage: English
  Value: Rime Edge
CastType: FireAndForget
TargetType: Touch
EnchantType: Enchantment
Effects:
- BaseEffect: EnchFrostDamageFFContact
  Data:
    Magnitude: 10

# in the weapon's file
ObjectEffect: EnchRimeEdge
EnchantmentAmount: 500
```

A weapon's enchantment is cast `FireAndForget` on `Touch`, as its effects are; the build refuses one
cast otherwise.
