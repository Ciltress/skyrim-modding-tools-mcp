# Items and crafting — reference

<!-- STEP 2: add each record's shape in a project (Spriggit YAML) once the spike produces real output. -->

## The record types

| Signature | Record | Key fields |
| --- | --- | --- |
| `WEAP` | Weapon | animation type, damage, speed, reach, stagger, critical data, enchantment + charge, template |
| `ARMO` | Armor | biped slots, armor type, armor rating, armor addons, enchantment, template |
| `ARMA` | Armor addon | the meshes per race and sex; biped slots |
| `AMMO` | Arrow or bolt | projectile, damage, "non-bolt" flag |
| `ALCH` | Potion, poison, food | effects (magnitude, duration), flags: food, medicine, poison |
| `INGR` | Ingredient | four effects |
| `BOOK` | Book, note, spell tome | text; flags: teaches skill / teaches spell, can't be taken |
| `MISC` | Misc item | value, weight — ingots, gems, clutter |
| `KEYM` | Key | |
| `SLGM` | Soul gem | capacity, current soul |
| `COBJ` | Constructible object | a recipe: created item, count, workbench keyword, components, conditions |

Every item carries a **name**, a **model**, **value** (gold), **weight**, **keywords**, pick-up and
put-down sounds. **Non-playable** items (a flag) exist but never show in an inventory — creature skins,
hidden tokens.

## Keywords carry the gameplay

Perks, merchants, the crafting menus and the enchanting table do not look at an item's type; they
look at its **keywords**. A new item without the right ones is silently left out.

| Concern | Keywords (vanilla) | What breaks without them |
| --- | --- | --- |
| Weapon type | `WeapTypeSword`, `WeapTypeDagger`, `WeapTypeWarAxe`, `WeapTypeMace`, `WeapTypeGreatsword`, `WeapTypeBattleaxe`, `WeapTypeWarhammer`, `WeapTypeBow`, `WeapTypeStaff` | Weapon perks (Bladesman, Bone Breaker…) don't apply |
| Armor type | `ArmorLight`, `ArmorHeavy`, `ArmorClothing` | Armor perks; must agree with the record's armor type |
| Armor slot | `ArmorCuirass`, `ArmorHelmet`, `ArmorGauntlets`, `ArmorBoots`, `ArmorShield`; `ClothingBody`, `ClothingHead`, `ClothingHands`, `ClothingFeet`, `ClothingRing`, `ClothingNecklace` | Perks and enchantments limited to a slot |
| Material | `WeapMaterial…`, `ArmorMaterial…` (`Iron`, `Steel`, `Elven`, `Glass`, `Ebony`, `Daedric`…) | Smithing perks double tempering only for their material |
| Merchants | `VendorItemWeapon`, `VendorItemArmor`, `VendorItemClothing`, `VendorItemJewelry`, `VendorItemPotion`, `VendorItemPoison`, `VendorItemFood`, `VendorItemIngredient`, `VendorItemBook`, `VendorItemSpellTome`, `VendorItemGem`, `VendorItemOreIngot`, `VendorItemAnimalHide`, `VendorItemClutter` | Merchants refuse to buy it |
| Enchanting | `MagicDisallowEnchanting` | (set it on unique items that must not be disenchanted or enchanted) |

Copy the keyword set from the vanilla item yours is closest to, then adjust.

## Weapons

- **Animation type** decides how it is held and swung: one-handed sword, dagger, axe, mace;
  two-handed sword, axe (warhammers too), bow, crossbow, staff.
- **Damage, speed, reach, stagger** in the data; **critical** damage, multiplier and an optional
  critical spell separately.
- **Enchantment** plus **charge** (`EAMT`): a weapon enchantment is spent per hit.
- **Template**: vanilla's enchanted variants (`EnchIronSwordFire01`…) name their base weapon as
  template. A balance change to a base weapon usually belongs on every variant too — check them.
- Bows and crossbows take their projectile from the **ammo**, not the weapon.

## Armor and armor addons

An `ARMO` is the item in the inventory. What is *drawn* on the body is one of its **armor addons**
(`ARMA`), chosen by the wearer's race:

```
ARMO  ArmorIronCuirass        slots: 32 Body · type: heavy · rating · keywords · value · weight
 └─ ARMA IronCuirassAA        slots: 32 · races: DefaultRace + Nord, Imperial, Breton, … (not beast races)
 │       models: male / female, 3rd person / 1st person
 └─ ARMA IronCuirassArgonianAA   races: Argonian
```

- The game draws the first addon whose race list contains the wearer's race. **No matching addon →
  the piece is invisible** on that race. Custom races need their own addon or a race listed here.
- **Biped slots** say what the piece occupies and hides. The `ARMO` and its addons should agree.
  Wearing two items on one slot unequips the first.
- **Weight slider**: with the addon's weight flag set, the game blends `mesh_0.nif` (thin) and
  `mesh_1.nif` (heavy). Ship both, or the piece vanishes.
- **Armor type** (light, heavy, clothing) lives in the record *and* in the keyword; keep them equal.

### Biped slots

| Slot | Use | Slot | Use |
| --- | --- | --- | --- |
| 30 | Head | 38 | Calves |
| 31 | Hair | 39 | Shield |
| 32 | Body | 40 | Tail |
| 33 | Hands | 41 | Long hair |
| 34 | Forearms | 42 | Circlet |
| 35 | Amulet | 43 | Ears |
| 36 | Ring | 44–49, 52–60 | Free for mods |
| 37 | Feet | 50, 51, 61 | Decapitation, FX |

## Potions, poisons, food, ingredients

- An `ALCH` is a list of **magic effects** with magnitude and duration — the same effects spells use
  (see the `magic` skill). Flags mark **food**, **medicine** and **poison**; a poison needs the poison
  flag and hostile effects.
- An `INGR` has exactly four effects; the player learns them by eating and brewing. Alchemy brewing
  is not a recipe record — it combines ingredients by shared effects.

## Books

- The text is the book's description, with a small markup: `<p align="center">`, `<font size="…">`,
  `<b>`, `<i>`, `<br>`, `[pagebreak]`, and `<img src="img://…">`.
- **Teaches skill** raises a skill once; **teaches spell** makes a spell tome; **can't be taken** keeps
  it on its shelf.

## Recipes: constructible objects

A `COBJ` is one recipe: **created object**, **count**, **workbench keyword**, **components** (items and
counts) and **conditions**.

| Workbench keyword | Station | Created object |
| --- | --- | --- |
| `CraftingSmithingForge` | Forge | a new item |
| `CraftingSmithingSkyforge` | Skyforge | a new item |
| `CraftingSmithingSharpeningWheel` | Grindstone | the weapon itself — tempering |
| `CraftingSmithingArmorTable` | Workbench | the armor itself — tempering |
| `CraftingSmelter` | Smelter | ingots |
| `CraftingTanningRack` | Tanning rack | leather, strips |
| `CraftingCookpot` | Cooking pot | food |

- **Conditions** gate a recipe, run on the player: `HasPerk <material smithing perk> == 1`, and in
  vanilla also `GetItemCount <material> >= 1`, which keeps a recipe hidden until the player holds
  some of the material. A recipe whose conditions fail is not listed at all.
- A recipe **missing at the station** is nearly always the wrong workbench keyword or a failing
  condition.
- A **tempering** recipe has the item itself as created object and its material as components. Without
  one, an item cannot be improved.
- Alchemy and enchanting are not recipes.

## How an item reaches the player

A new item that nothing places is unobtainable. Plan the route:

- **A reference** in a cell — one sword on one table. Unique items.
- **A container's inventory** — a chest, a merchant's chest.
- **A leveled list** — loot, merchant stock, NPC gear; see the `leveled-lists` skill. Changing a vanilla
  list is an override and conflicts with every other mod changing it.
- **A recipe** — crafted at a station.
- **SPID or a script** — added to NPCs or the player at runtime, conflict-free.

## Typical bugs

| Symptom | Usual cause |
| --- | --- |
| Armor invisible on some races | No addon with that race in its race list |
| Armor invisible on everyone | A missing mesh, or the weight-slider pair `_0`/`_1` incomplete |
| Body disappears under a piece | The piece occupies slot 32 without drawing a body |
| Perks don't affect a weapon or armor | Missing type or material keyword |
| Merchants won't buy it | Missing `VendorItem…` keyword, or value 0 |
| Recipe missing at the forge | Workbench keyword, a failing condition, or no components on hand |
| Can't temper an item | No tempering recipe for it |
| Item unobtainable | Nothing places it — no reference, container, list, recipe or distribution |
| A change has no effect | A later plugin overrides the same item; or a merchant's stock was rolled earlier in the save |

## Sources

- UESP, *Mod File Format*: [WEAP](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/WEAP),
  [ARMO](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/ARMO),
  [COBJ](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/COBJ)
- The Creation Kit wiki (ck.uesp.net): *Weapon*, *Armor*, *Armor Addon*, *Constructible Object*
