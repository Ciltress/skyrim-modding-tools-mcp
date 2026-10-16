# Local model evaluations

A running log of every time this server is measured with a local model, and what was changed because
of it. **Add a round whenever the server is tested or tuned with a model**: the figures, the build
they were taken on, what changed before it, and what the transcripts showed.

## How a round is run and recorded

```bash
npm run build                          # the eval drives the built server: dist/ must be current
npm run eval:ollama -- --model gemma4:e4b --with-skills    # probes, until its transcripts show nothing to fix
npm run eval:ollama -- --model gemma4:26b --with-skills    # then both models: the round recorded here
```

[`scripts/eval-ollama.mjs`](../../scripts/eval-ollama.mjs) runs the tasks below through the built
server against the instance in `.env`, with its own agent loop on Ollama's `/api/chat`, then measures
the model's speed. At the end it prints the entry for this log — the summary row and the per-task
table — and saves it beside the JSON record of every call (`<out>.md`, `<out>.json`; by default under
the system temp folder). Paste the entry into a new round below, and write down what changed before it
and what the transcripts showed.

**The tasks.** Each is checked against the instance itself, never against values written into the
script. Nothing is deployed: `deployProject` stays listed, but a call to it is refused.

| task | the prompt asks | passes when |
|---|---|---|
| find | which plugin defines the Iron Sword, and its FormID | the answer names `012EB7` (any spelling of the FormID) and `Skyrim.esm` |
| read | the Iron Sword's damage and weight in the load order | the answer has both numbers as the instance has them |
| filter | three armor pieces Dawnguard.esm adds, with FormIDs | three FormIDs that are ARMO records defined in Dawnguard.esm |
| patch | a patch IronSwordBuff raising the Iron Sword's damage to 12, not built | the project's copy has `Damage: 12`, its editor ID and its weight unchanged |
| build | a patch SteelSwordLight in which the Steel Sword weighs 5, built | the copy has `Weight: 5`, and buildProject succeeded and wrote the plugin |
| sword | a new mod FlameBlade: a new one-handed sword "Flame Blade" with a fire damage enchantment, built | a new weapon of that name (its FormID in the project's own plugin), a one-handed sword, whose enchantment lists a fire effect (`ResistValue: ResistFire`), and the build succeeded |
| spell | a new mod StormBolt: a new Destruction spell "Storm Bolt" that deals shock damage, built | a new spell of that name, with an effect of the Destruction school and a shock effect (`ResistShock`), and the build succeeded |
| npc | a new mod HildaTheNord: one new NPC, a female Nord named "Hilda", built | a new NPC of that name, of the race NordRace (read from the instance), flagged Female, and the build succeeded |

The last three (from round 9) author new records by hand, following vanilla ones. A link — the sword's
enchantment, a spell's effects — is followed into the project when the model wrote the record there,
and into the load order (through `readRecord`) when it used a vanilla one; either passes.

**With the skill read** (from round 12): `--with-skills` runs each authoring task again as `sword+skill`,
`spell+skill`, `npc+skill` — the conversation starting with the task's family skill already read, a
`readSkill` call the harness makes and puts in as the model's, left out of the counts. The plain task
measures whether a model finds the skill; the `+skill` one, what the skill does once read.

**The columns.** *calls*: tool calls per run, file tools included. *invalid arguments*: calls refused
with `InvalidParams`. *other errors*: every other failed call, file tools included. *largest prompt*:
the most tokens Ollama evaluated in one turn. *seconds*: per run, mean. *s/turn*: mean time of a
model turn, the session's first (the model loading) left out. *prompt* and *generation*: how fast
the model reads a prompt and writes an answer on this machine at the round's context — the tool
reference (~2,400 tokens since round 9) summarised in 300 tokens, three times, the median of each,
with thinking off. The script measures it after the tasks, apart from them: their turns reuse
Ollama's prompt cache and answer in a few dozen tokens, so figures taken from them would not compare.
*GPU*: the share of the model Ollama put on the GPU.

**The machine**, unless a round says otherwise: Windows 11, RTX 5080 16 GB, 32 GB RAM; Ollama 0.40.4
with `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`; num_ctx 131072; the model's own defaults
otherwise (gemma4: thinking on, temperature 1); three runs per task, seeds 1001–1003. The instance is
the test instance — a portable Mod Organizer on Skyrim SE 1.7.104 with no mods.

## All rounds

| date | model | profile | build | passed | s/turn | prompt | generation | GPU |
|---|---|---|---|---|---|---|---|---|
| 2026-10-15 | gemma4:26b | `all` | 1cba00d | 15/15 | 3.0 s | ~900 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 1cba00d + round 2's changes | 15/15 | 2.9 s | ~900 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:26b | `core` | 1cba00d + round 2's changes | 15/15 | 2.8 s | ~900 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | qwen2.5-coder:3b | `all` | 1cba00d + round 2's changes | 0/15 | 0.2 s | ~14,400 tokens/s | ~230 tokens/s | 100% |
| 2026-10-15 | qwen2.5-coder:3b | `core` | 1cba00d + round 2's changes | 0/15 | 0.2 s | ~14,400 tokens/s | ~230 tokens/s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 37a2c1c (patch and build only) | 6/6 | 2.5 s | ~900 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 37a2c1c + round 4's changes | 15/15 | 3.4 s | ~900 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | 37a2c1c + round 4's changes | 14/15 | 1.8 s | ~5,900 tokens/s | ~170 tokens/s | 100% |
| 2026-10-15 | gemma4:e4b | `all` | 37a2c1c + rounds 4 and 5's changes | 15/15 | 1.3 s | ~5,900 tokens/s | ~170 tokens/s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 37a2c1c + rounds 4 and 5's changes | 15/15 | 2.9 s | ~900 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 2757aba + round 6's changes (find only, 1 run) | 1/1 | 3.07 s | ~907 tokens/s | ~48 tokens/s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 29d52de (the machine slowed; measured again two rows down) | 15/15 | 4.4 s | ~385 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | 29d52de | 15/15 | 1.33 s | ~7,137 tokens/s | ~177 tokens/s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 29d52de (again) | 15/15 | 2.99 s | ~970 tokens/s | ~53 tokens/s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 29d52de + round 8's changes | 15/15 | 2.82 s | ~969 tokens/s | ~43 tokens/s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | 29d52de + round 8's changes | 15/15 | 1.37 s | ~6,928 tokens/s | ~168 tokens/s | 100% |
| 2026-10-15 | gemma4:26b | `all` | bc57a7b, eight tasks | 17/24 | 4.45 s | ~956 tokens/s | ~50 tokens/s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | bc57a7b, eight tasks | 15/24 | 1.67 s | ~6,483 tokens/s | ~169 tokens/s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 6517a6a + round 10's changes | 21/24 | 5.47 s | ~967 tokens/s | ~49 tokens/s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | 6517a6a + round 10's changes | 16/24 | 1.82 s | ~6,785 tokens/s | ~172 tokens/s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 4c87050 + round 11's changes | 22/24 | 6.71 s | ~996 tokens/s | ~40 tokens/s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | 4c87050 + round 11's changes | 15/24 | 2.01 s | ~6,838 tokens/s | ~169 tokens/s | 100% |
| 2026-10-16 | gemma4:e4b | `all` | b058774 + round 12's changes, 8 tasks + 3 with the skill read | 33/33 | 1.77 s | ~6,937 tokens/s | ~175 tokens/s | 100% |
| 2026-10-16 | gemma4:26b | `all` | b058774 + round 12's changes, 8 tasks + 3 with the skill read | 32/33 | 9.54 s | ~805 tokens/s | ~43 tokens/s | 77% |

Rounds 1–5 ran before the script measured speed; their *prompt* and *generation* were measured
afterwards the same way — they are the model's and the machine's, not the build's.

Only the latest two rounds keep their details below. The earlier ones — what changed before each and
what its transcripts showed — are in this file's history: `git log -p -- docs/research/local-model-evals.md`.

## Round 11 — links by editor ID, copied FormKeys, files below a group (2026-10-15)

**Changed before it:** round 10's five points, and two faults found while checking them against five
Creation Club plugins serialized to project text.

- With records in the plugin folder, record files elsewhere in the project no longer stop the build:
  it succeeds and names them in `warnings`. Without records it still refuses, naming them.
- **A link may name its record by editor ID** — bare (`BaseEffect: StormBoltDamage`), with a plugin
  (`ObjectEffect: FlameBladeEnch:FlameBlade.esp`), in a field or a list (`Keywords: - WeapTypeSword`).
  The helper finds the link fields through Mutagen's record classes, looks the editor ID up among the
  project's records first, then the load order's, checks that the record is of a type the field
  takes, writes its FormID into the file and answers it in `resolvedLinks`. One it cannot resolve is
  refused with the closest editor IDs of the field's type (`Race: Nord` → NordRace, DLC1NordRace…).
  The skills no longer describe a second build for new records that point at each other.
- A record file whose FormKey names another plugin's record is refused when the load order has no such
  record, or when its editor ID differs from that record's ("to make a new record, leave FormKey
  out"). `checkRecords` waits for the load order's index for this.
- A file below a group's own folder (`Spells/Spells/…`) is refused, naming where it goes; only cells,
  worldspaces and dialogue nest. A build whose plugin holds no record is refused and leaves no plugin.
- A reader error with a line number quotes that line, and says what the reader expected there.
- Found on the way: the build numbered and renamed Spriggit's `GroupRecordData.yaml` (the head of a
  block of cells or a worldspace's folder) as if it were a new record, which broke every project with
  a cell in it; and the dangling-link check refused links to Skyrim.esm's numbers below `000800`,
  which the engine keeps for itself (`000014`, the player's reference, which every Creation Club plugin
  points at). Both fixed; all five plugins now build from their text, 5,991 records, no file changed.

gemma4:26b, `all` (prompt ~996 tokens/s, generation ~40 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5722 | 17.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6731 | 7.8 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 5909 | 7 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 7536 | 14 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 7776 | 16.9 |
| sword | 2/3 | 15.3 | 14.7 | 2 | 2 | 17172 | 132.3 |
| spell | 3/3 | 13 | 12 | 1 | 1 | 15714 | 86.9 |
| npc | 2/3 | 8 | 7 | 1 | 0 | 12859 | 86.2 |

(26b's find includes loading the model.)

gemma4:e4b, `all` (prompt ~6,838 tokens/s, generation ~169 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5948 | 2.8 |
| read | 3/3 | 3.3 | 2.3 | 1 | 0 | 7128 | 4.1 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4621 | 2.8 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 1 | 8187 | 7.9 |
| build | 3/3 | 5.3 | 4.3 | 1 | 0 | 8363 | 8.3 |
| sword | 0/3 | 12.3 | 11.3 | 11 | 2 | 12309 | 26.3 |
| spell | 0/3 | 11.3 | 12 | 9 | 0 | 12807 | 23.4 |
| npc | 0/3 | 13 | 12 | 14 | 0 | 18017 | 33.7 |

**Seen.**

- The five earlier tasks passed 30 of 30. Authoring: 26b 7 of 9 (round 10: 6), e4b 0 of 9 (round
  10: 1). One of 26b's misses is the scorer's: its NPC #2 is a female Nord named Hilda that built, but
  written in YAML's flow style (`Name: { TargetLanguage: English, Value: Hilda }`, `Flags: [Female,
  …]`), which the build reads and the task's checks did not. Counted right, 26b made 8 of 9.
- **26b's swords pass for the first time** (0 of 3 in round 10). It wrote a link by editor ID in all
  six sword and spell runs — `ObjectEffect: EnchFlameBlade`, `BaseEffect: StormBoltEffect` — and five
  of them passed in one build, with no second build for the link.
- **A refusal after the FormIDs are assigned is a trap.** The links were checked in the build, after
  the server had numbered the new records and renamed their files. e4b's NPC wrote `Race: Nord` into
  `Hilda.yaml`, was offered NordRace, and wrote `Race: NordRace` into `Hilda.yaml` again — but the
  refused record was now `000800_HildaTheNord.esp.yaml`, still with `Nord`, and the new `Hilda.yaml`
  was a second record. It went round until the turns ran out. e4b's sword did the same after a reader
  error, and 26b's sword #1 looked for its renamed files (`ENOENT`) before finding them.
- 26b's sword #1 wrote its effect, enchantment and sword without an `EditorID` line and linked them
  by the names it had in mind; refused, it added the `EditorID` lines — above the `FormKey:` the build
  had written, and the reader takes the first line for the FormKey ("Malformed FormKey string").
- 26b's spell #2 wrote `FormKey: 000000:StormBolt.esp` into both new records; the reader's "Two
  records with the same FormKey" named no file. It removed both lines and built.
- e4b still writes from memory and rarely reads a vanilla record first (3 `readRecord` calls in 9
  runs, 26b 22). Of its 33 builds, 24 were refused for fields its record type does not have (`Weight`
  at the top, `Gender`, `School`, `Enchantments`); it fixed some and invented others, round after
  round. The quoted reader line (`Line 2 is Name: Flame Blade: its field takes fields of its own`)
  sent it back to an earlier version of the file. Its sword #2 wrote the record relative to the
  working folder, then copied the Akaviri Katana with addPatch and reported the override as a new
  sword.
- Record files now land in the plugin folder: 53 of 55 writes (17 of 18 for 26b, 36 of 37 for e4b).

**Changed after it** (measured next round — and from round 12 on, a round starts with e4b alone):

1. A file keeps the name its author knows until a build succeeds. `checkRecords` checks the links too
   (only the build writes them), and the files of new records are renamed after the plugin is
   written — a reader error or a broken link no longer leaves a file under a new name.
2. Named with their files: a `FormKey` line below another line, the same FormKey in two files, and
   `000000`.
3. A link that names a record of the project written without an `EditorID` line names that file.
4. A text written as one value (`Name: Hilda`) is refused before the reader, with the two lines to
   write instead; a FormID in load-order form (`00013746`) is answered with its six digits and plugin;
   YAML that does not parse is refused with the line it breaks on.
5. A field a record type does not have names a vanilla record of that type to read first —
   `readRecord {"record": "HousecarlWhiterun"}` for an NPC, IronSword for a weapon.
6. Below the top level too, the build names a field the type does not have (`BasicStats` has no
   `Speed`), a field of several kinds without its `MutagenObjectType:` (an NPC's `Level`, which made
   the reader fail with "Object reference not set to an instance of an object"), and a list where
   fields belong or the reverse. No false positive on the five Creation Club plugins.
7. The scorer reads YAML's flow style.
8. A FormKey copied from a record of another plugin, under a new editor ID, is refused with only the
   way to a new record — remove the line (below: the second way it offered was the one taken).

**What it points at next** — e4b; round 12 starts with it alone, and its probes since showed:

- It still invents fields where it guesses a name — `Enchantment` for a weapon's `ObjectEffect`,
  `Effect` for `Effects`, `Magnitude` on a magic effect (it belongs to the spell's effect) — even
  after reading the vanilla record the refusal names. A singular/plural hint and a few synonyms would
  catch most.
- It copies a vanilla record with addPatch and renames it into its "new" one. Refused for the changed
  editor ID, it took the refusal's second clause ("to change TrapDartWeapon01, keep its editor ID"),
  restored the old one, and built an override of a vanilla weapon as its Flame Blade. The refusal
  now offers only the way to a new record (8, above).
- A record built without the field the task names (a spell with no `Name`) passes every check; only
  the task's scorer sees it.

## Round 12 — refusals that say what to write, and skills with the vanilla values (2026-10-16)

**Changed before it:** round 11's eight points, then what eight probes of gemma4:e4b alone showed
(not recorded; 18/24 after round 11's changes, 23/24 at the last).

- **Field refusals name the field meant**: by synonym (a weapon's `Enchantment` is `ObjectEffect`, an
  effect item's `Effect` is `BaseEffect`, a weapon's `Type` is `AnimationType` under `Data`, an NPC's
  `Gender` is `Female` among `Configuration.Flags`), by number (`Effect` → `Effects`), and by place —
  "move it under BasicStats", "move it up, under Configuration", "move it: a Weapon's Speed is under
  Data". With a value on the field's line, the refusal is the line to write (`ObjectEffect: FireBurn`).
  A field the type has nowhere: "delete it" — "has no field Description" alone was read as one missing,
  and written back build after build. A field of one value written with fields below it (an
  enchantment written inside the weapon, under `ObjectEffect:`) is named before the reader runs.
- **Links**: `readRecord` names each link's editor ID beside its FormID; a link that names no record,
  and `readRecord` with an unknown editor ID, answer the closest editor IDs, by shared words too
  (FireDamageEnchantment01 → EnchWeaponFireDamage01); `None` is the empty link.
- **A spell, enchantment or scroll whose effect is cast otherwise is refused** — the effect would do
  nothing in game. Fitted to Bethesda's own data: the 80 official plugins cast 15 of their 4,336
  effects otherwise, in ten shapes, and those build. The refusal gives the lines to write, after the
  player's spells that cast a like effect: "write StormBolt the way Thunderbolt is cast: `TargetType:
  Aimed` and in Effects[0] `BaseEffect: ShockDamageFFAimed75`". Told "name an effect cast
  FireAndForget instead, and give StormBolt its TargetType: … on Touch, … on Aimed", e4b had written
  `CastType: Aimed`.
- A refused build gives back the links it had written into the files as FormIDs. A record file in a
  folder that is no group, whose record its group's folder holds too, is left out with a warning — the
  refusal trapped a model whose file tools cannot delete.
- `findRecords` ranks named records whose editor ID begins with the text among the name matches
  ("shock" finds the Destruction effects before `EnchShockDamageFFContact`, a weapon's, which three of
  three spells had copied); a misspelled type is answered by prefix and by the Creation Kit's names too
  (`OBJECT`, `OBJEF`, `Enchantment` → ObjectEffect).
- **Skills**: worked examples ("A new … as it builds") in items-and-crafting, magic and npcs, and
  tables of vanilla values — Destruction's damage spells by element and casting (effect, cast,
  delivery, menu art, perk), each weapon kind's lines (the iron one to mirror, animation, keyword,
  equip type, impact set) and the weapon enchantment of each element. Every value was checked against
  the load order, and every table row built. skyrim-modding-basics and the server's instructions name
  the family skill to read for the records written; `readSkill` takes loose names (`npc`, `weapon`).
- The eval: `--with-skills` (above), and the record keeps each turn's thinking.

gemma4:e4b, `all` (prompt ~6,937 tokens/s, generation ~175 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6179 | 3.1 |
| read | 3/3 | 2.7 | 1.7 | 0 | 0 | 7239 | 3.7 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4664 | 2.9 |
| patch | 3/3 | 4.7 | 3.7 | 1 | 0 | 8506 | 8.1 |
| build | 3/3 | 5 | 4 | 0 | 0 | 8581 | 8.5 |
| sword | 3/3 | 9.3 | 8.3 | 4 | 0 | 11869 | 18.5 |
| sword+skill | 3/3 | 5 | 4 | 0 | 0 | 9364 | 8.9 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 8675 | 8.5 |
| spell+skill | 3/3 | 4.3 | 3.3 | 0 | 0 | 9193 | 7.6 |
| npc | 3/3 | 14 | 13 | 10 | 5 | 15752 | 28.6 |
| npc+skill | 3/3 | 9.3 | 8.3 | 5 | 1 | 11450 | 16.1 |

gemma4:26b, `all` (prompt ~805 tokens/s, generation ~43 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5821 | 18.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6919 | 7.2 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6034 | 8.3 |
| patch | 3/3 | 4.7 | 3.7 | 0 | 0 | 8204 | 13.9 |
| build | 3/3 | 6.3 | 5.3 | 2 | 0 | 8927 | 16.7 |
| sword | 2/3 | 12 | 11 | 3 | 0 | 16225 | 209.6 |
| sword+skill | 3/3 | 7 | 6 | 0 | 0 | 12606 | 108.1 |
| spell | 3/3 | 8.3 | 7.3 | 0 | 0 | 10923 | 126.2 |
| spell+skill | 3/3 | 4.7 | 3.7 | 0 | 0 | 10083 | 54.8 |
| npc | 3/3 | 8.7 | 7.7 | 1 | 0 | 12068 | 43.1 |
| npc+skill | 3/3 | 8 | 7 | 0 | 0 | 11583 | 43.2 |

(26b's find includes loading the model. Its prompt speed measured lower than in round 11 too — ~805
against ~996 tokens/s — so part of the slower turns is the machine's.)

**Seen.**

- On the eight tasks, **e4b passed 24 of 24** (round 11: 15) and 26b 23 of 24 (round 11: 22).
  Authoring: e4b 9 of 9 (round 11: 0), 26b 8 of 9. With the skill read first, both passed 9 of 9.
- **A run that reads its family skill passes.** e4b read it in all nine authoring runs, 26b in six; of
  the fifteen, all passed. In the last e4b probe, the one failure was the one run that read only
  skyrim-modding-basics — the pointer to the family skills was added after it.
- **The tables replace the search.** e4b's spells read the magic skill and built in one build each,
  with no `findRecords` at all; in round 11 its spells took 12 calls and none passed. Its swords wrote
  the enchantment from the table and built in two or three.
- With the skill read first, both used fewer calls — e4b's swords 4 against 8.3 and NPCs 8.3 against
  13; 26b's spells 3.7 against 7.3 and swords 6 against 11.
- 26b's sword #2 is a question for the scorer. It read no skill, mirrored the vanilla enchanted
  `EnchIronSwordFire01` — `Template: IronSword`, its name, its enchantment, its damage — and built. The
  game takes a templated weapon from its template, but the record has no `AnimationType` or
  `WeapTypeSword` of its own, which the check looks for; it stays a fail.
- e4b's NPCs still add fields from memory beyond the skill's example and fix them refusal by refusal —
  a `Level` block at the wrong depth, `Aggression: Average` (a `Confidence` value): npc #2 took nine
  builds. Every refusal named the right field or value.

**What it points at next:**

- 26b skipped the family skill in three of nine runs, though the instructions name it. `newProject`'s
  answer, which every authoring run reads, could name the skill for the records it is about to hold.
- e4b's NPC levels: the refusals go back and forth between the levels of `Configuration` and `Level`;
  one refusal giving the whole block (`Level:` with its kind, `CalcMinLevel` beside it) would end it.
- Whether a weapon with a `Template` should pass the sword check.
