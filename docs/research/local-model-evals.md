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

Before the first task the script loads the model with a short "hi" at the round's context, so no task
pays for the load; a model that was not loaded yet (a switch) gets `--settle` seconds more (60).
`--client claude-code` runs the same tasks through Claude Code itself, headless, with the model behind
a logging proxy in front of Ollama ([`scripts/eval-claude-code.mjs`](../../scripts/eval-claude-code.mjs)):
the client a VS Code user with a local model has, its own system prompt and tools included, set up as
the lean workspace below. Its entry adds a line: the first prompt's tokens and tools, the time to the
first token, answers cut off, side requests. Its seconds include each session's start, where the
server builds its record index again. `+skill` runs are left out there.

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
| note | a new mod MavenNote: a new note "Maven's Warning" with exactly the text of the vanilla note "Note From Maven", built | a new book of that name whose text is the vanilla one (read from the instance; whitespace collapsed, so how a block is folded does not count, but a `\"` or `\n` left in does), and the build succeeded |

**No escapes copied** (from round 15): every task that leaves record files also passes only when none
of them holds an escape a copy should have decoded — a doubled backslash or a `\"` outside a
double-quoted string, or one still there once the string is decoded. It is what copying a JSON string
as it reads leaves: e4b wrote `File: Weapons\\Iron\\Sword.nif` in rounds 12–13. `note` (from round 15)
is the task built to show it: a text with quotes and line breaks, and a model path with backslashes.

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
| 2026-10-16 | gemma4:e4b | `all` | db246fb + round 15's changes, 9 tasks + 4 with the skill read + 4 detailed | 45/51 | 1.98 s | ~6,955 tokens/s | ~166 tokens/s | 100% |
| 2026-10-16 | gemma4:e4b | `all`, text+tables | db246fb + round 15's changes, the same | 47/51 | 1.94 s | ~7,318 tokens/s | ~162 tokens/s | 100% |
| 2026-10-16 | gemma4:26b | `all` | db246fb + round 15's changes, the same | 51/51 | 5.12 s | ~996 tokens/s | ~48 tokens/s | 77% |
| 2026-10-16 | gemma4:26b | `all`, text+tables | db246fb + round 15's changes, the same | 50/51 | 5.19 s | ~1,003 tokens/s | ~49 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all`, Claude Code | db246fb + rounds 15–16's changes, 9 tasks + 4 detailed | 35/39 | 2.5 s | ~6,983 tokens/s | ~166 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all`, Claude Code | db246fb + rounds 15–16's changes, 9 tasks + 4 detailed | 38/39 | 2.99 s | ~1,022 tokens/s | ~50 tokens/s | 77% |

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

`--client claude-code` runs in that lean setup: the same denied built-ins, non-essential traffic off,
side requests on the model under test, only this server.

## Round 15 — answers in another form than JSON, a note to copy, escapes checked (2026-10-16)

**Changed before it:** an idea of the user's — that local models might read answers better in a form
other than JSON — measured for quality, since reading answers is a small part of the time (reference
measurements above). Rows marked `text+tables` ran with it.

- **A temporary switch, `MCP_ANSWER_FORMAT`**, applied where every answer passes: `json` as always;
  `text`, the short facts on one line of JSON and every string with a line break after it, as itself,
  in a fence named by where it sits (``text 1 (versions[0].files[0].text) — Weapons/IronSword - 012EB7_Skyrim.esm.yaml:``),
  so a record arrives without `\n`, `\"` and doubled backslashes; `text+tables`, also each list of flat
  rows as a markdown table, its keys written once.
- **The eval**: the `note` task and the no-escapes check (above); the warm-up before the first task;
  `--client claude-code` (reference measurements above).
- **Builds**: a record file with a markdown fence in it is refused, naming its lines — e4b copied
  ```` ```yaml ```` with the YAML in the probes, and the reader's message sent it to fix the indentation; a
  file nested below a group's folder whose record the group's folder holds is left out with a warning
  — e4b wrote an enchantment again from `ObjectEffects/Enchantments/` into `ObjectEffects/`, and the first
  copy failed every build after.
- Probes of e4b alone, one per format (not logged): `json` 44/51, `text` 44/51, `text+tables` 49/51.

gemma4:e4b, `all` (prompt ~6,955 tokens/s, generation ~166 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 2/3 | 1.7 | 0.7 | 0 | 0 | 6094 | 2.8 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7318 | 3.4 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4735 | 2.8 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 8207 | 7.8 |
| build | 3/3 | 5.3 | 4.3 | 1 | 0 | 8695 | 7.9 |
| sword | 3/3 | 6.7 | 5.7 | 1 | 0 | 13186 | 15.1 |
| sword+skill | 2/3 | 5 | 4 | 0 | 0 | 11975 | 9.9 |
| sword+detailed | 2/3 | 8 | 7.3 | 1 | 0 | 18367 | 20.3 |
| spell | 3/3 | 5.3 | 4.3 | 0 | 0 | 10611 | 9.5 |
| spell+skill | 2/3 | 5 | 4 | 1 | 0 | 11093 | 8.4 |
| spell+detailed | 3/3 | 5 | 4 | 0 | 0 | 10647 | 10.1 |
| npc | 3/3 | 7.7 | 6.7 | 4 | 0 | 9799 | 14 |
| npc+skill | 3/3 | 7 | 6 | 3 | 0 | 10329 | 10.7 |
| npc+detailed | 3/3 | 7.7 | 6.7 | 4 | 0 | 10570 | 15.2 |
| note | 2/3 | 8.3 | 7.3 | 4 | 0 | 11785 | 19.2 |
| note+skill | 2/3 | 8.7 | 7.7 | 5 | 0 | 14778 | 20.7 |
| note+detailed | 3/3 | 8.7 | 7.7 | 3 | 0 | 14977 | 21.1 |

gemma4:e4b, `all`, `text+tables` (prompt ~7,318 tokens/s, generation ~162 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2.3 | 1.3 | 1 | 0 | 5857 | 3.2 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7076 | 3.9 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4717 | 2.7 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 7637 | 5.8 |
| build | 3/3 | 5.3 | 4.3 | 1 | 0 | 8379 | 7.1 |
| sword | 3/3 | 6.3 | 5.3 | 0 | 0 | 12686 | 13.9 |
| sword+skill | 3/3 | 6 | 5 | 0 | 0 | 13954 | 15.5 |
| sword+detailed | 3/3 | 12 | 11 | 4 | 1 | 22032 | 27 |
| spell | 1/3 | 6 | 5 | 1 | 0 | 12024 | 10.7 |
| spell+skill | 3/3 | 4.3 | 3.3 | 0 | 0 | 10639 | 7.1 |
| spell+detailed | 2/3 | 10 | 9 | 6 | 1 | 19189 | 25.4 |
| npc | 3/3 | 7 | 6 | 3 | 0 | 10825 | 14.6 |
| npc+skill | 3/3 | 4.7 | 3.7 | 1 | 0 | 9056 | 7.6 |
| npc+detailed | 2/3 | 6.7 | 6 | 3 | 0 | 10883 | 13.9 |
| note | 3/3 | 8 | 7 | 4 | 0 | 9952 | 16.6 |
| note+skill | 3/3 | 7 | 6 | 1 | 0 | 12531 | 11.4 |
| note+detailed | 3/3 | 7.3 | 6.3 | 3 | 0 | 8309 | 15 |

gemma4:26b, `all` (prompt ~996 tokens/s, generation ~48 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5872 | 5.9 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6969 | 7.2 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6072 | 6.7 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 7679 | 14.3 |
| build | 3/3 | 5.7 | 4.7 | 0 | 0 | 8071 | 14 |
| sword | 3/3 | 8.7 | 7.7 | 0 | 0 | 20857 | 65.1 |
| sword+skill | 3/3 | 7.7 | 6.7 | 0 | 0 | 14586 | 40.2 |
| sword+detailed | 3/3 | 12 | 11 | 3 | 0 | 22023 | 93.9 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 9920 | 26.4 |
| spell+skill | 3/3 | 4 | 3 | 0 | 0 | 9607 | 16.3 |
| spell+detailed | 3/3 | 5 | 4 | 0 | 0 | 9885 | 25.7 |
| npc | 3/3 | 5.7 | 4.7 | 1 | 0 | 9244 | 25.3 |
| npc+skill | 3/3 | 5.3 | 4.3 | 2 | 0 | 9055 | 23.3 |
| npc+detailed | 3/3 | 8.7 | 7.7 | 1 | 0 | 15779 | 38.4 |
| note | 3/3 | 7 | 6 | 0 | 0 | 11564 | 34.9 |
| note+skill | 3/3 | 6 | 5 | 0 | 0 | 11875 | 31 |
| note+detailed | 3/3 | 8 | 7 | 0 | 0 | 12180 | 44.7 |

gemma4:26b, `all`, `text+tables` (prompt ~1,003 tokens/s, generation ~49 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5473 | 5.1 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6576 | 6.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 5689 | 6.4 |
| patch | 3/3 | 4.7 | 3.7 | 0 | 0 | 8322 | 13.4 |
| build | 3/3 | 5 | 4 | 0 | 0 | 7458 | 13.4 |
| sword | 3/3 | 10 | 9 | 0 | 0 | 19542 | 65.8 |
| sword+skill | 3/3 | 6 | 5 | 0 | 0 | 13005 | 36.5 |
| sword+detailed | 3/3 | 15.3 | 14.3 | 4 | 0 | 26591 | 107.1 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 9829 | 24.2 |
| spell+skill | 3/3 | 4 | 3 | 0 | 0 | 9465 | 16.2 |
| spell+detailed | 3/3 | 5.7 | 4.7 | 0 | 0 | 11964 | 33.6 |
| npc | 3/3 | 6.7 | 5.7 | 2 | 0 | 10472 | 26.3 |
| npc+skill | 3/3 | 6 | 5 | 3 | 0 | 9340 | 30.2 |
| npc+detailed | 3/3 | 9.3 | 8.3 | 2 | 0 | 12271 | 46.3 |
| note | 3/3 | 8 | 7 | 1 | 0 | 12393 | 43.1 |
| note+skill | 3/3 | 6 | 5 | 0 | 0 | 11677 | 29.8 |
| note+detailed | 2/3 | 11.3 | 10.3 | 4 | 0 | 16659 | 70.3 |

**Seen.**

- **The form's one measurable effect is the escapes.** With JSON, e4b left a doubled backslash in a
  model path (`File: Clutter\\Books\\Note03.nif`) in 3 of 51 runs — as in its probe, and in rounds
  12–13 — and each of those runs failed on that alone; the build had taken the file. With the other
  forms: none in 102 e4b runs. 26b left none with either.
- What the fences cost: e4b wrote one into the record file 5 times in 102 runs; each was refused and
  fixed.
- **Beyond the escapes, no difference.** e4b without its three escape failures is 48 of 51 with JSON
  against 47 with `text+tables`; tables showed nothing of their own. 26b: 51 of 51 with JSON against
  50, in fewer turns (299 against 330) and less time (1,540 s against 1,723 s). Its one miss was a
  `.yml` file it wrote again as `.yaml` but could not delete: every build after refused the `.yml`,
  until 26b built a second project, `MavenNote_New`.
- Every note that was made had the vanilla text exactly, quotes and line breaks included — 34 of 34,
  both models, both forms: decoding a text out of a JSON string was never the problem; a path's
  backslashes were.
- Both models still spend invalid arguments on an NPC's level and a templated weapon's lines.

**Decided with the user:** JSON stays the only form, and the switch is removed. The escapes are
caught where they do harm instead, by the build, for every client.

**Changed after it** (measured next round): a record file with the escapes of a JSON answer copied in
— two backslashes in a path, a backslash before a quote — is refused, naming each file and line
(nothing found on the 6,038 files of the five Creation Club plugins); a `.yml` file beside its `.yaml`
twin is left out with a warning; `MCP_ANSWER_FORMAT` is gone.

## Round 16 — through Claude Code (2026-10-17)

**Changed before it:** round 15's three changes after it. A probe of e4b alone on the eval's own
client (not logged) took 45 of 51: the escape refusal fired five times and e4b rewrote the line each
time — `sword+skill` and `sword+detailed` 3/3, where round 15 lost one run of each to escapes — and no
run left an escape behind. The round itself is `--client claude-code`: the user's real client, the VS
Code extension's CLI (2.1.301) on Ollama, set up lean (reference measurements above). `+skill` runs
cannot be made there, so 13 tasks, 39 runs.

gemma4:e4b, `all`, Claude Code (prompt ~6,983 tokens/s, generation ~166 tokens/s). First prompt 7,693
tokens, 22 tools; first token after 0.19 s (median of the first turns); no answer cut off, no side
request:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 9424 | 12.7 |
| read | 3/3 | 3 | 2 | 0 | 0 | 10831 | 14 |
| filter | 3/3 | 2.3 | 1.3 | 0 | 0 | 8697 | 13.6 |
| patch | 3/3 | 5 | 4 | 0 | 0 | 12334 | 19.5 |
| build | 3/3 | 6 | 5 | 0 | 0 | 13312 | 20.7 |
| sword | 3/3 | 7.3 | 6.7 | 1 | 0 | 22617 | 27.1 |
| sword+detailed | 3/3 | 11 | 10.3 | 3 | 0 | 25830 | 44.9 |
| spell | 2/3 | 11 | 9.7 | 7 | 4 | 28715 | 40.8 |
| spell+detailed | 3/3 | 6.7 | 5.7 | 1 | 0 | 19599 | 29.4 |
| npc | 3/3 | 5 | 4 | 0 | 0 | 12372 | 18.2 |
| npc+detailed | 3/3 | 6.3 | 5.3 | 2 | 0 | 13261 | 23.1 |
| note | 2/3 | 10.3 | 9.3 | 7 | 0 | 14337 | 34.2 |
| note+detailed | 1/3 | 7.3 | 6.3 | 6 | 0 | 13937 | 25.1 |

gemma4:26b, `all`, Claude Code (prompt ~1,022 tokens/s, generation ~50 tokens/s). First prompt 7,691
tokens, 22 tools; first token after 1.27 s; one answer cut off (below), no side request:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 9293 | 16.5 |
| read | 3/3 | 3 | 2 | 0 | 0 | 10433 | 19.1 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 9613 | 21.6 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 12086 | 26 |
| build | 3/3 | 5 | 4 | 0 | 0 | 11384 | 27.3 |
| sword | 3/3 | 12 | 11 | 0 | 0 | 29235 | 102.2 |
| sword+detailed | 3/3 | 10 | 9 | 0 | 0 | 25317 | 85.2 |
| spell | 3/3 | 7.3 | 6.3 | 0 | 0 | 18349 | 61.6 |
| spell+detailed | 3/3 | 8 | 7 | 0 | 0 | 18649 | 65.6 |
| npc | 3/3 | 9 | 8 | 2 | 2 | 17590 | 51.1 |
| npc+detailed | 3/3 | 7.7 | 6.7 | 0 | 0 | 15230 | 55.4 |
| note | 2/3 | 233.3 | 232.3 | 0 | 9 | 64125 | 456.4 |
| note+detailed | 3/3 | 8.7 | 7.7 | 2 | 0 | 17252 | 75.8 |

**Seen.**

- **Claude Code passes what the eval's own client passes.** On the same 13 tasks: e4b 35 of 39 both
  ways (the probe above); 26b 38 of 39 against 39 of 39 in round 15. Turns are a little higher (e4b
  250 against 233; 26b 259 against 230, the looping run left out), time much higher (e4b 970 s against
  466 s; 26b 1,991 s against 1,207 s): each run is a new session, whose server builds its record index
  again (~10 s), and every turn carries ~7,700 tokens of Claude Code's own.
- **26b looped in Claude Code:** in one `note` run it called `Glob` on `MavenNote/plugin/Books` 672 times
  in a row, "No files found" each time, until the eval stopped it at 20 minutes — its one cut-off answer.
  Nothing of the server's was involved. Claude Code in print mode has no turn limit of its own; the
  eval now passes `--max-turns` (25, as its own client), which the CLI takes though its help does not
  list it. In the extension, a user stops such a loop by hand.
- e4b's misses: a spell with a magic effect of its own whose conditions it never got right; a note
  without its `<font>` markup ("exactly the text" taken for the words); an override of Maven's note
  (`addPatch`) instead of a new one; and a note searched for as type `NOTE` — refused with no
  suggestion, though a note is a book (`BOOK`); 26b did the same in round 15.
- In the probe, a note's text block that lost its indentation: the build's message for a YAML break
  inside a text block (`Value: >-` and its lines) says to indent a field's own fields and give every
  line a `Field: value` — advice for a mapping, not a text; e4b rewrote the file five times and never
  indented the text.
