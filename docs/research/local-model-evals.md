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
every model's.

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

## Round 23 — round 22's fixes, gemma4:e4b alone (2026-10-21)

**Changed before it** — what round 22 pointed at, and two fixes after an e4b probe (not recorded: 36/39):

- A link whose comment names another record than its FormID is refused with both: "DefaultOutfit is
  105543:Skyrim.esm, which is WEWarriorTankOutfit, but the comment after it names ArmorIronAllOutfit …
  Write the one meant by its editor ID" (b6db01d).
- A refusal to move lines up to where they go says to write them again there — delete them from the block
  and write them again at the margin, below its last line — or, when they are its last lines, to take the
  two spaces out in front of them (b6db01d).
- addPatch's answer opens with what it copied: "IronSword (012EB7:Skyrim.esm) is copied as an override: it
  changes that record itself, everywhere the game uses it … If a new record like it was meant, write a new
  file instead" (00fc260).
- The probe's fixes (2949683): a warning on a file the build renamed names it by its new name, with the
  old one; two files with one editor ID, one of them new, are refused; a top-level field written twice is
  named in the same refusal as the fields the type lacks; and "move them under PlayerSkills" says to delete
  them at the margin and write them again below `PlayerSkills:`, with its line.
- From this round a round measures gemma4:e4b alone (f9cb81c), and the eval records OpenClaw's answer cap
  and the turns that ended at it (d4fc031). The user's configuration caps 12b's answers at 16,384 tokens
  (`num_predict`); e4b's are not capped.

gemma4:e4b, `all`, OpenClaw (prompt ~7,319 tokens/s, generation ~179 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 11492 | 42.9 |
| read | 3/3 | 3 | 2 | 0 | 0 | 12674 | 40 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 11621 | 39 |
| patch | 3/3 | 6 | 5 | 1 | 1 | 20976 | 48.4 |
| build | 3/3 | 7.7 | 6.7 | 0 | 0 | 21423 | 47.7 |
| sword | 2/3 | 15.7 | 15 | 7 | 1 | 25085 | 89 |
| sword+detailed | 2/3 | 12.7 | 11.7 | 4 | 0 | 26777 | 78.8 |
| spell | 3/3 | 6 | 5 | 0 | 0 | 16730 | 45.8 |
| spell+detailed | 2/3 | 14 | 13.3 | 5 | 1 | 23740 | 93 |
| npc | 3/3 | 8.3 | 7.3 | 2 | 0 | 18882 | 52.3 |
| npc+detailed | 3/3 | 14.7 | 13.7 | 6 | 4 | 35218 | 107.1 |
| note | 3/3 | 8.3 | 7.3 | 2 | 0 | 18947 | 57.9 |
| note+detailed | 3/3 | 8 | 7 | 3 | 0 | 13941 | 54.7 |

Through OpenClaw 2026.10.4 (383c124): first prompt 9,788 tokens (26 tools, 16 of them this server's),
think high, num_ctx 131072, no answer cap; no answer cut off, no turn ended at the length limit, no side
requests; first token after 1.7 s, the median of the first turns.

**Seen.**

- **e4b 36 of 39** (round 22: 33), swords 4 of 6 (2 of 6), NPCs and notes 6 of 6 each, spells 5 of 6. One
  authoring run made its record with addPatch (round 22: four).
- **The new answers did their part where they came:**
  - npc+detailed #1 linked its outfit to WEWarriorTankOutfit, with a comment naming ArmorIronAllOutfit.
    Refused with both, it wrote the iron outfit's FormID and built.
  - npc+detailed #2 built Hilda with no Name, and the warning named her file by both names. e4b edited
    the old name once, found no such file, read the new one and gave her a name — two calls, where the
    probe's run spent nine and then wrote a second Hilda.
  - "Delete them at the margin and write them again below …" came in three NPC runs, which all passed:
    two fixed it at the next build, npc+detailed #1 at the second. It came in sword+detailed #3 too,
    below.
  - sword #2, told to remove a copied FormKey line, again wrote the line below it over it. It was refused
    for `VersionControl` written twice, then for `EditorID` written twice, then wrote the file anew and
    built.
- **sword #1 read past addPatch's note.** It copied IronSword, whose answer opened "IronSword
  (012EB7:Skyrim.esm) is copied as an override: it changes that record itself, everywhere the game uses
  it", renamed it Flame Blade and gave it a new enchantment. The build warned that Iron Sword is renamed
  wherever it is, and e4b told the user that "the sword record was successfully overridden and renamed".
  Its other warning was false: "no record of the project names FlameBladeEnch" — the overriding sword did,
  but the note looks only through the project's new records.
- **sword+detailed #3 planned both fixes and made no call.** Refused for `Value` at the margin and for one
  FormKey written in both its new files, it thought both edits through ("Let's execute the edits.") in a
  turn of 2,471 tokens that left no text and no call. OpenClaw ended the run on the failed build, as it
  ended round 22's 12b npc #2.
- **spell+detailed #1: two refusals pointed away from the fix.**
  - Its magic effect had the spell's `Data: Magnitude: 40` at the margin, answered "a MagicEffect has no
    field Data (move it in each item of Conditions)". The magnitude belongs in the spell's Effects item,
    where e4b had written it as well.
  - Its spell had `MagicSkill: Destruction`, answered "a spell's school is the MagicSkill of the magic
    effects its Effects name". e4b took MagicSkill out of the effect and kept it in the spell.
  - Twice it called `readRecord`, the name the refusals give, which OpenClaw knows as
    `skyrim__readRecord`. The turns ran out at its fifth build.

**What it points at next:** the enchantment note looks through every record of the project, overrides
too; a field of a magic effect that belongs to the spell's Effects item — `Data`, `Magnitude` — is
answered with where it goes, and a spell's `MagicSkill` with "delete it here, the effect keeps it"; and
addPatch's rename, now made past its note and the build's warning both, may need a sharper warning: that
every Iron Sword in the game — the player's, the merchants', the bandits' — becomes the Flame Blade.

## Round 24 — the enchantment note, gemma4:e4b alone (2026-10-21)

**Changed before it** — one of round 23's four pointers:

- The enchantment note looks through every record of the project, overrides too (4a0f460): an
  enchantment that only an addPatch copy of IronSword carries gets no note. Round 23's sword #1 had been
  told that no record names FlameBladeEnch, which its overriding sword did.

The round ran on the user's own OpenClaw configuration; its e4b entries are those of round 23's copy,
which differed only in 12b's context.

gemma4:e4b, `all`, OpenClaw (prompt ~7,264 tokens/s, generation ~173 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 11456 | 42.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 12515 | 40.5 |
| filter | 3/3 | 2.3 | 1.3 | 0 | 0 | 11611 | 39.2 |
| patch | 3/3 | 6.7 | 5.7 | 1 | 0 | 18160 | 46.3 |
| build | 3/3 | 6.3 | 5.3 | 0 | 0 | 17906 | 46.8 |
| sword | 3/3 | 11.7 | 11.7 | 4 | 0 | 23961 | 66.9 |
| sword+detailed | 3/3 | 12.7 | 12 | 3 | 1 | 24024 | 85.1 |
| spell | 3/3 | 6 | 5.3 | 0 | 0 | 16860 | 44.3 |
| spell+detailed | 2/3 | 8 | 7 | 3 | 0 | 18189 | 66.2 |
| npc | 3/3 | 8.3 | 7.7 | 2 | 0 | 16385 | 52.2 |
| npc+detailed | 3/3 | 10 | 9 | 5 | 0 | 20917 | 62.1 |
| note | 3/3 | 8.3 | 7.3 | 2 | 0 | 18683 | 59 |
| note+detailed | 3/3 | 9.7 | 8.7 | 4 | 0 | 15965 | 62.3 |

Through OpenClaw 2026.10.4 (383c124): first prompt 9,795 tokens (26 tools, 16 of them this server's),
think high, num_ctx 131072, no answer cap; no answer cut off, no turn ended at the length limit, no side
requests; first token after 1.7 s, the median of the first turns.

**Seen.**

- **e4b 38 of 39** (round 23: 36), swords 6 of 6 (4 of 6), NPCs and notes 6 of 6 each, spells 5 of 6.
  Its turns took 3.01 s (3.46).
- **The enchantment note never came, so the round did not test the fix.** All six swords wrote their
  enchantment as a new file and named it from a new sword. One authoring run used addPatch (sword+detailed
  #1, a copy of IronSword): the build refused its FormKey line as IronSword's, e4b took it out, and the
  copy built as a new sword. No build warned at all — no rename, no missing Name.
- **The refusals were fixed where they came**, each by the next build or the one after:
  - another record's FormKey copied into a new one, 9 times in 8 runs — the vanilla note's in three of
    the notes, IronSword's, AkaviriKatana's in sword #1's enchantment, a corpse's in npc #2;
  - FormKey `000000` or empty, 3 times; an NPC's level at the margin, 4 times; copied escapes, twice.
- **spell+detailed #2, the miss:**
  - It wrote a magic effect of its own, with `Data:` holding `DamageType: Shock` and `Magnitude: 40`, and a
    `Type:` text. The refusal said "a MagicEffect has no field Data (move it in each item of Conditions)" —
    round 23's wrong pointer, which no change has touched yet.
  - e4b read ShockDamageFFAimed, then wrote a second magic effect, StormShockImpactData, with the same
    fields at the margin, which no record names. Next it rewrote the first as a copy of ShockDamageFFAimed,
    which passed the checks. The second was refused for Type, DamageType and Magnitude, the answer ending
    "no other record names StormShockImpactData: if it is not needed, write its file empty — the build
    leaves an empty record file out" (the record keeps answers cut short; a replay of the run's writes
    gave this text in full).
  - Its last turn (2,189 tokens) planned the first file's edit again, already made, and made no call.
    OpenClaw ended the run on the failed build, as in round 23's sword+detailed #3.

**What it points at next:** a magic effect's `Data` that holds Magnitude, Area or Duration answered the way
`Magnitude` is — they go in the spell's Effects item — not "in each item of Conditions"; and the way to drop
a new record no other record names, given first rather than after the fields, since e4b went back to the
file it had already fixed. Round 23's other two pointers — a spell's `MagicSkill`, and addPatch's rename —
did not come up.
