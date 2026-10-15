# Spike: Spriggit's text format inside our own helper

Run 2026-10-15 on this machine (Steam Skyrim SE 1.7.104, .NET SDK 10.0.402). Throwaway code; this
file is what it established.

## Question

Can the Mutagen helper ([ADR-0003](../adr/0003-plugins-through-a-mutagen-helper.md)) read and write
Spriggit's YAML ([ADR-0004](../adr/0004-mods-are-authored-as-text-projects.md)) with nothing on the
user's machine but the .NET runtime — no Spriggit CLI, no SDK, no network?

## Answer: yes

- **`Spriggit.Yaml.Skyrim` cannot be referenced.** On NuGet it is a *dotnet tool* package
  (`<packageType name="DotnetTool" />`), which a project cannot take as a library.
- **It does not need to be.** Its serializer is generated: `Mutagen.Bethesda.Serialization.SourceGenerator`
  emits `MutagenYamlConverter` into whatever assembly contains an `ICustomize` class. Copying Spriggit's
  five-line `Customization` (omit last-modified, timestamps, unknown group data, unused condition
  fields; one file per record) and its `AddNonOpinionatedWriteOptions` write settings reproduces the
  format. Both are GPL-3.0, which [ADR-0006](../adr/0006-gpl-3.md) allows.
- **Pins that must move together** — the generator has to match the Mutagen it generates against.
  Spriggit 0.41.0 uses: `Mutagen.Bethesda.Skyrim` / `.Core` **0.54.0**,
  `Mutagen.Bethesda.Serialization` / `.Yaml` / `.SourceGenerator` **1.38.6**, `Noggog.CSharpExt` **4.3.0**.
- **Offline proof**: the published app (framework-dependent, net10.0, 42 files, 36 MB) ran with the
  SDK off `PATH`, `HTTP(S)_PROXY` pointed at a dead port and `NUGET_PACKAGES` at an empty folder. It
  completed every round trip; the NuGet folder stayed empty.

## Fidelity

| Plugin | Records | plugin → text → plugin → text |
| --- | --- | --- |
| Our own (built with Mutagen: one override, a weapon, a spell, a leveled list) | 4 | text identical, **plugin bytes identical** |
| `ccbgssse002-exoticarrows.esl` (Bethesda, localized, 9 languages) | 87 | all records kept; 53 files identical, 37 differ only in translation order, 5 in `-0` → `0` rotations and header counters |
| the rebuilt `exoticarrows` again (second cycle) | 87 | **95 of 95 files identical** |
| `ccbgssse025-advdsgs.esm` (Bethesda, 0.8 MB, dungeon cells) | 3,011 | all records kept; 1,065 files differ only in `-0` → `0` rotations, plus header counters |

So a plugin saved by Bethesda's tools is **normalised once** on its first pull — translation order,
negative zeros, `NumRecords`/`NextFormID` — and stable from then on. Pull and deploy can compare text
after that first normalisation without false alarms.

## Other facts

- Mutagen writes header **1.71** for `SkyrimRelease.SkyrimSE` by default. A 1.5.97 target needs
  `ModHeader.Stats.Version` set to 1.70 explicitly. Spriggit omits the field while it is the default.
- The light flag is named **`Small`** in Mutagen 0.54 (`SkyrimModHeader.HeaderFlag`: Master, Localized,
  Small). New records start at local ID `0x800`.
- Speed: about 15 s per pass for the 0.8 MB / 3,011-record plugin, cold. Fine for a project; analysis
  of large plugins should read Mutagen overlays directly, never through YAML.
- Layout: `RecordData.yaml` (header, masters) and one folder per record group, named by **Mutagen's
  group names** — `Weapons`, `Armors`, `ArmorAddons`, `Npcs`, `Spells`, `MagicEffects`,
  `ObjectEffects` (enchantments), `ConstructibleObjects`, `LeveledItems`, `Outfits`, `Factions`, `Cells`,
  `Worldspaces`… One file per record: `<EditorID> - <local ID>_<defining plugin>.yaml`. Cells nest by
  block and sub-block; worldspace cells by grid.
- References are written as FormIDs only — `Keywords: [01E718:Skyrim.esm]` — never with the editor ID.
  Reading and writing a project therefore needs a lookup between the two.
