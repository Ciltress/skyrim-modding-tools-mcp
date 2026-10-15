# Local model evaluations

A running log of every time this server is measured with a local model, and what was changed because
of it. **Add a round whenever the server is tested or tuned with a model**: the figures, the build
they were taken on, what changed before it, and what the transcripts showed.

## How a round is run and recorded

```bash
npm run build                          # the eval drives the built server: dist/ must be current
npm run eval:ollama -- --model gemma4:26b --runs 3
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

Rounds 1–5 ran before the script measured speed; their *prompt* and *generation* were measured
afterwards the same way — they are the model's and the machine's, not the build's.

Only the latest two rounds keep their details below. The earlier ones — what changed before each and
what its transcripts showed — are in this file's history: `git log -p -- docs/research/local-model-evals.md`.

## Round 9 — authoring: a sword, a spell, an NPC (2026-10-15)

**Changed before it:** three tasks that write new records by hand — `sword`, `spell` and `npc` (see
the task table). The server is round 8's (bc57a7b adds only the CI runner pin); the five tasks before
them are unchanged, so the round compares with round 8 there.

gemma4:26b, `all` (prompt ~956 tokens/s, generation ~50 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5644 | 17 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6679 | 7.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 5826 | 6.7 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 7133 | 12.1 |
| build | 3/3 | 5 | 4 | 0 | 0 | 7345 | 13.4 |
| sword | 0/3 | 17.3 | 16.7 | 4 | 1 | 22234 | 101 |
| spell | 1/3 | 9.3 | 8.3 | 0 | 0 | 10694 | 46 |
| npc | 1/3 | 18.7 | 17.7 | 2 | 0 | 18866 | 82.7 |

(26b's find includes loading the model.)

gemma4:e4b, `all` (prompt ~6,483 tokens/s, generation ~169 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5858 | 7.5 |
| read | 3/3 | 2.7 | 1.7 | 0 | 0 | 7009 | 3.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4480 | 2.6 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 7522 | 5.9 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 8721 | 7.9 |
| sword | 0/3 | 6.3 | 5.3 | 0 | 3 | 9704 | 14.9 |
| spell | 0/3 | 4.7 | 3.7 | 0 | 0 | 6686 | 8.1 |
| npc | 0/3 | 4.3 | 3.3 | 0 | 0 | 6187 | 7.4 |

**Seen.**

- The five earlier tasks passed 30 of 30, as in round 8. Authoring passed 2 of 18: 26b's spell once
  and its NPC once, e4b never.
- **Where the records went.** Of 31 writes of a record file (20 by 26b, 11 by e4b), 5 were into the
  project's plugin folder. The rest went into the project folder (`FlameBlade/Weapons/…`,
  `HildaTheNord/Npcs/…`, `StormBolt/Magic/Spells/…`) or the projects folder itself
  (`Spells/StormBolt.yaml`). newProject's description gives the place as `Weapons/MySword.yaml`,
  relative to the plugin folder, and its answer gives the plugin folder as a path of its own — the
  models joined the example to the project folder: round 2's lesson about relative paths, again.
- **And buildProject said success.** 22 of 26 successful builds had no records at all (14 of 18 for
  26b, 8 of 8 for e4b): the files outside the plugin folder are not read, and a build of nothing
  succeeds. The models took the success as done and told the user the mod was made. 26b's two
  passes came from listing the project folder before writing (the spell), and from finding the plugin
  folder after five builds of nothing (the NPC, in 25 turns).
- **The format.** 26b wrote the records as Spriggit does — it read a vanilla one first (Iron Sword of
  Embers, Firebolt, Lightning Bolt, Aela, Erik the Slayer). e4b never read a record of the kind it
  wrote, and invented its fields (`name:`, `damage:`, `firedamage:`, `gender: female`, once the whole
  file inside a Markdown code fence). Its one file in the right place failed the build with an internal error naming the
  file — `FilePathedException: Exception occurred while processing related to a filepath` — but not
  what was wrong with it; e4b repeated the same file and gave up.
- Smaller: `MAGI`, `KWDA` and `Voice` as record types were refused with the closest real ones (round
  5's change), and a skill asked for as `npc` or a collection named `magic` with what exists.

**What it points at in the server** (not changed yet):

1. buildProject should refuse a project with no records, and name record files it found outside the
   plugin folder — a build of nothing is never what was asked.
2. newProject (and the answers that create a project) should give the full path a record file goes
   to, not an example relative to another folder.
3. A record file the build cannot read should be refused as the request's fault (InvalidParams),
   naming the file and what in it is wrong, with the advice to mirror a vanilla record.
4. A field the build does not know should not be dropped silently: an invented `damage:` gives a
   weapon with no damage, and a successful build.

## Round 10 — the build names what it cannot build (2026-10-15)

**Changed before it:** round 9's four points.

- buildProject refuses a project with no record files, and record files in the project folder
  outside its plugin folder, naming each with its full path (and, with no records, YAML files in the
  projects folder that belong to no project).
- newProject's answer (and addPatch's, when it creates the project) carries `writeRecordsTo`: the
  full path of the plugin folder, a new weapon's file as a full path, and the group folders' names.
  newProject's description and the basics skill point there instead of giving `Weapons/MySword.yaml`.
- Before any record gets its FormID, the helper checks the record files (`checkRecords`): a file in no
  group folder, a folder that is no group (`NPCs` — "spelled Npcs"), a FormKey that is none, and every
  top-level field the record's type does not have — with a hint where one fits ("name: it is spelled
  Name", "damage: it goes under BasicStats"). The fields are the Mutagen record class's properties; a
  group of several kinds (Globals, game settings) is read by the kind the file names.
- A file the YAML reader still cannot read is refused as the request's fault (InvalidParams), with
  the file and the reader's innermost cause, not as an internal error.

Checked before the round: the field check passes every record of five Creation Club plugins
serialized by the helper (6,033 records, every common type, cells and worldspaces), and a patch of
eight vanilla types (an NPC, a spell, a magic effect, an enchantment, a global, a game setting, a
leveled list, an armor) builds.

gemma4:26b, `all` (prompt ~967 tokens/s, generation ~49 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5684 | 16.6 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6691 | 7.5 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 5892 | 10.1 |
| patch | 3/3 | 4.7 | 3.7 | 0 | 0 | 8075 | 13.5 |
| build | 3/3 | 5 | 4 | 0 | 0 | 7476 | 12.8 |
| sword | 0/3 | 25 | 25 | 12 | 4 | 22055 | 154.5 |
| spell | 3/3 | 13 | 12 | 3 | 2 | 16236 | 98.8 |
| npc | 3/3 | 10.7 | 9.7 | 1 | 1 | 15511 | 61.5 |

(26b's find includes loading the model.)

gemma4:e4b, `all` (prompt ~6,785 tokens/s, generation ~172 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5883 | 7.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6995 | 3.8 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4486 | 2.6 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 8210 | 7.8 |
| build | 3/3 | 5 | 4 | 0 | 0 | 8133 | 6.7 |
| sword | 1/3 | 8.3 | 7.3 | 4 | 0 | 12299 | 20.2 |
| spell | 0/3 | 8.3 | 7.3 | 6 | 0 | 10074 | 17 |
| npc | 0/3 | 9.3 | 8.3 | 6 | 0 | 11805 | 16.9 |

**Seen.**

- Authoring went from 2 to 7 of 18: 26b 6 of 9 (its spell and NPC every time), e4b 1 of 9. The five
  earlier tasks passed 30 of 30. The invalid arguments are now mostly the build's refusals, each
  naming what to fix; the models acted on them.
- **The files land in the plugin folder now**: 39 of 48 record-file writes (22 of 31 for 26b, all 17
  for e4b), against 5 of 31 in round 9. No build succeeded with nothing in it — except one, below.
- **A trap of this round's own making.** 26b's sword #1 wrote its enchantment into the project folder,
  was refused, and wrote it again into the plugin folder — but the eval's file tools cannot delete,
  so the stray copy stayed, and every later build was refused for it until the turns ran out. With
  records in the plugin folder, the stray files should be a warning in the answer, not a refusal.
- **Linking one new record to another.** 26b's other two swords wrote a new enchantment (and a new
  magic effect) and pointed the sword at it by editor ID: `ObjectEffect: FlameBladeEnch:FlameBlade.esp`.
  The refusal now said why ("Malformed FormKey string"), but not what to write instead — the FormID
  the build had just assigned to that record. The skills describe a second build for this; the models
  did not find it.
- **A copied FormKey makes an override, not a new record.** e4b copied the `FormKey:` line of the
  record it had read — the Iron Sword's, a guard's, an NPC's — into its "new" record: the build made
  an override of that record under the new name, succeeded, and the model reported a new sword. A
  deploy would have renamed every Iron Sword in the game. Once it invented `000200:Skyrim.esm`, a
  record Skyrim.esm does not have.
- **Nested a folder too deep.** e4b's spell #1 wrote `Spells/Spells/…` and `Spells/MagicEffects/…`.
  The check leaves files below a group's own folder to the reader (cells, worldspaces and dialogue
  keep their records so), the files got FormIDs, the reader did not take them as records, and the
  build succeeded with no records — the one build of nothing in this round.
- e4b still writes from memory before it reads a vanilla record; a refusal sent it to `readRecord` in
  3 runs. One reader error stayed cryptic: `Name: Hilda` where a mapping belongs gave "Expected
  'MappingStart', got 'Scalar' (Line: 2, Col: 7)".

**What it points at next** (not changed yet):

1. Stray record files with records in the plugin folder: build, and warn in the answer.
2. A link to another record of the project written by its editor ID: resolve it at the build, or name
   the FormID that record has.
3. A record file with another plugin's FormKey: refuse it when that plugin has no such record, and
   when its editor ID differs from that record's — "to make a new record, leave FormKey out".
4. Files below a flat group's folder (`Spells/Spells/…`): name them; and refuse a build that read no
   record at all.
5. Reader errors with a line number: quote that line of the file.
