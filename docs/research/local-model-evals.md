# Local model evaluations

A running log of every time this server is measured with a local model, and what was changed because
of it. **Add a round whenever the server is tested or tuned with a model**: the figures, the build
they were taken on, what changed before it, and what the transcripts showed.

## How a round is run and recorded

```bash
npm run build                          # the eval drives the built server: dist/ must be current
npm run eval:ollama -- --client openclaw --model gemma4:e4b --openclaw-agent skyrim-e4b --detailed   # the round recorded here
```

From round 23 a round measures gemma4:e4b alone: what the smallest model gets done, the larger ones get
done too — in round 22, 26b passed 39 of 39 and 12b 37 where e4b passed 33 — and an e4b round takes 40
minutes where all three took four hours. Until round 22, e4b probes went unrecorded, and the round was
every model's. From round 32 the user's 27B models run beside e4b, each a row of its own: Swift-1.5 27B IQ2_S
(`--openclaw-agent skyrim-swift`), and in rounds 32–33 bonsai-2:27b (`skyrim`), which the user removed after them;
gemma4:12b and 26b are gone from the machine.

[`scripts/eval-ollama.mjs`](../../scripts/eval-ollama.mjs) runs the tasks below through the built
server against the instance in `.env`, with its own agent loop on Ollama's `/api/chat`, then measures
the model's speed. At the end it prints the entry for this log — the summary row and the per-task
table — and saves it beside the JSON record of every call (`<out>.md`, `<out>.json`; by default under
the system temp folder). Paste the entry into a new round below, and write down what changed before it
and what the transcripts showed.

Before the first task the script loads the model with a short "hi" at the round's context, so no task
pays for the load; a model that was not loaded yet (a switch) gets `--settle` seconds more (60).
`--client openclaw` runs the same tasks through OpenClaw itself, headless (`openclaw agent exec`), with
the model behind a logging proxy in front of Ollama ([`scripts/eval-openclaw.mjs`](../../scripts/eval-openclaw.mjs)):
the client the user chats through, on their own OpenClaw configuration (`~/.openclaw/openclaw.json`,
or `--openclaw-config`) — its system prompt and tools, Tool Search, the thinking level and the context
it asks Ollama for, and one agent (`--openclaw-agent`, else `skyrim`) with its workspace files
(AGENTS.md, SOUL.md, USER.md…) in the prompt as a gateway puts them. The eval changes only what a
measurement needs: this server alone, on a fresh projects folder, without `deployProject`, `installMod`
and `downloadNexusFile`; OpenClaw's shell (`exec`, `process`) and the tools that reach a paired device
(`nodes`, `file_fetch`, `file_write`, `dir_list`, `dir_fetch`) denied; the model under test configured
and allowed. Its entry adds a line: the
first prompt's tokens and tools, the thinking, num_ctx and num_predict (the answer cap, from the model's
`params.num_predict`) OpenClaw sent, the time to the first token, answers cut off, turns Ollama ended at
the length limit — the cap, or the context's end — and side requests. Its seconds include each session's start, where the server builds its
record index again. `+skill` runs are left out there. Until 2026-10-18 the second client was Claude
Code (`--client claude-code`; `scripts/eval-claude-code.mjs` is in git history).

**The tasks.** Each is checked against the instance itself, never against values written into the
script. Nothing is deployed: `deployProject` stays listed, but a call to it is refused (through
OpenClaw it is left out of the list).

| task | the prompt asks | passes when |
|---|---|---|
| find | which plugin defines the Iron Sword, and its FormID | the answer names `012EB7` (any spelling of the FormID) and `Skyrim.esm` |
| read | the Iron Sword's damage and weight in the load order | the answer has both numbers as the instance has them |
| filter | three armor pieces Dawnguard.esm adds, with FormIDs | three FormIDs that are ARMO records defined in Dawnguard.esm |
| patch | a patch IronSwordBuff raising the Iron Sword's damage to 12, not built | the project's copy has `Damage: 12`, its editor ID and its weight unchanged |
| build | a patch SteelSwordLight in which the Steel Sword weighs 5, built | the copy has `Weight: 5`, and buildProject succeeded and wrote the plugin |
| sword | a new mod FlameBlade: a new one-handed sword "Flame Blade" with a fire damage enchantment, built | a new weapon of that name (its FormID in the project's own plugin), a one-handed sword the player can carry (no `NonPlayable` or `BoundWeapon` among its flags, from round 45), whose enchantment lists a fire effect (`ResistValue: ResistFire`), and the build succeeded |
| spell | a new mod StormBolt: a new Destruction spell "Storm Bolt" that deals shock damage, built | a new spell of that name, with an effect of the Destruction school and a shock effect (`ResistShock`), and the build succeeded |
| npc | a new mod HildaTheNord: one new NPC, a female Nord named "Hilda", built | a new NPC of that name, of the race NordRace (read from the instance), flagged Female, and the build succeeded |
| note | a new mod MavenNote: a new note "Maven's Warning" with exactly the text of the vanilla note "Note From Maven", built | a new book of that name whose text is the vanilla one (read from the instance; whitespace collapsed, so how a block is folded does not count, but a `\"` or `\n` left in does), and the build succeeded |

**No escapes copied** (from round 15): every task that leaves record files also passes only when none
of them holds an escape a copy should have decoded — a doubled backslash or a `\"` outside a
double-quoted string, or one still there once the string is decoded. It is what copying a JSON string
as it reads leaves: e4b wrote `File: Weapons\\Iron\\Sword.nif` in rounds 12–13. `note` (from round 15)
is the task built to show it: a text with quotes and line breaks, and a model path with backslashes.

**A sword the player can carry** (from round 45): the sword check fails a sword flagged `NonPlayable` or
`BoundWeapon`, a conjured weapon kept out of the player's inventory. findRecords answered the Bound Sword
first for "sword" from round 30 to 44, and 10 of e4b's swords of rounds 31–44 were copied from it with its
flags; 9 of those runs passed before. Counted so, replayed from each run's writes and edits, e4b would have
had 33 of 39 in round 31 (34 recorded), 40 of 45 in round 32 (41), 41 in round 33 (42), 40 in round 36 (42),
38 in round 37 (39), 42 in round 38 (43), 41 in round 40 (42) and 43 in round 44 (44). The rows keep the
counts as recorded; Swift built no such sword.

The authoring tasks (from round 9) author new records by hand, following vanilla ones. A link — the sword's
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

**The machine**, unless a round says otherwise: Windows 11, RTX 5080 16 GB, 32 GB RAM; Ollama 0.40.6 (0.40.4
before 2026-10-17) with `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`; num_ctx 131072; the model's own defaults
otherwise (gemma4: thinking on, temperature 1; bonsai-2:27b: temperature 1 set in OpenClaw, its Modelfile's top_k 20,
top_p 0.95, min_p 0.05; Swift-1.5: temperature 1, top_p 0.95, top_k 20, min_p 0 from its model card, `think: true`,
which its template takes as `xhigh`); three runs per task, seeds 1001–1003 — since round 32 one run each
of the five reading and patching tasks and five of each authoring task (`--runs 1 --authoring-runs 5`). The instance is
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
| 2026-10-16 | gemma4:e4b | `all` | db246fb + round 15's changes, 9 tasks + 4 with the skill read + 4 detailed | 45/51 | 1.98 s | ~6,955 tokens/s | ~166 tokens/s | 100% |
| 2026-10-16 | gemma4:e4b | `all`, text+tables | db246fb + round 15's changes, the same | 47/51 | 1.94 s | ~7,318 tokens/s | ~162 tokens/s | 100% |
| 2026-10-16 | gemma4:26b | `all` | db246fb + round 15's changes, the same | 51/51 | 5.12 s | ~996 tokens/s | ~48 tokens/s | 77% |
| 2026-10-16 | gemma4:26b | `all`, text+tables | db246fb + round 15's changes, the same | 50/51 | 5.19 s | ~1,003 tokens/s | ~49 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all`, Claude Code | db246fb + rounds 15–16's changes, 9 tasks + 4 detailed | 35/39 | 2.5 s | ~6,983 tokens/s | ~166 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all`, Claude Code | db246fb + rounds 15–16's changes, 9 tasks + 4 detailed | 38/39 | 2.99 s | ~1,022 tokens/s | ~50 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all` | 7c11e20 + round 17's changes, 9 tasks + 4 with the skill read + 4 detailed | 46/51 | 1.91 s | ~7,255 tokens/s | ~170 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all` | 7c11e20 + round 17's changes, the same | 51/51 | 5.62 s | ~1,004 tokens/s | ~49 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all` | b354106, Ollama 0.40.6 (0.40.4 before) | 48/51 | 2.31 s | ~6,936 tokens/s | ~171 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all` | b354106, Ollama 0.40.6 | 51/51 | 14.14 s | ~674 tokens/s | ~49 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all` | 3bf8544 + round 19's changes | 48/51 | 2.08 s | ~7,354 tokens/s | ~162 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all` | 3bf8544 + round 19's changes | 50/51 | 12.95 s | ~170 tokens/s | ~17 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all` | 37156ce + round 20's changes | 46/51 | 1.91 s | ~7,387 tokens/s | ~181 tokens/s | 100% |
| 2026-10-18 | gemma4:26b | `all` | 37156ce + round 20's changes | 51/51 | 7.88 s | ~1,088 tokens/s | ~40 tokens/s | 77% |
| 2026-10-18 | gemma4:e4b | `all`, OpenClaw | 1edf075 | 31/39 | 3.51 s | ~7,459 tokens/s | ~171 tokens/s | 100% |
| 2026-10-18 | gemma4:12b | `all`, OpenClaw | 1edf075 | 34/39 | 9.49 s | ~3,624 tokens/s | ~116 tokens/s | 100% |
| 2026-10-18 | gemma4:26b | `all`, OpenClaw | 1edf075 | 39/39 | 8.96 s | ~1,111 tokens/s | ~49 tokens/s | 77% |
| 2026-10-20 | gemma4:e4b | `all`, OpenClaw | 49006cd | 33/39 | 3.47 s | ~7,259 tokens/s | ~162 tokens/s | 100% |
| 2026-10-20 | gemma4:12b | `all`, OpenClaw | 49006cd | 37/39 | 7.05 s | ~3,274 tokens/s | ~109 tokens/s | 100% |
| 2026-10-20 | gemma4:26b | `all`, OpenClaw | 49006cd (the GPU busy with something else for most of it: s/turn does not compare) | 39/39 | 25.94 s | ~1,124 tokens/s | ~49 tokens/s | 77% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | f9cb81c | 36/39 | 3.46 s | ~7,319 tokens/s | ~179 tokens/s | 100% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | 410f3f8 | 38/39 | 3.01 s | ~7,264 tokens/s | ~173 tokens/s | 100% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | e176320 | 37/39 | 3.33 s | ~7,397 tokens/s | ~168 tokens/s | 100% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | 6134d7d | 38/39 | 2.99 s | ~7,402 tokens/s | ~167 tokens/s | 100% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | afd183d | 35/39 | 3.43 s | ~7,161 tokens/s | ~182 tokens/s | 100% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | fbd98b0 | 34/39 | 3.5 s | ~7,410 tokens/s | ~173 tokens/s | 100% |
| 2026-10-21 | gemma4:e4b | `all`, OpenClaw | 3d33746 | 37/39 | 3.32 s | ~7,407 tokens/s | ~182 tokens/s | 100% |
| 2026-10-22 | gemma4:e4b | `all`, OpenClaw | bb2fb81 | 39/39 | 3.63 s | ~6,861 tokens/s | ~155 tokens/s | 100% |
| 2026-10-22 | gemma4:e4b | `all`, OpenClaw | bf66bbe | 34/39 | 3.59 s | ~7,071 tokens/s | ~168 tokens/s | 100% |
| 2026-10-22 | gemma4:e4b | `all`, OpenClaw | c676b39 | 41/45 | 3.7 s | ~7,176 tokens/s | ~182 tokens/s | 100% |
| 2026-10-22 | bonsai-2:27b | `all`, OpenClaw | 257d32b | 45/45 | 22.34 s | ~2,163 tokens/s | ~73 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 257d32b | 45/45 | 8.52 s | ~1,909 tokens/s | ~64 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | 054ac8a | 42/45 | 3.68 s | ~7,228 tokens/s | ~164 tokens/s | 100% |
| 2026-10-23 | bonsai-2:27b | `all`, OpenClaw | 054ac8a | 43/45 | 24.36 s | ~2,179 tokens/s | ~73 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 054ac8a | 45/45 | 8.99 s | ~1,920 tokens/s | ~64 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | 3a99884 | 39/45 | 3.76 s | ~7,153 tokens/s | ~166 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 3a99884 | 45/45 | 9.83 s | ~1,335 tokens/s | ~61 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | 98cb041 | 42/45 | 4 s | ~6,771 tokens/s | ~159 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 98cb041 | 45/45 | 9.59 s | ~1,305 tokens/s | ~61 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | 8434306 | 42/45 | 3.93 s | ~6,901 tokens/s | ~170 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 8434306 | 45/45 | 8.82 s | ~1,843 tokens/s | ~62 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | d52ea90 | 39/45 | 4.21 s | ~7,081 tokens/s | ~173 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | d52ea90 | 45/45 | 8.34 s | ~1,913 tokens/s | ~64 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | 287e873 | 43/45 | 3.93 s | ~7,012 tokens/s | ~174 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 287e873 | 45/45 | 8.46 s | ~1,909 tokens/s | ~64 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | 85c513a | 38/45 | 4.06 s | ~7,047 tokens/s | ~161 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 85c513a | 45/45 | 8.34 s | ~1,913 tokens/s | ~64 tokens/s | 100% |
| 2026-10-23 | gemma4:e4b | `all`, OpenClaw | cbcccda | 42/45 | 3.75 s | ~7,184 tokens/s | ~174 tokens/s | 100% |
| 2026-10-23 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | cbcccda | 44/45 | 8.13 s | ~1,903 tokens/s | ~64 tokens/s | 100% |
| 2026-10-24 | gemma4:e4b | `all`, OpenClaw | dad7e67 | 44/45 | 3.89 s | ~7,047 tokens/s | ~172 tokens/s | 100% |
| 2026-10-24 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | dad7e67 | 45/45 | 8.06 s | ~1,911 tokens/s | ~64 tokens/s | 100% |
| 2026-10-24 | gemma4:e4b | `all`, OpenClaw | ee82522 | 41/45 | 3.71 s | ~7,050 tokens/s | ~173 tokens/s | 100% |
| 2026-10-24 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | ee82522 | 45/45 | 8.15 s | ~1,894 tokens/s | ~64 tokens/s | 100% |
| 2026-10-24 | gemma4:e4b | `all`, OpenClaw | 2f7d068 | 41/45 | 4.11 s | ~6,598 tokens/s | ~178 tokens/s | 100% |
| 2026-10-24 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 2f7d068 | 45/45 | 8.69 s | ~1,911 tokens/s | ~64 tokens/s | 100% |
| 2026-10-24 | gemma4:e4b | `all`, OpenClaw | 682d958 | 44/45 | 3.36 s | ~6,660 tokens/s | ~173 tokens/s | 100% |
| 2026-10-24 | Swift-1.5 27B IQ2_S | `all`, OpenClaw | 682d958 | 45/45 | 8.57 s | ~1,904 tokens/s | ~64 tokens/s | 100% |

Rounds 1–5 ran before the script measured speed; their *prompt* and *generation* were measured
afterwards the same way — they are the model's and the machine's, not the build's.

Only the latest two rounds keep their details below. The earlier ones — what changed before each and
what its transcripts showed — are in this file's history: `git log -p -- docs/research/local-model-evals.md`.

## Reference measurements

Measurements of a setting rather than of a build, kept whole.

### Thinking off (2026-10-16, gemma4:e4b, db246fb)

`--think false`, against round 14's e4b run with gemma4's default (thinking on), the same 42 tasks:

| | passed | invalid arguments | other errors | turns | seconds, all runs |
|---|---|---|---|---|---|
| thinking on (round 14) | 41/42 | 13 | 1 | 226 | 417 |
| thinking off | 25/42 | 32 | 19 | 322 | 246 |

41% less time, 16 tasks lost — spread over every authoring task (`npc+detailed` 0/3). **Leave thinking
on.** It is where the time goes: in round 14 generated tokens were ~90% of 26b's wall time and thinking
~60% of those, against ~13% for reading every tool answer. Answers in fewer tokens could not buy much
time; that is why round 15 measures answer formats for quality instead.

### Thinking medium (2026-10-21, gemma4:e4b, afd183d)

`thinkingDefault: medium` for the `skyrim-e4b` agent, on a copy of the user's OpenClaw configuration —
theirs is `max`, which OpenClaw sends to Ollama as `think: "high"` — against round 27 on the same build,
run straight after it, the same 39 tasks:

| | passed | authoring | invalid arguments | other errors | turns | seconds, all runs | thinking per turn (chars) | output tokens |
|---|---|---|---|---|---|---|---|---|
| high (round 27) | 35/39 | 20/24 | 28 | 10 | 311 | 2,301 | 1,434 | 162,808 |
| medium | 34/39 | 19/24 | 34 | 6 | 336 | 2,489 | 1,441 | 187,400 |

At medium e4b thought as much per turn as at high, took more turns and time, and passed one run fewer. The
turns that plan and make no call — they ended one run in each of rounds 23–26 — did not go away: two of
medium's five misses planned their fix and stopped (round 27: one of four), and a third, sword+detailed #3,
wrote its last call into its thinking, ending in gemma4's own tool-call tokens (`…FlameBlade.yaml<|"|>}<tool_call|>`),
which Ollama passed on as no call; it then told the user the mod was built. That is the only turn in rounds
22–27 that lost a call so. **Keep the user's setting.** One run of each shows no gain from medium; with rounds
moving by about three passes on their own, it does not show a loss either.

### Claude Code as the client (2026-10-16, Claude Code 2.1.301 on Ollama's Anthropic endpoint)

The VS Code extension with `ANTHROPIC_BASE_URL` at Ollama, measured through a logging proxy on the
`find` question (gemma4:26b unless noted):

| setup | first prompt (tokens) | tools | first token of the first turn |
|---|---|---|---|
| as installed: every built-in tool, the user's three other MCP servers | 41,652 | 66 | 106 s |
| the built-ins a modding session does not use denied (e4b) | 10,099 | 41 | 2.8 s |
| … and non-essential traffic off | 9,905 | 41 | 8.7 s |
| … and only this server and a web search (the workspace) | 7,757 | 23 | 7.6 s |

Claude Code's own built-in tools were 135 KB of the first prompt's 159 KB of tool schemas (`Artifact`
alone 32 KB; this server's 14 tools 14 KB). Denied in a folder's `.claude/settings.json`
(`permissions.deny`), a tool leaves the prompt. The 106 s were 26b loading, then a session-title request
Claude Code sends the main model before the first turn — 1,699 tokens with thinking, 66 s, and the turn
queued behind it. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` stops that request. Naming a smaller
model for side requests (`ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`) moves it, but on
a 16 GB card that cannot hold both, each side request swaps the models, ~30 s each way. After the first
turn the prompt cache holds: 1–5 s to the first token per turn. Claude Code hands the server's answer
to the model as one text block, as sent. An answer stopping midway, as a user reported, did not happen
in these runs; `--client claude-code` counts every answer that ends without `message_stop`.

Round 16's `--client claude-code` ran in that lean setup: the same denied built-ins, non-essential
traffic off, side requests on the model under test, only this server. OpenClaw replaced it as the
eval's second client on 2026-10-18.

### OpenClaw as the client (2026-10-18, OpenClaw 2026.10.4 on Ollama's native API)

The user's OpenClaw, gemma4:26b, through `--client openclaw` and a probe proxy (`find` and `patch`, one
run each, b192d20 + the new client):

| setup | passed | first prompt (tokens) | tools | think | first token of the first turn |
|---|---|---|---|---|---|
| as configured: Tool Search automatic, thinking OpenClaw's default | 0/2 | 7,880 | 10, this server's behind Tool Search | false | 42 s |
| `tools.toolSearch: false`, `params.thinking: "medium"` for the model | 2/2 | 26,093 | 57, 16 of them this server's | medium | 24–59 s |

- **The context was 32,768.** OpenClaw's model discovery wrote `contextTokens: 32768` into the model's
  entry, and the native adapter sends it as `options.num_ctx`; the user's longer chats failed with
  "request (34099 tokens) exceeds the available context size (32768 tokens)". Set to 131,072 — what the
  eval and the user's Ollama use, so the model is not reloaded between them.
- **Thinking is off** unless configured: for local Ollama models OpenClaw's implicit level is `off`
  (`think: false` on every request). `agents.defaults.models["ollama/<model>"].params.thinking` sets it;
  Ollama takes `think: "medium"` for gemma4. Thinking off cost e4b 41/42 → 25/42 (above).
- **Tool Search hides this server.** With `tools.toolSearch` unset, OpenClaw puts every MCP tool behind
  `tool_search` / `tool_describe` / `openclaw_tool_call` for local models and does not name them in the
  prompt. 26b never found them: it searched its memory, listed folders, called `tool_search` through
  `openclaw_tool_call`, and answered that it could not reach the Skyrim installation (33 turns in a probe
  without a task limit). Found through a search, an answer comes back wrapped as untrusted external
  content. The setting is global, not per agent.
- **The server's `instructions` never reach the model** — OpenClaw's MCP client does not read them, with
  Tool Search or without. What a model learns of this server is the tool descriptions. OpenClaw's own
  skills, by contrast, are listed in its prompt with the order to read a matching one before working.
- With Tool Search off, OpenClaw's own 41 tools are most of the 97 KB of schemas (in a probe
  `automations` alone was 16 KB, `sessions_spawn` 10 KB). No conversation's first turn was served from
  Ollama's prompt cache: every new chat reads the whole prompt again, 24–59 s on 26b.
- `agent exec` on Windows: its temporary state folder fails to delete (a SQLite file still open, `EBUSY`)
  and the run's answer is lost with it, so the eval gives each run a state folder of its own.

**The modding agent** setup writes (`skyrim`: the modding skills as OpenClaw skills, thinking `max` — sent
to Ollama as `think: "high"` — and only `read`, `write`, `edit`, `apply_patch`, `ls`, `skills_read` and
`skyrim__*`), measured on `find`, `patch`, `sword`, `npc`, `note`, one run each:

| Tool Search | passed | turns (find / patch / sword / npc / note) | first prompt (tokens) | tools | first token |
|---|---|---|---|---|---|
| off | 4/5 | 2 / 5 / 25 / 7 / 8 | 7,219 | 22, 16 of them this server's | 8 s |
| on | 4/5 | 8 / 15 / 19 / 6 / 15 | 4,242 | 8, this server's behind Tool Search | 25 s |

The allow list takes the first prompt from 26,093 tokens to 7,219. With Tool Search on, every call to this
server is a search, a description and a call through `openclaw_tool_call` — two to three times the turns —
and its miss never used the server: told to make an NPC, 26b read the npcs skill, wrote the record, a
README and a `metadata.json` by hand, and answered that the mod was built. The miss with it off was the
model's: four turns lost calling `skills_read` with `skill:` instead of `name:`, then a potion's damage
effect on the enchantment, refused by the build, and the turns ran out. (The seconds do not compare: the
GPU ran the second half at ~184 tokens/s of prompt against ~891.)

## Round 43 — with a plugin named, its own records first; e4b and Swift-1.5 27B (2026-10-24)

**Changed before it:**

- With a plugin named, findRecords answers the records it adds before those it changes (e9742fa): round 42's change
  had put Skyrim.esm's own first among equals, and Dawnguard.esm's armor was answered with the Falmer armor it changes.
- The tenth round with AGENTS.md's "delivered" line. Nothing ran beside it.

gemma4:e4b, `all`, OpenClaw, at 2f7d068 (prompt ~6,598 tokens/s, generation ~178 tokens/s; first prompt 9947 tokens (26 tools, 16 of them this server's), think high, num_ctx 131072, num_predict none, temperature the Modelfile's, first token after 1.773 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 1 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 11596 | 89.1 |
| read | 1/1 | 2 | 1 | 0 | 0 | 11113 | 39.5 |
| filter | 1/1 | 3 | 2 | 0 | 0 | 10336 | 41.4 |
| patch | 1/1 | 6 | 5 | 0 | 0 | 18839 | 48 |
| build | 1/1 | 9 | 8 | 0 | 0 | 21255 | 50.9 |
| sword | 5/5 | 10.8 | 9.8 | 3 | 0 | 26110 | 82.9 |
| sword+detailed | 3/5 | 11 | 10.4 | 1 | 2 | 27177 | 81.1 |
| spell | 5/5 | 6.4 | 5.6 | 0 | 0 | 16918 | 50.1 |
| spell+detailed | 4/5 | 13.8 | 13 | 10 | 6 | 25984 | 107.3 |
| npc | 5/5 | 7 | 6 | 1 | 0 | 19361 | 50 |
| npc+detailed | 5/5 | 9 | 8 | 3 | 2 | 22696 | 62 |
| note | 4/5 | 6.4 | 5.4 | 1 | 0 | 15016 | 58.7 |
| note+detailed | 5/5 | 7.2 | 6.2 | 2 | 0 | 15672 | 65.2 |

Swift-1.5 27B IQ2_S, `all`, OpenClaw, at 2f7d068 (prompt ~1,911 tokens/s, generation ~64 tokens/s; first prompt 10400 tokens (26 tools, 16 of them this server's), think true, num_ctx 131072, num_predict none, temperature 1, first token after 0.902 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 10422 | 54.5 |
| read | 1/1 | 3 | 2 | 0 | 0 | 12936 | 45.4 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 11073 | 40.6 |
| patch | 1/1 | 6 | 7 | 0 | 0 | 20254 | 65.5 |
| build | 1/1 | 6 | 6 | 0 | 0 | 20020 | 55.9 |
| sword | 5/5 | 5.4 | 8.4 | 0 | 0 | 30113 | 98.2 |
| sword+detailed | 5/5 | 5.8 | 9.4 | 0 | 0 | 32608 | 135.2 |
| spell | 5/5 | 5.8 | 6.2 | 0 | 0 | 19971 | 64.4 |
| spell+detailed | 5/5 | 6 | 7 | 2 | 0 | 21729 | 78.5 |
| npc | 5/5 | 7.4 | 7.8 | 1 | 0 | 30656 | 74 |
| npc+detailed | 5/5 | 5.8 | 6.2 | 0 | 0 | 18728 | 66 |
| note | 5/5 | 6 | 6.8 | 1 | 0 | 19007 | 79.8 |
| note+detailed | 5/5 | 6 | 6.6 | 0 | 0 | 18602 | 87.8 |

**Seen.**

- **e4b 41 of 45** (round 42: 41): filter 1 of 1 again, sword 8 of 10, spell 9, NPC 10, note 9. The build took a
  copied `FormKey` out in 12 runs, copied escapes in 3 and moved fields in 4; two of those runs failed. It refused 19
  builds in 9 runs (round 42: 7 in 7). The edit tool refused 10 of e4b's 32 edits (10 of 26); a turn's median thinking
  was 1,071 characters (1,060).
- **The filter task passed again:** Dawnguard.esm's first three armors were its own.
- **The fixes that came up:** an `EditorID` written with characters no editor ID has was cleaned in note #3, and a
  renamed copy of IronSword made a new record in sword+detailed #3 — both runs passed. The warning of no `Name` came in
  spell #4, which fixed it.
- **e4b's misses:**
  - spell+detailed #5 wrote Storm Bolt's strength, `Magnitude: 40`, in its new magic effect as well as in the spell's
    item, and was refused for it twice. Between the two it copied ShockDamageFFAimed's Flags — `Hostile`,
    `Detrimental`, `NoArea` — into the spell; told only the flags a spell takes, it took them out of the magic effect
    too. It answered "Calling buildProject now" without the call, unbuilt.
  - sword+detailed #4 wrote the price a second time in `BasicStats`, `Value: 25` and `Value: 150`, and left its
    enchantment unworn. Told both, it set the 25 to 150 and answered without building again.
  - sword+detailed #5 copied IronSword with addPatch and gave it the stats and the enchantment, keeping its name and
    editor ID: an override of the Iron Sword, built with no word, which it told the user was a new Flame Blade. 6 of
    the 11 sword runs of rounds 30–43 that made no new sword had copied IronSword.
  - note #4 copied Maven's text into its note.
- **The "delivered" line, ten rounds:** two misses answered with a file changed after its last build, sword+detailed
  #4 and spell+detailed #5 (round 42: none).
- **Swift-1.5 27B 45 of 45:** no build refused, 2 edits, 63 minutes; a turn's median thinking 453 characters.

**After the round (9b60110):**

- A magic effect's own `Data` goes to the one `Effects` item of the project that names it: taken out where that item
  has the same, moved in where it has none. 6 of the 8 runs refused one in rounds 30–43 had written 40 in both, and
  the 4 that failed were among them.
- A magic effect's flags in a spell's `Flags` are named in one problem as the magic effect's, to keep in its `Flags`.
- A weapon or armor copied from the load order, its name kept, and given the project's new enchantment is built with
  a warning that every one in the game carries it: if a new one was asked for, delete the FormKey line and give it an
  editor ID of its own.

**What it points at next:** a line written twice the same inside a part, as in sword+detailed #4's `BasicStats` after
its edit, is still refused, where the build takes the same line out at the margin.

## Round 44 — a magic effect's Data to the item that names it; e4b and Swift-1.5 27B (2026-10-24)

**Changed before it** (9b60110):

- A magic effect's own `Data` goes to the one `Effects` item of the project that names it, taken out where the item has
  the same; a magic effect's flags in a spell's `Flags` are named in one problem as the magic effect's; a load-order
  weapon or armor copied with its name kept and given the project's new enchantment is warned of.
- The eleventh round with AGENTS.md's "delivered" line. Nothing ran beside it.

gemma4:e4b, `all`, OpenClaw, at 682d958 (prompt ~6,660 tokens/s, generation ~173 tokens/s; first prompt 9947 tokens (26 tools, 16 of them this server's), think high, num_ctx 131072, num_predict none, temperature the Modelfile's, first token after 1.778 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 3 | 2 | 0 | 0 | 11850 | 98.1 |
| read | 1/1 | 3 | 2 | 0 | 0 | 11227 | 40.1 |
| filter | 1/1 | 4 | 3 | 0 | 0 | 16506 | 40.9 |
| patch | 1/1 | 4 | 3 | 0 | 0 | 13357 | 45.6 |
| build | 1/1 | 6 | 5 | 0 | 0 | 13626 | 45.9 |
| sword | 4/5 | 10.2 | 9.4 | 1 | 0 | 24554 | 73.2 |
| sword+detailed | 5/5 | 9 | 8.6 | 1 | 1 | 23735 | 68.7 |
| spell | 5/5 | 6.8 | 5.8 | 0 | 1 | 17475 | 50.7 |
| spell+detailed | 5/5 | 6.6 | 5.6 | 1 | 0 | 17292 | 49.4 |
| npc | 5/5 | 7.6 | 6.8 | 2 | 3 | 19009 | 53.2 |
| npc+detailed | 5/5 | 8 | 7.6 | 0 | 1 | 31935 | 57.6 |
| note | 5/5 | 6.6 | 5.6 | 1 | 0 | 18611 | 52.2 |
| note+detailed | 5/5 | 6.2 | 5.2 | 0 | 0 | 18254 | 55.6 |

Swift-1.5 27B IQ2_S, `all`, OpenClaw, at 682d958 (prompt ~1,904 tokens/s, generation ~64 tokens/s; first prompt 10397 tokens (26 tools, 16 of them this server's), think true, num_ctx 131072, num_predict none, temperature 1, first token after 0.911 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 10417 | 53.9 |
| read | 1/1 | 3 | 2 | 0 | 0 | 11400 | 42.1 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 11071 | 40.9 |
| patch | 1/1 | 5 | 5 | 0 | 0 | 19746 | 50.9 |
| build | 1/1 | 6 | 6 | 0 | 0 | 20066 | 56 |
| sword | 5/5 | 6.8 | 9 | 0 | 0 | 30879 | 91.7 |
| sword+detailed | 5/5 | 6.4 | 10 | 0 | 0 | 30846 | 148.5 |
| spell | 5/5 | 5.8 | 6.2 | 0 | 0 | 19836 | 64 |
| spell+detailed | 5/5 | 6 | 6.4 | 0 | 0 | 22244 | 65.2 |
| npc | 5/5 | 7 | 7.6 | 0 | 0 | 21990 | 69.9 |
| npc+detailed | 5/5 | 6 | 6.4 | 0 | 0 | 19893 | 68.6 |
| note | 5/5 | 6.2 | 7.2 | 0 | 0 | 21908 | 99.4 |
| note+detailed | 5/5 | 5.8 | 6.4 | 0 | 0 | 18737 | 85.6 |

**Seen.**

- **e4b 44 of 45** (round 43: 41), as in round 41: sword 9 of 10, spell 10, NPC 10, note 10, and the five simple
  tasks. The build took a copied `FormKey` out in 15 runs, copied escapes in 3 and moved fields in 3; none of those
  runs failed. It refused 4 builds in 4 runs (round 43: 19 in 9). The edit tool refused 6 of e4b's 11 edits (10 of
  32); a turn's median thinking was 1,016 characters (1,071).
- **None of round 43's fixes came up:** no run wrote a magic effect's strength in the effect, a spell with an effect's
  flags, or a copy of a load-order item given a new enchantment. The fixes that did: an `EditorID` from the file's
  name in spell+detailed #4, a FormKey two files shared in sword+detailed #4, and the warning of no `Name` in spell
  #4 and npc+detailed #4 — each run passed.
- **e4b's miss, sword #1:** asked findRecords for one sword, it was answered the Bound Sword and copied it with its
  `NonPlayable`, `BoundWeapon` and `CantDrop` flags, adding `- Weapon`; refused for that one, its next turn ended in a
  broken tool call, which OpenClaw answered `error_payload`.
- **What the checks did not see:** sword #3 copied the Bound Sword too, kept its flags, and passed. Replayed from their
  writes and edits, 10 of e4b's new swords of rounds 31–44 were so flagged — a conjured weapon, kept out of the
  player's inventory — and 9 of those runs passed; each had been answered the Bound Sword first for "sword", as it
  had been since round 30. None of Swift's.
- **The "delivered" line, eleven rounds:** the miss ended on the client's error, with no answer (round 43: two misses
  answered with a file changed after their last build).
- **Swift-1.5 27B 45 of 45:** no build refused, 2 edits, 64 minutes; a turn's median thinking 457 characters.

**After the round (a749cdc):**

- Among equal matches, findRecords puts a name with the text as a word of its own first — the Daedric Sword before
  the Daedric Greatsword — and what the player can have before NonPlayable and bound weapons and NonPlayable armor:
  "sword" now answers the Daedric Sword.
- A new weapon flagged `BoundWeapon` is built with a warning, unless a magic effect of the project conjures it.
  `NonPlayable` alone, an NPC's weapon the player cannot loot, is not warned of: 20 of the Creation Club's are so.

**What it points at next:** the eval's sword check passes a sword flagged as a bound one; a line written twice the same
inside a part is still refused.
