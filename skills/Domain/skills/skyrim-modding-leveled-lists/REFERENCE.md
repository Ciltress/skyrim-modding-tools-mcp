# Leveled lists — reference

## The three list types

| Signature | List of | Used by |
| --- | --- | --- |
| `LVLI` | Items — or other `LVLI` | Containers, merchant chests, NPC inventories, death items, outfits |
| `LVLN` | NPCs — or other `LVLN` | Spawn points (an `ACHR` whose base is the list), NPC templates |
| `LVSP` | Spells — or other `LVSP` | NPC spell lists |

Each **entry** is a level, a record and a count. Lists nest: an entry can be another list, which is
how vanilla builds "a random steel-or-better weapon" out of many small lists.

## Fields

| Field | Meaning |
| --- | --- |
| **Entries** | Level, reference (item, NPC, spell or list), count |
| **Chance none** | 0–100: the chance the list yields *nothing* (`LVLI` only; always 0 on `LVLN`) |
| **Chance none global** | A global variable used instead — lets a script or an MCM change the chance at runtime |
| **All levels** flag | Pick from *every* entry at or below the reference level |
| **Each** flag | With a count above 1, roll once per item instead of once for all |
| **Use all** flag (`LVLI`, `LVSP`) | Give every qualifying entry instead of one |
| **Special loot** flag (`LVLI`) | Rarely used |

## How a pick works

1. The **reference level** is the player's level for items and spells. For NPCs it also depends on the
   encounter zone of the location and game settings.
2. Entries above the reference level drop out.
3. Without *All levels*, only the entries at the **highest remaining level** stay; with it, all remaining
   entries stay. Loot lists usually set *All levels*, so low-level items keep dropping.
4. One entry is chosen at random — or all, with *Use all*. **Duplicates are weights**: an entry listed
   three times is three times as likely.
5. *Chance none* is rolled for the list; a nested list rolls its own again, so chances compound.
6. A count above 1 gives that many of the same pick — unless *Each* is set, which rolls every one.

A list holds at most **255 entries**; nest lists beyond that.

## The conflict problem

A leveled list is one record, so the rule of one applies: **the last plugin to override a list
replaces all of it**. Mod A adds a sword to a vanilla weapon list, mod B adds an axe to the same list;
in game only B's axe appears, and A's sword is lost. With many mods this happens on hundreds of
lists at once.

Fixes, best first:

- **A merged patch** loads last and contains the union of all mods' changes to every list: Wrye Bash's
  *Bashed Patch* (driven by the `Delev`/`Relev` tags mods declare), a Synthesis leveled-list patcher,
  or xEdit's *Create Merged Patch*. The user rebuilds it after every load-order change.
- **One entry in, the rest in your own list**: add a single entry pointing at a new list of your own,
  and put your items there. Still an override of the vanilla list, so still merged — but your content
  stays in a record nobody else touches.
- **SPID for NPC gear**: adds items to NPCs' inventories at runtime without touching any list.
- **A script at runtime** (`LeveledItem.AddForm`): no record conflict, but the change lives in the
  save — it cannot be taken back by removing the mod, only by `Revert()`.

When a project touches a vanilla list, record which list and why, and expect it to need merging.

## Where lists hang

- **Containers** and **merchant chests**: an entry of a container's inventory can be a list. Merchant
  stock is rolled when the chest resets, so a change shows only after the next reset.
- **NPC inventory** and **death item**: what she carries and what is added when she dies.
- **Outfits**: an outfit entry can be a list, for randomised gear.
- **Spawns**: a placed actor whose base is an `LVLN` — bandit camps, dungeon draugr. The list's
  entries are often *templates* for NPCs defined elsewhere (see the `skyrim-modding-npcs` skill).
- **Spell lists**: an `LVSP` in an NPC's spells gives level-appropriate spells.

## In a project

Lists live in the folders `LeveledItems`, `LeveledNpcs` and `LeveledSpells`. A vanilla list and a new
one, trimmed:

```yaml
# LeveledItems/TG02MercLItemSword - 10FE64_Skyrim.esm.yaml  (vanilla, 8 entries)
FormKey: 10FE64:Skyrim.esm
EditorID: TG02MercLItemSword
Flags: [CalculateFromAllLevelsLessThanOrEqualPlayer, CalculateForEachItemInCount]
Entries:
- Data: { Level: 1, Reference: 012EB7:Skyrim.esm, Count: 1 }   # IronSword
- Data: { Level: 1, Reference: 013989:Skyrim.esm, Count: 1 }
- …                                                           # the same two, repeated: weights

# LeveledItems/SpikeLootList - 000802_SpikeTest.esp.yaml  (new)
FormKey: 000802:SpikeTest.esp
EditorID: SpikeLootList
ChanceNone: 0.25                       # a fraction: 25 %
Flags: [CalculateFromAllLevelsLessThanOrEqualPlayer]
Entries:
- Data: { Level: 1, Reference: 000800:SpikeTest.esp, Count: 1 }
- Data: { Level: 5, Reference: 012EB7:Skyrim.esm, Count: 2 }
```

- The flags are `CalculateFromAllLevelsLessThanOrEqualPlayer` (*All levels*),
  `CalculateForEachItemInCount` (*Each*) and `UseAll`.
- **`ChanceNone` is a fraction here** (`0.25`), although the CK shows and the plugin stores 0–100.
- To add to a vanilla list, the override must repeat *every* entry of the winning version, then add
  yours — the whole list is replaced.

## Typical bugs

| Symptom | Usual cause |
| --- | --- |
| A mod's items never appear | Another plugin overrides the same list later; no merged patch |
| Only the newest items drop | *All levels* unset — only the highest qualifying level is picked |
| Too many or too few drops | Chance none compounding across nested lists; *Each* or *Use all* set wrongly |
| Removed the mod, items keep spawning | Added by script into the save, or a merged patch still contains them — rebuild the patch |
| Merchant still sells old stock | The chest hasn't reset yet |
| Wrong enemy levels | The encounter zone caps the reference level |

## Sources

- UESP, *Mod File Format*: [LVLI](https://en.uesp.net/wiki/Skyrim_Mod:Mod_File_Format/LVLI) (and
  `LVLN`, `LVSP` beside it)
- The Creation Kit wiki (ck.uesp.net): *Leveled Item*, *Leveled Actor*, *Leveled Spell*
