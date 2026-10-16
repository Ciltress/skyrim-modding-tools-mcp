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
| 2026-10-16 | gemma4:e4b | `all` | 9272165 + round 13's changes, 8 tasks + 3 with the skill read | 31/33 | 1.75 s | ~7,062 tokens/s | ~169 tokens/s | 100% |
| 2026-10-16 | gemma4:26b | `all` | 9272165 + round 13's changes, 8 tasks + 3 with the skill read | 33/33 | 4.66 s | ~1,012 tokens/s | ~44 tokens/s | 77% |

Rounds 1–5 ran before the script measured speed; their *prompt* and *generation* were measured
afterwards the same way — they are the model's and the machine's, not the build's.

Only the latest two rounds keep their details below. The earlier ones — what changed before each and
what its transcripts showed — are in this file's history: `git log -p -- docs/research/local-model-evals.md`.

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

## Round 13 — the family skill named in newProject's answer, an NPC's level whole, templates (2026-10-16)

**Changed before it:** round 12's three points.

- `newProject` answers `readFirst`: the skill of each record family, and what it covers — the list the
  server's instructions name too, kept in one place (`FAMILY_SKILLS`).
- A field of an NPC's level written in the wrong place — at the top, inside `Level`, or a `Level`
  without its kind — is answered with the whole level once per file, in the flow style the build
  reads: `Level: {MutagenObjectType: PcLevelMult, LevelMult: 1}` with `CalcMinLevel` and
  `CalcMaxLevel` beside it, or `NpcLevel` for a fixed level. Both forms were built and read back.
- **Templates, decided by the official plugins**: 3,258 of their 3,823 weapons have a `Template`, and
  every one carries the template's `Data`, keywords, `Model` and `EquipmentType` itself; every
  templated armor (2,679) its `Armature`, keywords and `BodyTemplate`; every weapon has `Data`. The
  Creation Kit copies them in. So round 12's templated sword is no sword, the check stays as it is, and
  the build refuses a project's weapon without `Data`, or a templated weapon or armor without the
  template's lines, naming them and the template to read. It is checked with the links, so it never
  hides the refusal a file was written for.

gemma4:e4b, `all` (prompt ~7,062 tokens/s, generation ~169 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6195 | 8.4 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7353 | 3.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4748 | 2.7 |
| patch | 3/3 | 4.7 | 3.7 | 0 | 0 | 9378 | 7.3 |
| build | 3/3 | 5.3 | 4.3 | 1 | 0 | 8646 | 8.1 |
| sword | 3/3 | 6 | 5 | 0 | 0 | 10329 | 12.9 |
| sword+skill | 3/3 | 5 | 4 | 0 | 0 | 9841 | 10.2 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 9246 | 9.7 |
| spell+skill | 2/3 | 6 | 5 | 2 | 0 | 10267 | 10.7 |
| npc | 3/3 | 12.3 | 11.3 | 6 | 0 | 14991 | 20.6 |
| npc+skill | 2/3 | 9.7 | 8.7 | 9 | 0 | 13272 | 20.3 |

gemma4:26b, `all` (prompt ~1,012 tokens/s, generation ~44 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5847 | 16.8 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6945 | 7.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6027 | 7.7 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 7810 | 14.6 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 7974 | 14.6 |
| sword | 3/3 | 13 | 12 | 3 | 0 | 18761 | 82.8 |
| sword+skill | 3/3 | 6 | 5 | 0 | 0 | 11552 | 45.2 |
| spell | 3/3 | 6.3 | 5.3 | 0 | 0 | 10648 | 33.1 |
| spell+skill | 3/3 | 6.3 | 5.3 | 0 | 0 | 10526 | 31.2 |
| npc | 3/3 | 10.7 | 9.7 | 2 | 0 | 12783 | 49 |
| npc+skill | 3/3 | 11.7 | 10.7 | 3 | 0 | 15325 | 40.7 |

(26b's find includes loading the model. Its turns took half the time of round 12's — 4.66 s against
9.54 — at round 11's prompt speed again, so round 12's slowness was the machine's.)

**Seen.**

- **26b passed 33 of 33**, and read the family skill in all nine authoring runs where it chose (round
  12: six of nine) — the skill `newProject`'s answer names. e4b passed the eight tasks 24 of 24 again,
  read the skill in all nine, and made its swords and spells in one build each.
- **The level whole ends the back and forth for 26b**: five refusals carried it, and each next build
  succeeded. e4b's NPC #2 took it and went on to its next mistake (a voice type it made up).
- e4b missed two runs with the skill already read. Its spell #2 also wrote a spell tome, as the skill's
  example does, with an `InventoryArt` it made up (`HighPolyBook`); offered the closest five, it
  answered after one refusal. Its NPC #2 wrote the NPC in two shapes by turns — every field under
  `Configuration` (refused with eight "move it up, to the top level", one per field), then every field
  at the top (refused: `Flags` and the level go under `Configuration`) — five builds of the same two
  files.
- No model wrote a weapon from a template this round; the new check went unused.

**What it points at next:**

- The eight "move it up" lines for one part: one line naming them all, and what the part does hold
  (`Configuration`: its flags, level and offsets), would show e4b where the boundary is.
- The skill's spell tome is copied into spells nobody asked a tome for; its `InventoryArt` could be
  named in the example's prose as the one for its school.
