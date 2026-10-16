---
name: magic
description: Spells, magic effects, enchantments, scrolls, shouts, and the effects potions share with them, in Skyrim SE. Use when creating or changing one, or diagnosing one - an effect that does nothing, a wrong cost, an enchantment missing at the table, a perk that doesn't apply.
---

# Magic

Read [`REFERENCE.md`](REFERENCE.md) before touching a magic record: it covers the effect chain,
spells, magic effects and their archetypes, enchantments, scrolls, shouts, how perks reach magic, and
the typical bugs. Fundamentals — FormIDs, overrides, patches — are in the `skyrim-modding-basics`
skill.

## Workflow

The loop in `skyrim-modding-basics` — look up, get the text, edit, build, deploy — with these for magic:

- **Look up** with `types` from `SPEL`, `MGEF`, `ENCH`, `SCRL`, `SHOU`, `BOOK` (spell tomes). A spell
  is its effects: resolve the `MGEF` FormIDs it lists with `findRecords` and `records`, and read the
  ones that matter, before reasoning about what it does.
- **A new spell** starts from `readRecord` on a vanilla spell of the same cast type and delivery, and
  reuses vanilla effects as they are. An effect that has to differ is a new `MGEF`: write it, and list
  it in the spell by its editor ID — the build writes in its FormID. A vanilla `MGEF` itself changes
  only when every spell, potion and enchantment using it should change with it.
- **A script effect's** `.psc` goes into `scripts/`; `buildProject` compiles it and fails on a
  compile error.
- **Done** when the spell is built, every effect's cast type and delivery match the spell's, and
  something gives it to the player — a spell tome, a merchant's list, a starting spell.
- **Diagnosing**: `readRecord` with `allVersions: true` on the spell *and* on each of its effects, then
  match the symptom in REFERENCE, *Typical bugs*.

## A new spell, as it builds

A Restoration spell that reuses a vanilla effect, and the spell tome that teaches it: two files in the
project's plugin folder, mirroring `FastHealing` and `SpellTomeFastHealing`. Each link is copied from
the record mirrored: the editor ID `readRecord` shows beside each of its FormIDs — the effect, the perk,
the menu art, the keywords. The tome's `Spell` is the new spell's own editor ID. The build writes all
their FormIDs. Neither file has a `FormKey` line: the build gives each new record its own.

```yaml
# plugin/Spells/MendingLight.yaml
EditorID: MendingLight
Name:
  TargetLanguage: English
  Value: Mending Light
MenuDisplayObject: MAGINVHealSpellArt
EquipmentType: EitherHand
BaseCost: 40
ChargeTime: 0.5
CastType: FireAndForget
TargetType: Self
HalfCostPerk: RestorationApprentice25
Effects:
- BaseEffect: RestoreHealthFFSelf
  Data:
    Magnitude: 75

# plugin/Books/SpellTomeMendingLight.yaml
EditorID: SpellTomeMendingLight
Name:
  TargetLanguage: English
  Value: 'Spell Tome: Mending Light'
Model:
  File: Clutter\Books\SpellTomeRestorationLowPoly.nif
BookText:
  TargetLanguage: English
  Value: Mending Light
Keywords:
- VendorItemBook
- VendorItemSpellTome
Flags:
- 0x4
Teaches:
  MutagenObjectType: BookSpell
  Spell: MendingLight
Value: 60
Weight: 1
InventoryArt: HighPolyRestorationBook
```

What the spell does, and its school, come from its effect: `RestoreHealthFFSelf` restores `Health`
in Restoration, cast Fire and Forget on Self from skill 25 — so the spell's `CastType` and
`TargetType` match it, and its `HalfCostPerk` is Restoration's Apprentice perk. For another effect,
find one with `findRecords` (`types: ["MGEF"]`) and read its `MagicSkill`, `CastType` and `TargetType`
before writing the spell around it. `Flags: [0x4]` is the bit every vanilla spell tome carries.

## A damage spell's lines

Destruction's damage spells name the vanilla effect of their element and casting. Write the spell as
the one above, with the row's lines; `EquipmentType: EitherHand` for all of them.

| Element | Like | `BaseEffect` | `CastType` | `TargetType` | `MenuDisplayObject` | `HalfCostPerk` |
|---|---|---|---|---|---|---|
| Fire | Flames | `FireDamageConcAimed` | `Concentration` | `Aimed` | `MAGINVFireballArt` | `DestructionNovice00` |
| Fire | Firebolt | `FireDamageFFAimed` | `FireAndForget` | `Aimed` | `MAGINVFireballArt` | `DestructionApprentice25` |
| Fire | Fireball | `FireDamageFFAimedArea` | `FireAndForget` | `Aimed` | `MAGINVFireballArt` | `DestructionAdept50` |
| Frost | Frostbite | `FrostDamageConcAimed` | `Concentration` | `Aimed` | `MAGINVIceSpellArt` | `DestructionNovice00` |
| Frost | Ice Spike | `FrostDamageFFAimed` | `FireAndForget` | `Aimed` | `MAGINVIceSpellArt` | `DestructionApprentice25` |
| Frost | Ice Storm | `FrostDamageFFAimedArea` | `FireAndForget` | `Aimed` | `MAGINVIceSpellArt` | `DestructionAdept50` |
| Shock | Sparks | `ShockDamageConcAimed` | `Concentration` | `Aimed` | `MAGINVShockSpellArt` | `DestructionNovice00` |
| Shock | Lightning Bolt | `ShockDamageFFAimed` | `FireAndForget` | `Aimed` | `MAGINVShockSpellArt` | `DestructionApprentice25` |
| Shock | Chain Lightning | `ShockDamageFFAimedArea` | `FireAndForget` | `Aimed` | `MAGINVShockSpellArt` | `DestructionAdept50` |

A Firebolt-like spell's lines, in place of the Restoration ones above:

```yaml
MenuDisplayObject: MAGINVFireballArt
EquipmentType: EitherHand
CastType: FireAndForget
TargetType: Aimed
HalfCostPerk: DestructionApprentice25
Effects:
- BaseEffect: FireDamageFFAimed
  Data:
    Magnitude: 25
```

A concentration spell's effect takes `Duration: 1` beside its `Magnitude`, and an area spell's takes
`Area` (15 for Fireball). The vanilla spells list the Destruction perks' effects after the damage —
`PerkImpactStaggerPushFFAimed` and the like; a new spell does its damage without them.
