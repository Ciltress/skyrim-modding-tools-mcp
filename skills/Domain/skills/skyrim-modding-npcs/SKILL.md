---
name: skyrim-modding-npcs
description: NPCs and what defines them in Skyrim SE - race, class, factions, outfits, AI packages, templates, voice types, FaceGen faces, followers. Use when creating or changing an NPC or follower, or diagnosing one - a dark face, an edit with no effect, a wrong outfit, an NPC ignoring its packages.
---

# NPCs

Read [`REFERENCE.md`](REFERENCE.md) before touching an NPC record: it covers the NPC record and the
records around it, templates, FaceGen, outfits, factions, AI packages, followers, what a save keeps,
and the typical bugs. Fundamentals — FormIDs, overrides, references — are in the
`skyrim-modding-basics` skill.

## Workflow

The loop in `skyrim-modding-basics` — look up, get the text, edit, build, deploy — with these for NPCs:

- **Look up** with `types` from `NPC_`, `LVLN`, `RACE`, `CLAS`, `FACT`, `OTFT`, `PACK`.
- **Before editing a field**, read the NPC and find out where the field comes from: a set template
  flag means the template's record holds it (REFERENCE, *Templates*) — patch that record instead.
- **Appearance** — anything from `HeadParts` down — needs new FaceGen from the Creation Kit, a step
  only the user can take (REFERENCE, *FaceGen*). Ask them to generate it, then copy the generated files
  into `assets/` at the same paths, so the deploy carries them.
- **Many NPCs at once** — a perk for every bandit, an outfit for every guard — go into a SPID
  `<Mod>_DISTR.ini` in `assets/`, with no NPC overridden (REFERENCE, *Distribution instead of edits*).
- **Done** when built and deployed, and the user knows to test on a new game or with `coc` from the
  main menu, since a save keeps the state of an NPC already met (REFERENCE, *What a save keeps*).
- **Diagnosing**: `readRecord` with `allVersions: true` on the NPC, and on her template if she has one,
  then match the symptom in REFERENCE, *Typical bugs*.

## A new NPC, as it builds

A Dunmer man, one file in the project's plugin folder, mirroring `Athis` without his appearance. Each
link is the editor ID of a vanilla record: voice type and race as `readRecord` shows them beside
Athis's FormIDs, and class, package and outfits each found with `findRecords`. The build writes their
FormIDs. The file has no `FormKey` line: the build gives the new record its own.

```yaml
# <project>/plugin/Npcs/DalvosVeran.yaml
EditorID: DalvosVeran
Configuration:
  Flags:
  - AutoCalcStats
  - Unique
  Level: {MutagenObjectType: PcLevelMult, LevelMult: 1}
  CalcMinLevel: 5
  CalcMaxLevel: 25
  SpeedMultiplier: 100
Voice: MaleDarkElf
Race: DarkElfRace
Class: CombatWarrior1H
Name:
  TargetLanguage: English
  Value: Dalvos Veran
AIData:
  Aggression: Unaggressive
  Confidence: Average
  EnergyLevel: 50
  Responsibility: NoCrime
Packages:
- DefaultSandboxEditorLocation512
DefaultOutfit: FarmClothesOutfit01
SleepingOutfit: DefaultSleepOutfit
```

- The Creation Kit's flags all go in `Configuration.Flags`: `Female` for a woman, `Essential`,
  `Protected`. The voice type matches race and sex — `MaleDarkElf` here; find the others with
  `findRecords` and `types: ["VTYP"]`.
- He has no `HeadParts`, and like any new NPC he needs FaceGen files before his face shows right in
  game — the *Appearance* step above.
- He is a base record: he stands in the world once a reference places him, from the Creation Kit, or
  with `player.placeatme` in the console for a quick test.

## A new NPC's lines

`Configuration` holds the flags and the level — `Flags`, `Level`, `CalcMinLevel`, `CalcMaxLevel`,
`SpeedMultiplier` — and every other line of the example stays at the top level: `Name`, `Voice`,
`Race`, `Class`, `AIData`, `Packages`, the outfits. The values below are Skyrim.esm's records, in every
load order: write them as they are, with no search.

**A woman has `Female` among `Configuration.Flags`**, beside the woman's voice — the voice alone leaves
her a man in game:

```yaml
Configuration:
  Flags:
  - Female
  - AutoCalcStats
```

| Race | `Race` | `Voice`, a man | `Voice`, a woman (with `Female`) |
|---|---|---|---|
| Nord | `NordRace` | `MaleNord` | `FemaleNord` |
| Imperial | `ImperialRace` | `MaleEvenToned` | `FemaleEvenToned` |
| Breton | `BretonRace` | `MaleEvenToned` | `FemaleEvenToned` |
| Redguard | `RedguardRace` | `MaleEvenToned` | `FemaleEvenToned` |
| High Elf | `HighElfRace` | `MaleElfHaughty` | `FemaleElfHaughty` |
| Dark Elf | `DarkElfRace` | `MaleDarkElf` | `FemaleDarkElf` |
| Wood Elf | `WoodElfRace` | `MaleElfHaughty` | `FemaleElfHaughty` |
| Orc | `OrcRace` | `MaleOrc` | `FemaleOrc` |
| Khajiit | `KhajiitRace` | `MaleKhajiit` | `FemaleKhajiit` |
| Argonian | `ArgonianRace` | `MaleArgonian` | `FemaleArgonian` |

The voice is the one vanilla NPCs of the race use most where the race has its own, else the race's
default.

| A … | `Class` |
|---|---|
| one-handed warrior | `CombatWarrior1H` |
| two-handed warrior | `CombatWarrior2H` |
| archer | `CombatRanger` |
| thief | `CombatThief` |
| destruction mage | `CombatMageDestruction` |
| conjurer | `CombatMageConjurer` |
| townsperson | `Citizen` |
| farmer | `Farmer` |

| Dressed in | `DefaultOutfit` |
|---|---|
| farm clothes | `FarmClothesOutfit01` |
| fine clothes | `FineClothesOutfit01` |
| mage robes | `ClothesMageRobesOutfitNoHood` |
| hide armor | `ArmorHideAllOutfit` |
| leather armor | `ArmorLeatherAllOutfit` |
| iron armor | `ArmorIronAllOutfit` |
| steel armor | `ArmorSteelAllOutfit` |

A follower carries the factions the game's followers carry — as `HousecarlWhiterun` (Lydia) does:

```yaml
Factions:
- Faction: CurrentFollowerFaction
  Rank: -1
- Faction: PotentialFollowerFaction
```

A spouse-to-be adds `PotentialMarriageFaction` at rank -1 the same way.
