# Magic — reference

## The effect chain

Every kind of magic is a **list of effects**, and every effect is a **magic effect** (`MGEF`) with
numbers attached:

```
SPEL / ENCH / SCRL / ALCH / INGR
 └─ effect 1: MGEF  + magnitude · area · duration · conditions
 └─ effect 2: MGEF  + …
                └─ archetype — what the effect does (damage a value, summon, light, run a script…)
```

The `MGEF` decides *what happens*; the effect entry on the spell decides *how much, how wide, how
long* and *when* (its conditions). One `MGEF` is reused by many spells, potions and enchantments, so
changing it changes all of them.

| Signature | Record |
| --- | --- |
| `SPEL` | Spell — also abilities, powers, diseases, shout spells |
| `MGEF` | Magic effect |
| `ENCH` | Enchantment, on weapons, armor and staves |
| `SCRL` | Scroll — a spell as a one-use item |
| `SHOU` | Shout: three words, a spell per level |
| `WOOP` | Word of power |
| `LVSP` | Leveled spell list — see the `skyrim-modding-leveled-lists` skill |
| `PERK` | Perk — modifies magic through entry points (below) |

## Spells

- **Type**: Spell, Disease, Power (once a day), Lesser Power (any time), Ability (always on), Poison,
  Addiction, Voice (a shout's spell).
- **Cast type**: Fire and Forget, Concentration, Constant Effect (abilities, diseases).
- **Delivery**: Self, Contact (touch), Aimed (projectile), Target Actor, Target Location.
- **Equip type**: either hand, both hands, voice…
- **Cost**: auto-calculated from the effects unless the *manual cost* flag is set. Set it manually for
  balance; auto-calc rarely matches intent.
- **Half-cost perk**: decides the spell's mastery level (Novice…Master) in its school, and which perk
  halves its cost.
- **Flags** worth knowing: *PC Start Spell* (the player starts a new game with it), *Ignore Resistance*,
  *Disallow Absorb/Reflect*, *Area Effect Ignores Line of Sight*, *No Dual Cast Modifications*.
- How the player gets a spell: a **spell tome** (a book that teaches it), a script (`AddSpell`), a
  quest reward. NPCs get it from their **spell list** or from SPID.

## Magic effects

| Field | Meaning |
| --- | --- |
| **Archetype** | The mechanism: *Value Modifier* (change an actor value), *Dual Value Modifier*, *Peak Value Modifier*, *Absorb*, *Script*, *Summon Creature*, *Bound Weapon*, *Light*, *Cloak*, *Paralysis*, *Calm*, *Frenzy*, *Demoralize*, *Invisibility*, *Soul Trap*, *Stagger*, *Telekinesis*, *Spawn Hazard*, *Enhance Weapon*, *Slow Time*, *Disguise*, *Cure Disease*… |
| **Actor value** | What a Value Modifier changes: `Health`, `Magicka`, `Stamina`, `SpeedMult`, `ResistFire`… |
| **Skill, minimum level** | The magic school and its tier: 0, 25, 50, 75, 100 |
| **Cast type, delivery** | Must match the spell, enchantment or scroll that uses the effect |
| **Resist value** | The actor value that resists it: `ResistFire`, `ResistMagic`, `PoisonResist`… |
| **Keywords** | `MagicDamageFire`, `MagicDamageFrost`, `MagicDamageShock`, `MagicRestoreHealth`… — perks and resistances find effects by these |
| **Associated item** | The NPC a summon spawns (it must have the *Summonable* flag), the weapon a bound spell gives, the light, the hazard, the cloak's spell |
| **Base cost** | Feeds the auto-calculated cost of every spell using it |
| **Description** | Shown in menus; `<mag>`, `<dur>`, `<area>` are filled from the effect entry |
| **Visuals and sound** | Casting art, hit art, enchant art, shaders, projectile, explosion, sounds |

### Flags that change behaviour

| Flag | Effect |
| --- | --- |
| **Detrimental** | Lowers the value instead of raising it — a Value Modifier on `Health` becomes damage |
| **Recover** | The change reverts when the effect ends. Fortify needs it; without it, a "temporary" boost is permanent |
| **Hostile** | Counts as an attack: the target turns hostile, and casting it on the innocent is a crime |
| **No Duration / No Magnitude / No Area** | Hides the field in menus and description |
| **Power Affects Magnitude / Duration** | Which number the effect's power — skill, perks, potion strength — scales |
| **No Recast** | Recasting doesn't refresh a running effect |
| **Hide in UI** | Invisible in the Active Effects list — helper effects |
| **Painless, No Hit Event** | No flinch; no `OnHit` for scripts |

### Script effects

The *Script* archetype does nothing on its own: a Papyrus script extending `ActiveMagicEffect` is
attached to the `MGEF` and runs `OnEffectStart` / `OnEffectFinish` on the target. Its properties are
filled on the `MGEF`.

## Enchantments

- **Type**: Enchantment, or Staff Enchantment.
- **Cast type and delivery** follow the item: weapons use *Fire and Forget* + *Contact* (spent per hit,
  from the weapon's charge); armor uses *Constant Effect* + *Self*.
- **Base enchantment**: links variants of one enchantment ("Fire Damage" at several strengths) to the
  one the player learns by disenchanting.
- **Worn restrictions**: a form list of keywords; the enchanting table offers the enchantment only on
  items carrying one of them. This is how "Fortify One-Handed" stays off boots.
- An item with `MagicDisallowEnchanting` can be neither enchanted nor disenchanted.

## Scrolls and shouts

- A **scroll** (`SCRL`) is a spell with item data — value, weight, model — consumed on use.
- A **shout** (`SHOU`) lists three **words** (`WOOP`); each level has its own spell (type Voice) and
  recovery time. Words are learned and unlocked separately (`Game.TeachWord`, `Game.UnlockWord`).

## How perks reach magic

Perks change magic through **entry points** — *Mod Spell Magnitude*, *Mod Spell Duration*, *Mod Spell
Cost*… — filtered by conditions, mostly on the effect's **keywords** and **school**. Augmented Flames
raises effects carrying `MagicDamageFire`. A new effect without the vanilla keywords gets none of the
vanilla perks. Copy the keyword set from the closest vanilla effect.

## In a project

Vanilla records as they appear in project text, trimmed (`…`), with comments naming the FormIDs.
Enchantments live in the folder `ObjectEffects`; delivery is called `TargetType` (`Self`, `Touch`,
`Aimed`, `TargetActor`, `TargetLocation`).

```yaml
# Spells/Flames - 012FCD_Skyrim.esm.yaml
FormKey: 012FCD:Skyrim.esm
EditorID: Flames
Name: { TargetLanguage: English, Value: Flames }
EquipmentType: 013F44:Skyrim.esm
BaseCost: 14
CastType: Concentration
TargetType: Aimed
HalfCostPerk: 0F2CA8:Skyrim.esm          # DestructionNovice00 — makes it a Novice spell
Effects:
- BaseEffect: 013CA9:Skyrim.esm          # FireDamageConcAimed
  Data: { Magnitude: 8, Duration: 1 }
- BaseEffect: 0F392F:Skyrim.esm
  Data: { Magnitude: 99, Duration: 15 }

# MagicEffects/FireDamageConcAimed - 013CA9_Skyrim.esm.yaml
Keywords: [01CEAD:Skyrim.esm]            # MagicDamageFire
Flags: [Hostile, Detrimental, NoArea, FXPersist, PowerAffectsMagnitude, NoDeathDispel]
BaseCost: 1.5
MagicSkill: Destruction
ResistValue: ResistFire
Archetype:
  MutagenObjectType: MagicEffectArchetype   # Value Modifier
  ActorValue: Health
CastType: Concentration
TargetType: Aimed
Projectile: 012FCF:Skyrim.esm
Description:
  TargetLanguage: English
  Value: A gout of fire that does <mag> points per second. Targets on fire take extra damage.

# ObjectEffects/EnchWeaponFireDamageBase - 10FB95_Skyrim.esm.yaml
Name: { TargetLanguage: English, Value: Fire Damage }
EnchantType: Enchantment
CastType: FireAndForget
TargetType: Touch
EnchantmentCost: 11
EnchantmentAmount: 11
Effects:
- BaseEffect: 04605A:Skyrim.esm          # EnchFireDamageFFContact
  Data: { Magnitude: 10 }
```

- A spell's cost field is `BaseCost`; a magic effect's `BaseCost` is the per-effect base it is computed
  from.
- Effect numbers live in `Data` on the spell's effect entry; a missing `Area` or `Duration` is 0.
- `Archetype` carries its own type name (`MutagenObjectType`); read a vanilla effect of the archetype
  you want and mirror it.

## Typical bugs

| Symptom | Usual cause |
| --- | --- |
| The spell does nothing | The `MGEF`'s cast type or delivery doesn't match the spell's; or an effect condition fails |
| A "fortify" stays forever | *Recover* flag missing |
| A restore spell damages, or the reverse | *Detrimental* flag wrong |
| Perks ignore the spell | Missing school or `MagicDamage…` keywords |
| Cost absurdly high or low | Auto-calculated cost; set a manual cost |
| Enchantment missing at the table | Worn restrictions exclude the item; or no base enchantment learned |
| Summon spawns nothing | The associated NPC lacks the *Summonable* flag |
| Changing one effect broke other spells | The `MGEF` is shared; make a copy for the new spell |
| Script effect never runs | Script not attached to the `MGEF`, properties unfilled, or not compiled |

## Sources

- UESP, *Mod File Format*: [SPEL](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/SPEL),
  [MGEF](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/MGEF)
- The Creation Kit wiki (ck.uesp.net): *Spell*, *Magic Effect*, *Enchantment*, *Shout*, *Perk Entry Point*
