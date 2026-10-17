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
| 2026-10-17 | gemma4:e4b | `all` | 7c11e20 + round 17's changes, 9 tasks + 4 with the skill read + 4 detailed | 46/51 | 1.91 s | ~7,255 tokens/s | ~170 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all` | 7c11e20 + round 17's changes, the same | 51/51 | 5.62 s | ~1,004 tokens/s | ~49 tokens/s | 77% |
| 2026-10-17 | gemma4:e4b | `all` | b354106, Ollama 0.40.6 (0.40.4 before) | 48/51 | 2.31 s | ~6,936 tokens/s | ~171 tokens/s | 100% |
| 2026-10-17 | gemma4:26b | `all` | b354106, Ollama 0.40.6 | 51/51 | 14.14 s | ~674 tokens/s | ~49 tokens/s | 77% |

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

## Round 17 — a text's lines, a note's type, an escape's line (2026-10-17)

**Changed before it:**

- **A YAML break inside a text block** (`Value: >-`, `|`) is said as one: the line is part of the
  text, which ends at the first line indented less than its own first, and the rest is read as fields —
  "indent every line of the text by 4 spaces", with the line re-indented. Round 16's advice for a
  mapping had e4b rewrite a note five times.
- **The game's words for record types** in findRecords' suggestions: `NOTE`, `Letter`, `Journal`,
  `Tome` → `BOOK`; `Potion`, `Poison`, `Food` → `ALCH`; `Recipe` → `COBJ`; `Clutter` → `MISC`;
  `Arrow`, `Shield`, `Actor`, `Effect`, `Power` and others — the word itself before the types it
  begins (`Actor` is `NPC_` before `AVIF`).
- A probe of e4b alone (not logged) took 49 of 51, notes 8 of 9 against round 16's probe's 4 of 9: the
  text-block message fired once and the file was fixed in one write. Its one server-side miss: the
  copied-escapes refusal named "line 12 (two backslashes)" without the line; e4b edited another one,
  built again and gave up. So, still before the round: **the refusal quotes each line and gives it as it
  is to be written** — `File: Weapons\\Iron\\LongSword.nif` → `File: Weapons\Iron\LongSword.nif`.
- Also in the build since round 16, nothing the tasks touch: path settings read as a POSIX shell reads
  them (7c11e20).

gemma4:e4b, `all` (prompt ~7,255 tokens/s, generation ~170 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6384 | 3.5 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7387 | 4.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4839 | 3.1 |
| patch | 3/3 | 5 | 4 | 1 | 0 | 9246 | 8.9 |
| build | 3/3 | 5.7 | 4.7 | 0 | 0 | 13119 | 7.8 |
| sword | 3/3 | 7 | 6 | 1 | 0 | 12845 | 13.3 |
| sword+skill | 3/3 | 6 | 5 | 1 | 0 | 13266 | 12.1 |
| sword+detailed | 1/3 | 16 | 15 | 11 | 1 | 16033 | 57.8 |
| spell | 2/3 | 5 | 4 | 0 | 1 | 10447 | 29.5 |
| spell+skill | 2/3 | 4 | 3 | 0 | 0 | 9837 | 6.4 |
| spell+detailed | 3/3 | 5 | 4 | 0 | 0 | 10593 | 9.5 |
| npc | 3/3 | 5 | 4 | 0 | 0 | 9115 | 10.5 |
| npc+skill | 3/3 | 4.7 | 3.7 | 1 | 0 | 8709 | 7.6 |
| npc+detailed | 3/3 | 6.3 | 5.3 | 2 | 0 | 9887 | 11.9 |
| note | 3/3 | 7.7 | 6.7 | 4 | 0 | 8868 | 16 |
| note+skill | 3/3 | 8.3 | 7.3 | 3 | 0 | 18477 | 18.7 |
| note+detailed | 2/3 | 8 | 7 | 2 | 0 | 12770 | 15.2 |

gemma4:26b, `all` (prompt ~1,004 tokens/s, generation ~49 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 5875 | 6.2 |
| read | 3/3 | 3 | 2 | 0 | 0 | 6982 | 7.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6063 | 6.7 |
| patch | 3/3 | 4.7 | 3.7 | 0 | 0 | 8914 | 18.2 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 8125 | 13.6 |
| sword | 3/3 | 12.3 | 11.3 | 0 | 0 | 28423 | 101.4 |
| sword+skill | 3/3 | 7.3 | 6.3 | 1 | 0 | 15640 | 48.2 |
| sword+detailed | 3/3 | 13.3 | 12.3 | 3 | 0 | 22282 | 103.4 |
| spell | 3/3 | 5.7 | 4.7 | 0 | 0 | 12150 | 28.1 |
| spell+skill | 3/3 | 4 | 3 | 0 | 0 | 9548 | 15.6 |
| spell+detailed | 3/3 | 6.7 | 5.7 | 0 | 0 | 13360 | 37 |
| npc | 3/3 | 8.7 | 7.7 | 3 | 0 | 12793 | 40.5 |
| npc+skill | 3/3 | 4.7 | 3.7 | 1 | 0 | 8644 | 20.4 |
| npc+detailed | 3/3 | 8 | 7 | 1 | 0 | 14463 | 37.4 |
| note | 3/3 | 7.7 | 6.7 | 0 | 0 | 12693 | 47.4 |
| note+skill | 3/3 | 7 | 6 | 1 | 0 | 12637 | 37 |
| note+detailed | 3/3 | 7 | 6 | 0 | 0 | 12788 | 49.9 |

**Seen.**

- **26b: 51 of 51**, as in round 15 with JSON.
- **e4b: 46 of 51, and two of its five misses are one bug of the helper's.** In a `sword+detailed` run,
  an enchantment written with a misplaced `Data:` block of a dozen lines sent the field hint's search
  for an `EditorID` in the block (`RecordFiles.ValueOf`) into catastrophic backtracking: its pattern
  could split each line's indent and line end several ways, and with no `EditorID` there it tried them
  all. The call reached the server's 120 s, the helper was stopped, and the `spell` run whose build was
  queued behind it lost it ("the plugin helper exited"). Reproduced from the transcript, alone on the
  machine — not load — and fixed after the round (below).
- **Every copied escape was fixed by the next build**: six refusals (e4b 5, 26b 1), six one-edit fixes —
  the quoted line was pasted into the edit as it stood. The run that lost its sword after it lost it to
  field refusals on an enchantment written from memory: `Effects[0] has no field Damage (delete it)` —
  "damage is Magnitude, under Data" would be the better hint.
- **The type suggestions are taken**: four refusals (`NOTE` twice, `Note`, `WEPN`); once `BOOK` was
  sent next, once `WEAP`, twice the search went again with no type — a call each, as before, but never
  a dead end.
- e4b's other misses are its own: an override of Maven's note (`addPatch`) instead of a new one; a
  spell written from memory that built without a shock effect.

**Changed after it** (measured next round): `ValueOf`'s block pattern matches each line one way only —
the block that hung answers in milliseconds, the hint it looks for (`Enchantment:` above
`EditorID: X` → `ObjectEffect: X`) works as before with LF, CRLF and a blank line; and the helper sets a
5 s default match timeout on every pattern, so one like it fails a call, not the helper and the calls
behind it.

## Round 18 — a new Ollama, two new tools (2026-10-17)

**Changed before it:** round 17's change after it (`ValueOf`'s pattern; a 5 s timeout on every helper
pattern); path settings read as a POSIX shell reads them, the server finding the mod manager and the
Papyrus compiler itself, `npm run setup` — nothing the tasks touch; two new tools in every profile's list,
`listMods` and `checkGameVersion` (16 server tools, 17,689 bytes of schemas; no task asks for them); and
**Ollama 0.40.4 → 0.40.6**, the user's update before the round.

gemma4:e4b, `all` (prompt ~6,936 tokens/s, generation ~171 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6782 | 7.7 |
| read | 3/3 | 2.7 | 1.7 | 0 | 0 | 7772 | 3.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 5169 | 2.7 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 9294 | 7.7 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 10075 | 7.9 |
| sword | 3/3 | 8.7 | 7.7 | 3 | 0 | 16550 | 19.3 |
| sword+skill | 3/3 | 6 | 5 | 1 | 0 | 13700 | 11.6 |
| sword+detailed | 3/3 | 9 | 8 | 1 | 0 | 21250 | 24.7 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 11032 | 10.9 |
| spell+skill | 3/3 | 5.7 | 4.7 | 2 | 0 | 12750 | 11.3 |
| spell+detailed | 3/3 | 5.7 | 4.7 | 1 | 0 | 11614 | 16.6 |
| npc | 3/3 | 6 | 5.3 | 2 | 0 | 10539 | 14.5 |
| npc+skill | 3/3 | 7 | 6 | 3 | 2 | 10969 | 11 |
| npc+detailed | 3/3 | 8.7 | 7.7 | 5 | 0 | 11335 | 15.1 |
| note | 1/3 | 9.7 | 8.7 | 7 | 0 | 11903 | 44.4 |
| note+skill | 3/3 | 7.3 | 6.3 | 2 | 0 | 15473 | 16.9 |
| note+detailed | 2/3 | 11 | 10 | 8 | 0 | 12127 | 26 |

gemma4:26b, `all` (prompt ~674 tokens/s, generation ~49 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6334 | 10.7 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7436 | 10.8 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6534 | 8.4 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 8291 | 17.1 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 8508 | 35.1 |
| sword | 3/3 | 9.3 | 8.3 | 0 | 0 | 23958 | 331.2 |
| sword+skill | 3/3 | 6 | 5 | 0 | 0 | 13191 | 131 |
| sword+detailed | 3/3 | 15.7 | 14.7 | 6 | 1 | 28837 | 362.5 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 10254 | 74.7 |
| spell+skill | 3/3 | 4 | 3 | 0 | 0 | 9984 | 42.8 |
| spell+detailed | 3/3 | 6.3 | 5.3 | 1 | 0 | 11089 | 61.9 |
| npc | 3/3 | 6 | 5 | 1 | 0 | 9844 | 100.1 |
| npc+skill | 3/3 | 4.3 | 3.3 | 0 | 0 | 9285 | 22.4 |
| npc+detailed | 3/3 | 10.7 | 9.7 | 1 | 1 | 25927 | 55.7 |
| note | 3/3 | 8 | 7 | 1 | 0 | 13105 | 55.6 |
| note+skill | 3/3 | 6.7 | 5.7 | 0 | 0 | 12297 | 71.8 |
| note+detailed | 3/3 | 6.3 | 5.3 | 0 | 0 | 8451 | 97.1 |

**Seen.**

- **26b: 51 of 51** again; **e4b: 48 of 51** (round 17: 46) — no run lost to the helper, whose hang in
  round 17 cost two.
- **Ollama 0.40.6 is about 2.5 times slower for gemma4:26b on this machine at these contexts.** The same
  tasks, the same turns (~9.9k prompt tokens, ~290 written): 14.14 s a turn against 5.62 s. Ollama's own
  log, read for the two rounds' 26b windows: the prompt cache is used as before — 754 prompt tokens
  evaluated per request on average, median 328, the same checkpoints kept and dropped — but a request
  generates at ~26 tokens/s against ~61, and reads its new prompt tokens in 3.1 s against 1.0 s. The
  summary's benchmark (one short prompt, ~2.9k tokens) shows ~49 tokens/s for both: the slowdown is in long
  contexts. e4b barely moved (1.91 → 2.31 s a turn). The higher GPU load the user saw after the update is
  longer work, not more done. Hosting.md says so; rolling back is the user's call.
- e4b's three misses are notes, and each points at something to say: a single-quoted text with its
  apostrophe escaped by a backslash (`'Maven\'s Warning'` — YAML doubles it, `'Maven''s Warning'`), which
  the YAML break's message does not mention; a line the escape refusal quoted twice that e4b did not get
  right; and a whole text written on one line with literal `\n`, which the escape check does not look for.
- Neither model called `listMods` or `checkGameVersion` — no task asks for them; the test instance has no
  mods and no SKSE, so a task needs a laid-out mod or two first.
