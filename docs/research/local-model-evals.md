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

## Round 32 — the build corrects what has one right fix; bonsai-2:27b and Swift-1.5 27B beside e4b (2026-10-22/23)

**Changed before it:**

- The build corrects what has one right fix instead of refusing it (79459b2, the user's choice): a `FormKey`
  copied into a new record — or a placeholder, `000000`, one naming no record — is taken out and the record
  numbered; escapes copied out of a JSON answer are written as the line means. Each is listed in the answer's
  `corrected`, with its file; a refusal after it names them as "Corrected in the files already". A copy under
  addPatch's file name given another editor ID stays refused: an override renamed is the model's call.
- Five runs of each authoring task, one of the five others (`--runs 1 --authoring-runs 5`, d50a876): 45 runs a
  model, 40 of them authoring.
- OpenClaw's own skill reviews are off (`skills.workshop.autonomous.mode off`): one had run gemma4:12b during
  round 31's warm-up.
- Two new models, the user's, gemma4:12b and 26b being gone from the machine: **bonsai-2:27b** (Qwen3.5
  family, 26.9B, Q2_0) through the `skyrim` agent, and **Swift-1.5 27B** (`hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_S`,
  a fine-tune of Qwen3.8-27B) through `skyrim-swift`, both at 128k. Before their parts, at the user's word:
  temperature 1 for bonsai, and the line "Don't overthink: decide, then deliver the task." in the Skyrim
  workspace's AGENTS.md and setup's (95a3ec1) — e4b's part ran before it. Swift has the sampling its model
  card gives (temperature 1, top_p 0.95, top_k 20, min_p 0). The eval now records the temperature it sends and
  names the build it started on (257d32b): e4b's row had named 95a3ec1, a commit made during its last task.

gemma4:e4b, `all`, OpenClaw, at c676b39 (prompt ~7,176 tokens/s, generation ~182 tokens/s; first prompt 9878 tokens (26 tools, 16 of them this server's), think high, num_ctx 131072, num_predict none, first token after 1.77 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 11493 | 67.6 |
| read | 1/1 | 3 | 2 | 0 | 0 | 12638 | 41 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 10217 | 39.5 |
| patch | 1/1 | 6 | 5 | 0 | 0 | 17984 | 46.2 |
| build | 1/1 | 7 | 6 | 0 | 0 | 18276 | 47 |
| sword | 5/5 | 11.8 | 11 | 2 | 4 | 24625 | 78.1 |
| sword+detailed | 5/5 | 13 | 12 | 7 | 5 | 30766 | 90.5 |
| spell | 5/5 | 6.2 | 5.6 | 0 | 0 | 16789 | 48.2 |
| spell+detailed | 5/5 | 6 | 5.2 | 0 | 0 | 16567 | 44.7 |
| npc | 3/5 | 12.4 | 11.6 | 11 | 4 | 20470 | 72.9 |
| npc+detailed | 4/5 | 14.4 | 13.6 | 10 | 6 | 19578 | 86.1 |
| note | 5/5 | 7 | 6 | 3 | 0 | 14484 | 59.1 |
| note+detailed | 4/5 | 6.8 | 5.8 | 0 | 0 | 18376 | 52.4 |

bonsai-2:27b, `all`, OpenClaw, at 257d32b (prompt ~2,163 tokens/s, generation ~73 tokens/s; first prompt 10255 tokens (26 tools, 16 of them this server's), think high, num_ctx 131072, num_predict none, temperature 1, first token after 1.393 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 11853 | 48.3 |
| read | 1/1 | 3 | 2 | 0 | 0 | 13015 | 39.6 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 10969 | 47.6 |
| patch | 1/1 | 6 | 7 | 0 | 0 | 22860 | 100.7 |
| build | 1/1 | 6 | 6 | 0 | 0 | 20009 | 49.8 |
| sword | 5/5 | 6.8 | 9.2 | 1 | 0 | 28132 | 416.5 |
| sword+detailed | 5/5 | 7.4 | 10.6 | 2 | 0 | 28727 | 273.6 |
| spell | 5/5 | 6.8 | 8.8 | 2 | 0 | 22786 | 90.5 |
| spell+detailed | 5/5 | 6.6 | 7.4 | 1 | 0 | 22529 | 86.6 |
| npc | 5/5 | 7.8 | 9.6 | 0 | 0 | 25156 | 86.8 |
| npc+detailed | 5/5 | 6.8 | 7.4 | 0 | 0 | 26194 | 91.6 |
| note | 5/5 | 7 | 7.8 | 0 | 0 | 19486 | 217.2 |
| note+detailed | 5/5 | 6.2 | 7.2 | 0 | 0 | 22894 | 306.1 |

Swift-1.5 27B IQ2_S, `all`, OpenClaw, at 257d32b (prompt ~1,909 tokens/s, generation ~64 tokens/s; first prompt 10352 tokens (26 tools, 16 of them this server's), think true, num_ctx 131072, num_predict none, temperature 1, first token after 0.869 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 11929 | 49.2 |
| read | 1/1 | 2 | 3 | 0 | 0 | 17494 | 41.7 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 10994 | 41.2 |
| patch | 1/1 | 6 | 6 | 0 | 0 | 20743 | 55.8 |
| build | 1/1 | 5 | 6 | 0 | 0 | 20049 | 61.4 |
| sword | 5/5 | 6.4 | 8.4 | 0 | 0 | 27211 | 122.5 |
| sword+detailed | 5/5 | 6.6 | 10.8 | 0 | 0 | 31207 | 118.4 |
| spell | 5/5 | 5.4 | 6.6 | 0 | 0 | 19900 | 59.9 |
| spell+detailed | 5/5 | 7 | 7.8 | 0 | 0 | 26340 | 78.1 |
| npc | 5/5 | 6 | 6.8 | 1 | 0 | 26382 | 61.7 |
| npc+detailed | 5/5 | 6.6 | 7 | 1 | 0 | 18967 | 67.4 |
| note | 5/5 | 5.6 | 7 | 0 | 0 | 18631 | 67.6 |
| note+detailed | 5/5 | 6.4 | 7.2 | 0 | 0 | 22433 | 80.7 |

**Seen.**

- **e4b 41 of 45**, round 31 34 of 39 — the same within the noise. **The corrections worked:** in 15 of its
  45 runs the build corrected something — a `FormKey` copied from IronSword or Maven's note in 11, copied
  escapes in 3 — and 11 of those built at once. No run met the copied-FormKey refusal; in round 31, six had,
  and one failed after it.
- **Three of e4b's four misses were one NPC mistake:** Hilda's `Level`, `CalcMinLevel` and `CalcMaxLevel` in
  the wrong place, the refusal saying where they go. npc #3 nested them inside `Level`, then wrote all four in
  `Level`'s braces, wrote the right lines once and overwrote them before its next build, and ran out of turns;
  npc #4 wrote them at the margin, then claimed a build it never ran; npc+detailed #5 wrote them as items of
  `Flags`, then indented the rest of the record under `Configuration`, and ran out of turns. The fourth,
  note+detailed #5, wrote a text of its own for the note ("If this note reaches you, it means I have finally
  decided…") instead of Maven's, word for word.
- **bonsai-2:27b 45 of 45**, with one build refusal in 45 runs and no correction needed. It wrote files whole —
  2 edits in the round, against e4b's 39 (19 of them refused) — often made several calls in a turn, and took
  fewer turns than e4b: a sword in 6.8 (e4b 11.8), an NPC in 7.8 (12.4). It is slow: 22 s a turn, a sword run
  7 minutes on average and 17 at most, the round 136 minutes (e4b 48). At 256k first, 29% of its 19 GB went
  to the CPU and the first task took 103 s against 48 at 128k; the user set it back to 128k.
- **Swift-1.5 27B 45 of 45**, one build refusal, 3 edits, none refused, in 59 minutes: it thinks little — a
  turn's median 459 characters of thinking, e4b's 1,090, bonsai's 929 — and a turn takes 8.5 s. Its first
  attempt failed on every request: its chat template takes the reasoning efforts `xhigh` (its default),
  `medium` and `low`, and raises on the `high` OpenClaw sends for thinking max, which Ollama answers with 500.
  OpenClaw sends a model entry's own `think` only where the agent's thinking is off: so the Swift agents'
  thinking is off and the model entry's `params.think` is true, which reaches the template as its default.

**What it points at next:** the misplaced field. 13 of the 27 runs e4b failed in rounds 23–32 had been told
to move a field, three of round 32's four; the branch `build-moves-misplaced-fields` (0d195bb) moves one with
one place to go, as the copied `FormKey` is taken out. The two 27B models got everything done with almost no
help from the server's refusals: what holds them back is time, bonsai's most.

## Round 33 — the build moves a misplaced field, three models (2026-10-23)

**Changed before it:**

- The build moves a field written where its record's type has none to the one place it goes, before the files
  are checked, and lists it in `corrected` as it does a copied `FormKey` (bc536f7): a part's field at the
  margin under that part — an NPC's `Level`, `CalcMinLevel`, `CalcMaxLevel` and `SpeedMultiplier` under
  `Configuration`, a weapon's `Value` under `BasicStats` — and a field a level too deep up below the part it
  was written in, braces included. Still refused: a field its place has already, one "in each item of
  Effects", and a part of several kinds not written yet (a magic effect's `Archetype`). 13 of the 27 runs e4b
  failed in rounds 23–32 had been told to move a field, three of round 32's four.
- e4b's first round with the AGENTS.md line "Don't overthink: decide, then deliver the task." (bonsai and
  Swift had it in round 32 already).

gemma4:e4b, `all`, OpenClaw, at 054ac8a (prompt ~7,228 tokens/s, generation ~164 tokens/s; first prompt 9915 tokens (26 tools, 16 of them this server's), think high, num_ctx 131072, num_predict none, temperature the Modelfile's, first token after 1.754 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 3 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 11596 | 49.9 |
| read | 1/1 | 4 | 4 | 0 | 0 | 19045 | 38.8 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 10257 | 36 |
| patch | 1/1 | 7 | 6 | 1 | 0 | 18046 | 45.6 |
| build | 1/1 | 6 | 5 | 0 | 0 | 15270 | 45.8 |
| sword | 4/5 | 12.2 | 11.4 | 3 | 4 | 27413 | 85.2 |
| sword+detailed | 5/5 | 9.8 | 8.8 | 0 | 0 | 25085 | 68 |
| spell | 5/5 | 7.8 | 6.8 | 0 | 4 | 18592 | 51.5 |
| spell+detailed | 5/5 | 6 | 5.4 | 0 | 0 | 16658 | 56.8 |
| npc | 5/5 | 7.4 | 6.6 | 0 | 0 | 18727 | 52 |
| npc+detailed | 5/5 | 9 | 8.8 | 4 | 2 | 18286 | 57.8 |
| note | 5/5 | 6.4 | 5.4 | 1 | 0 | 18436 | 52.1 |
| note+detailed | 3/5 | 9.8 | 8.8 | 2 | 14 | 19485 | 66.5 |

bonsai-2:27b, `all`, OpenClaw, at 054ac8a (prompt ~2,179 tokens/s, generation ~73 tokens/s; first prompt 10264 tokens (26 tools, 16 of them this server's), think high, num_ctx 131072, num_predict none, temperature 1, first token after 1.646 s (median of the first turns), 2 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 2 | 0 | 0 | 13490 | 56.3 |
| read | 1/1 | 3 | 2 | 0 | 0 | 12841 | 40.2 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 13715 | 42.2 |
| patch | 1/1 | 8 | 8 | 0 | 0 | 23314 | 71.3 |
| build | 1/1 | 5 | 6 | 0 | 0 | 19032 | 50.3 |
| sword | 4/5 | 6.6 | 9.4 | 2 | 0 | 26641 | 429 |
| sword+detailed | 4/5 | 6.6 | 10 | 1 | 0 | 31751 | 429.8 |
| spell | 5/5 | 7.8 | 8.2 | 3 | 0 | 21847 | 76.1 |
| spell+detailed | 5/5 | 7 | 8.4 | 2 | 0 | 23962 | 105.1 |
| npc | 5/5 | 8.4 | 11.6 | 0 | 0 | 23300 | 103 |
| npc+detailed | 5/5 | 7 | 9.2 | 2 | 0 | 25553 | 101.3 |
| note | 5/5 | 6.4 | 7.2 | 0 | 0 | 22817 | 275.7 |
| note+detailed | 5/5 | 7.4 | 8 | 0 | 0 | 21060 | 435.2 |

Swift-1.5 27B IQ2_S, `all`, OpenClaw, at 054ac8a (prompt ~1,920 tokens/s, generation ~64 tokens/s; first prompt 10365 tokens (26 tools, 16 of them this server's), think true, num_ctx 131072, num_predict none, temperature 1, first token after 1.576 s (median of the first turns), 0 answers cut off, 0 turns ended at the length limit, 0 side requests):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 1/1 | 2 | 1 | 0 | 0 | 11910 | 52 |
| read | 1/1 | 3 | 3 | 0 | 0 | 14591 | 42.4 |
| filter | 1/1 | 2 | 1 | 0 | 0 | 13774 | 42.4 |
| patch | 1/1 | 4 | 4 | 0 | 0 | 18055 | 46.5 |
| build | 1/1 | 6 | 6 | 0 | 0 | 19960 | 49.8 |
| sword | 5/5 | 7 | 8.8 | 0 | 0 | 27035 | 116.3 |
| sword+detailed | 5/5 | 6.8 | 10.4 | 0 | 0 | 32390 | 133.2 |
| spell | 5/5 | 5.8 | 6.4 | 0 | 0 | 21572 | 60.6 |
| spell+detailed | 5/5 | 6.4 | 7.4 | 1 | 0 | 22012 | 76 |
| npc | 5/5 | 6 | 7 | 0 | 0 | 21656 | 66.1 |
| npc+detailed | 5/5 | 6.6 | 7 | 0 | 0 | 21740 | 65 |
| note | 5/5 | 6.2 | 7.2 | 1 | 0 | 22736 | 79.4 |
| note+detailed | 5/5 | 6.4 | 7.2 | 0 | 0 | 21877 | 107.4 |

**Seen.**

- **e4b 42 of 45** (round 32: 41), **its NPC 10 of 10** (7). The build moved fields in three NPC runs, and all
  three passed: Hilda's level lines at the margin under `Configuration` (npc #4), and twice a vanilla NPC's
  `Health`, `Magicka`, `Stamina`, `GearedUpWeapons` and `Unused2` under `PlayerSkills` (npc #1, #5). It took
  a copied `FormKey` out in 10 runs and copied escapes in 2. The edit tool refused 10 of its 28 edits (round 32:
  19 of 39); a turn's median thinking was 1,021 characters (1,090) — the new line changed little of that, and
  with the moves in the same round the two cannot be told apart.
- **e4b's three misses were the model's:** sword #4 renamed addPatch's copy of IronSword, was refused for it,
  and ended on an empty turn (`clientError:error_payload`); note+detailed #3 copied Maven's note with addPatch,
  built it before renaming it, and answered without building again — an override of the vanilla note, no new
  one. note+detailed #1 named its note `MavenNote:MavenWarning` and wrote `Books\MavenNote:MavenWarning.yaml`:
  OpenClaw's `write` refused it 15 times as "absolute path uses a Windows filesystem namespace alias" — a colon
  in a file name is an NTFS stream on Windows, which the message does not say — the only such refusal in
  rounds 30–33.
- **bonsai-2:27b 43 of 45, one failure counted twice.** It met no build refusal and needed no correction. Its
  sword #5 fell into a loop in its thinking, writing IronSword's `Model:` `Data:` hex over and over — 68,000
  characters — until the run's 20 minutes were up. Ollama went on generating for 36 minutes 44 s: the eval's
  proxy had stopped reading but not ended the request, and sword+detailed #1's first turn waited 17 minutes
  27 s behind it and timed out too. Fixed in the eval after the round (28c6a5a): a request OpenClaw gives up
  on is ended at Ollama too. Otherwise bonsai's longest finished answers were 27,334 and 20,395 tokens, in
  runs that passed.
- **Swift-1.5 27B 45 of 45** again, no build refusal, 2 edits, in 63 minutes; a turn's median thinking 390
  characters.
- **An OpenClaw job ran in the round:** its daily "Memory Dreaming Promotion" started at 03:00 as the default
  agent `main`, on bonsai, and Ollama took e4b off the GPU to load it (03:00:10); spell+detailed #5's first turn
  waited 54 s for that and e4b's reload. The run passed. The job is still on, at 03:00 every day.

**What it points at next:** for the server, little: e4b's misses no longer share a cause, and the 27B models
meet almost no refusal. A cap on bonsai's answers would have bounded a loop like sword #5's in the user's own
chats too; the user removed bonsai and its agents after the round, and `swift` became the default agent.
