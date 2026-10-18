---
name: skyrim-modding-magic
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
- **A new spell names a vanilla effect** from the tables below, as it is. The effect is *what* the
  spell does, shared by every spell that names it; *how strongly* is the spell's own `Magnitude`,
  `Area` and `Duration`, under each effect's `Data`: a 40-point frost bolt names `FrostDamageFFAimed`
  with `Magnitude: 40`. A new `MGEF` is only for what no vanilla effect does: write it, and name it in
  the spell by its editor ID. A vanilla `MGEF` itself changes only when every spell, potion and
  enchantment using it should change with it.
- **A script effect's** `.psc` goes into `scripts/`; `buildProject` compiles it and fails on a
  compile error.
- **Done** when the spell is built, every effect's cast type and delivery match the spell's, and
  something gives it to the player — a spell tome, a merchant's list, a starting spell.
- **Diagnosing**: `readRecord` with `allVersions: true` on the spell *and* on each of its effects, then
  match the symptom in REFERENCE, *Typical bugs*.

## A new spell, as it builds

A Restoration spell that reuses a vanilla effect: one file in the project's plugin folder, mirroring
`FastHealing`. Each link is copied from the record mirrored: the editor ID `readRecord` shows beside
each of its FormIDs — the effect, the perk, the menu art. The build writes their FormIDs. The file has
no `FormKey` line: the build gives the new record its own.

```yaml
# <project>/plugin/Spells/MendingLight.yaml
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
```

When the spell should be learned from a book, a spell tome teaches it: a second file, mirroring
`SpellTomeFastHealing`, whose `Spell` is the new spell's own editor ID. Its `Model` and `InventoryArt`
are its school's — `SpellTomeDestructionLowPoly.nif` and `HighPolyDestructionBook` for Destruction, and
likewise Restoration, Alteration, Conjuration and Illusion.

```yaml
# <project>/plugin/Books/SpellTomeMendingLight.yaml
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
the one above, with the row's lines; `EquipmentType: EitherHand` for all of them. These are
Skyrim.esm's records, in every load order: write them as they are, with no search.

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

## Every school's everyday spells

The other spells a mod most often makes, each like the vanilla one named — its effect, cast,
delivery, menu art and perk, and the `Data` its effect takes. `readRecord` leaves out a value at its
default, so a vanilla spell cast on `Self` shows no `TargetType` line; write both lines always. All are
Skyrim.esm's records: write them as they are, with no search.

| Like | `BaseEffect` | `CastType` | `TargetType` | `MenuDisplayObject` | `HalfCostPerk` | `Data` |
|---|---|---|---|---|---|---|
| Healing | `RestoreHealthConcSelf` | `Concentration` | `Self` | `MAGINVHealSpellArt` | `RestorationNovice00` | Magnitude 10, Duration 1 |
| Fast Healing | `RestoreHealthFFSelf` | `FireAndForget` | `Self` | `MAGINVHealSpellArt` | `RestorationApprentice25` | Magnitude 50 |
| Heal Other | `RestoreHealthFFActor` | `FireAndForget` | `TargetActor` | `MAGINVHealSpellArt` | `RestorationAdept50` | Magnitude 75 |
| Lesser Ward | `WardConcSelf0` | `Concentration` | `Self` | `MAGINVWardSpellArt` | `RestorationNovice00` | Magnitude 40 |
| Turn Lesser Undead | `TurnUndeadFFAimed25` | `FireAndForget` | `Aimed` | `MAGINVTurnUndead` | `RestorationApprentice25` | Magnitude 6, Duration 30 |
| Oakflesh | `ArmorFFSelf0` | `FireAndForget` | `Self` | `MAGINVAlteration` | `AlterationNovice00` | Magnitude 40, Duration 60 |
| Candlelight | `LightFFSelf` | `FireAndForget` | `Self` | `MAGINVLightSpellArt` | `AlterationNovice00` | Magnitude 5, Duration 60 |
| Telekinesis | `TelekinesisEffect` | `Concentration` | `Self` | `MAGINVTelekinesis` | `AlterationAdept50` | Magnitude 1 |
| Paralyze | `ParalysisFFAimed` | `FireAndForget` | `Aimed` | `MAGInvParalyze` | `AlterationExpert75` | Duration 10 |
| Calm | `InfluenceAggDownFFAimed` | `FireAndForget` | `Aimed` | `MAGINVIllusionLight01` | `IllusionApprentice25` | Magnitude 9, Duration 30 |
| Courage | `InfluenceConfUpFFAimed` | `FireAndForget` | `Aimed` | `MAGINVIllusionLight01` | `IllusionNovice00` | Magnitude 100, Duration 60 |
| Fear | `InfluenceConfDownFFAimed` | `FireAndForget` | `Aimed` | `MAGINVIllusionDarkt01` | `IllusionApprentice25` | Magnitude 9, Duration 30 |
| Fury | `InfluenceAggUpFFAimed` | `FireAndForget` | `Aimed` | `MAGINVIllusionDarkt01` | `IllusionNovice00` | Magnitude 6, Duration 30 |
| Muffle | `MuffleFFSelf` | `FireAndForget` | `Self` | `MagicHatMarker` | `IllusionApprentice25` | Magnitude 1, Duration 180 |
| Invisibility | `InvisibillityFFSelf` | `FireAndForget` | `Self` | `MAGINVInvisibility` | `IllusionExpert75` | Duration 30 |
| Conjure Familiar | `SummonFamiliar` | `FireAndForget` | `TargetLocation` | `MAGINVSummon` | `ConjurationNovice00` | Duration 60 |
| Conjure Flame Atronach | `SummonFlameAtronach` | `FireAndForget` | `TargetLocation` | `MAGINVSummon` | `ConjurationApprentice25` | Duration 60 |
| Conjure Frost Atronach | `SummonFrostAtronach` | `FireAndForget` | `TargetLocation` | `MAGINVSummon` | `ConjurationAdept50` | Duration 60 |
| Conjure Storm Atronach | `SummonStormAtronach` | `FireAndForget` | `TargetLocation` | `MAGINVSummon` | `ConjurationExpert75` | Duration 60 |
| Reanimate Corpse | `ReanimateFFAimed25` | `FireAndForget` | `Aimed` | `MAGINVReanimate` | `ConjurationApprentice25` | Magnitude 13, Duration 60 |
| Bound Sword | `BoundSwordFFSelf` | `FireAndForget` | `Self` | `MAGINVBoundWeapon` | `ConjurationNovice00` | Duration 120 |
| Bound Bow | `BoundBowFFSelf` | `FireAndForget` | `Self` | `MAGINVBoundWeapon` | `ConjurationAdept50` | Duration 120 |
| Flame Cloak | `FireCloakFFSelf` | `FireAndForget` | `Self` | `MAGINVFireballArt` | `DestructionAdept50` | Magnitude 10, Duration 60 |
| Frost Cloak | `FrostCloakFFSelf` | `FireAndForget` | `Self` | `MAGINVIceSpellArt` | `DestructionAdept50` | Magnitude 10, Duration 60 |
| Lightning Cloak | `ShockCloakFFSelf` | `FireAndForget` | `Self` | `MAGINVShockSpellArt` | `DestructionAdept50` | Magnitude 10, Duration 60 |
| Fire Rune | `RuneFireFFLocation` | `FireAndForget` | `TargetLocation` | `MAGINVFireballArt` | `DestructionApprentice25` | Magnitude 50, Duration 1 |
| Frost Rune | `RuneFrostFFLocation` | `FireAndForget` | `TargetLocation` | `MAGINVIceSpellArt` | `DestructionApprentice25` | Magnitude 50, Duration 1 |
| Lightning Rune | `RuneShockFFLocation` | `FireAndForget` | `TargetLocation` | `MAGINVShockSpellArt` | `DestructionApprentice25` | Magnitude 50, Duration 1 |

`InvisibillityFFSelf` is spelled as Skyrim.esm spells it. Weapon and armor enchantments are in the
`skyrim-modding-items-and-crafting` skill.
