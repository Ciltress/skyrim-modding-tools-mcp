# Local model evaluations

A running log of every time this server is measured with a local model, and what was changed because
of it. **Add a round whenever the server is tested or tuned with a model**: the figures, the build
they were taken on, what changed before it, and what the transcripts showed.

## How a round is run and recorded

```bash
npm run build                          # the eval drives the built server: dist/ must be current
npm run eval:ollama -- --model gemma4:e4b --with-skills --detailed   # probes, until its transcripts show nothing to fix
npm run eval:ollama -- --model gemma4:26b --with-skills --detailed   # then both models: the round recorded here
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

**With a detailed prompt** (from round 14): `--detailed` runs each authoring task again as
`sword+detailed`, `spell+detailed`, `npc+detailed`, with a prompt that spells out what a player who
knows the game would ask for — like the Iron Sword but 12 damage and a 10-point fire enchantment with
a charge of 500; an Apprentice shock bolt like Lightning Bolt, 40 damage, 60 magicka; a Nord woman
warrior, levels 5–30, in iron armor — and no editor IDs. The checks are the plain task's.

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
| 2026-10-16 | gemma4:e4b | `all` | 4b9333c + round 14's changes, 8 tasks + 3 with the skill read + 3 detailed | 41/42 | 1.85 s | ~6,755 tokens/s | ~164 tokens/s | 100% |
| 2026-10-16 | gemma4:26b | `all` | 4b9333c + round 14's changes, 8 tasks + 3 with the skill read + 3 detailed | 42/42 | 4.99 s | ~988 tokens/s | ~50 tokens/s | 77% |

Rounds 1–5 ran before the script measured speed; their *prompt* and *generation* were measured
afterwards the same way — they are the model's and the machine's, not the build's.

Only the latest two rounds keep their details below. The earlier ones — what changed before each and
what its transcripts showed — are in this file's history: `git log -p -- docs/research/local-model-evals.md`.

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

## Round 14 — tables of vanilla values in every skill, detailed prompts (2026-10-16)

**Changed before it:** round 13's two points, the user's two asks — tables for every record family,
and a set of detailed prompts — and what four probes of e4b alone showed (35, 35, 38, 41 of 42).

- **Every family's skill has tables of the vanilla records and values** its records are written with,
  each said to be Skyrim.esm's and so written without a search: magic — the damage spells by element
  and casting, and 28 everyday spells of all five schools; items-and-crafting — the weapon kinds, 13
  weapon enchantments, armor pieces heavy and light with their slots and addons, clothing, 18 armor
  enchantments, 8 potions, recipe stations, materials and smithing perks; npcs — the ten playable
  races with each sex's voice (the one vanilla NPCs of the race use most), classes, outfits, the
  follower factions, and what goes under `Configuration`; leveled-lists — the loot and blacksmith list
  of each weapon and armor kind, potions, bandits and spell tomes. Every row was built from test
  projects (28 spells, 38 items, 20 NPCs, a patched list); every name was found in the load order.
- In the skills, too: a woman's `Female` flag stated beside the voice (a table that gave the voice
  alone made four NPCs men); a new spell names a vanilla effect, its strength being the spell's own
  `Magnitude` (e4b wrote effects of its own "to be safe"); the spell tome made optional; the NPC
  example's level on one line, in flow style; example paths written `<project>/plugin/…` (copied as
  `plugin/Spells/…`, they landed in no project).
- **Refusals**: a field refusal names the family skill's tables before a vanilla record (sent to
  Firebolt, a shock spell took its fire effect); the misplaced fields of one part in one line, with
  what the part holds; the NPC level as three lines indented as `Flags`; a file in a group folder with
  another ending than `.yaml` named (`FlameBladeBurn.nhs` went unread); a build with no records names
  each misplaced file with the full path it belongs at, first.
- **A record file written empty is left out**, with a warning — the way to drop a record without a
  delete tool; refused for a part no other record names, the refusal offers it. Before, an empty file
  was built as a blank record.
- **Warnings on a build that succeeds**: an NPC with a voice of the other sex; a new enchantment no
  record names. Neither fires on the five Creation Club plugins.
- `readRecord` with an in-game name answers the records of that name (`Lydia` → HousecarlWhiterun);
  `addPatch`'s answer says a copy is an override, and how a new record like it is made.
- The eval: `--detailed` (above).

gemma4:e4b, `all` (prompt ~6,755 tokens/s, generation ~164 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6279 | 3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7472 | 4.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4769 | 2.8 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 8397 | 7.2 |
| build | 3/3 | 5.7 | 4.7 | 0 | 0 | 9566 | 8.4 |
| sword | 3/3 | 6.3 | 5.7 | 0 | 0 | 13940 | 13.2 |
| sword+skill | 3/3 | 6 | 5 | 1 | 0 | 13851 | 13.5 |
| sword+detailed | 2/3 | 11.7 | 10.7 | 5 | 0 | 20495 | 27.6 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 10334 | 9.3 |
| spell+skill | 3/3 | 4.3 | 3.3 | 0 | 0 | 10761 | 7.5 |
| spell+detailed | 3/3 | 5 | 4 | 0 | 0 | 10841 | 10.2 |
| npc | 3/3 | 8 | 7 | 3 | 1 | 11208 | 15.1 |
| npc+skill | 3/3 | 4.7 | 3.7 | 1 | 0 | 8642 | 7.5 |
| npc+detailed | 3/3 | 7.3 | 6.3 | 3 | 0 | 9891 | 12.3 |

gemma4:26b, `all` (prompt ~988 tokens/s, generation ~50 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5872 | 17 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6986 | 7.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6054 | 6.6 |
| patch | 3/3 | 4.7 | 3.7 | 0 | 0 | 7876 | 13.2 |
| build | 3/3 | 6 | 5 | 0 | 0 | 8098 | 14.2 |
| sword | 3/3 | 10.7 | 9.7 | 0 | 0 | 21566 | 66.1 |
| sword+skill | 3/3 | 6.3 | 5.3 | 0 | 0 | 14208 | 43.7 |
| sword+detailed | 3/3 | 13.3 | 12.3 | 4 | 0 | 25625 | 104.3 |
| spell | 3/3 | 5.7 | 4.7 | 0 | 0 | 10109 | 27.7 |
| spell+skill | 3/3 | 4 | 3 | 0 | 0 | 9514 | 16.8 |
| spell+detailed | 3/3 | 6 | 5 | 0 | 0 | 10312 | 30.1 |
| npc | 3/3 | 6.7 | 5.7 | 1 | 0 | 9469 | 28.9 |
| npc+skill | 3/3 | 4.7 | 3.7 | 1 | 0 | 8819 | 19.8 |
| npc+detailed | 3/3 | 9.3 | 8.3 | 2 | 0 | 14298 | 39.4 |

(26b's find includes loading the model.)

**Seen.**

- **Both models passed the 33 tasks of round 13, 33 of 33**; with the detailed set, 26b 42 of 42 and
  e4b 41 of 42.
- **Fewer turns**: e4b's spells now take 4 calls (round 13: 4–5), its NPCs with the skill read 3.7
  (round 13: 8.7); 26b's NPCs 5.7 (9.7) and spells 4.7 (5.3). Both read the family skill themselves
  in all 18 runs without it pre-read. 26b still looks names up before writing them — 23 searches and
  22 reads in 27 runs — and passes.
- The detailed prompts cost more turns than the plain ones, not fewer: they name more values to get
  right, and "like the Iron Sword" invites `addPatch`. e4b's one miss is that: it patched the Iron
  Sword and renamed it, then wrote its enchantment with `FormKey: 000123:Skyrim.esm # Placeholder` —
  the server's FormKey check did not read a line with a comment, took the record for a new one, left
  the sword's link to it unresolved, and the reader refused the editor ID ("Malformed FormKey
  string") five builds long.
- No build answer carried a warning: no voice of the other sex, no unused enchantment, no empty file.

**Changed after it** (measured next round): a `FormKey` line followed by a comment is read as one, so
a made-up FormKey is refused with the way to a new record, and the link to it resolves.
