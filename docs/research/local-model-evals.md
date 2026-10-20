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
first prompt's tokens and tools, the thinking and num_ctx OpenClaw sent, the time to the first token,
answers cut off, side requests. Its seconds include each session's start, where the server builds its
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

## Round 20 — hints that give the line to write (2026-10-18)

**Changed before it:** round 19's sword misses, and a probe after them (e4b swords, not recorded: 8/9):

- A field written a level too deep is answered with its lines and where they go: "move them up: at the
  margin, with no spaces in front — `ObjectEffect: EnchFlameDamage`, `EnchantmentAmount: 500`". Told "to
  the top level", e4b wrote the lines back with their two spaces in front (round 19).
- An item of `Effects` with `EffectType` or `Type` is answered "it is BaseEffect, naming the
  MagicEffect"; a `Charge` anywhere in an enchantment, "an enchantment's charge is the weapon's or
  armor's EnchantmentAmount" — both had been "delete it".
- A record argument with readRecord's own comment after its FormID — `045C2D:Skyrim.esm  #
  EnchWeaponFireDamage04` — is read as the FormID, in readRecord, findRecords and addPatch.
- A link written as a file's path is answered as one: "'1stPersonWeapons\FlameBlade.nif', a file —
  FirstPersonModel names a Static record, the one that holds the file … an iron sword's is
  `FirstPersonModel: 1stPersonIronSword`" (the probe: the same line rewritten three times).

gemma4:e4b, `all` (prompt ~7,387 tokens/s, generation ~181 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6981 | 3.2 |
| read | 3/3 | 2.3 | 1.3 | 0 | 0 | 7795 | 2.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6816 | 2.7 |
| patch | 3/3 | 4.3 | 3.3 | 1 | 0 | 9026 | 7.2 |
| build | 3/3 | 6 | 5 | 2 | 0 | 9416 | 8.1 |
| sword | 3/3 | 7 | 6 | 1 | 0 | 17205 | 14.5 |
| sword+skill | 3/3 | 6.3 | 5.3 | 1 | 0 | 13966 | 11.4 |
| sword+detailed | 2/3 | 9.3 | 8.3 | 1 | 0 | 17888 | 18.5 |
| spell | 3/3 | 5 | 4 | 0 | 0 | 11054 | 10.2 |
| spell+skill | 3/3 | 4.3 | 3.3 | 0 | 0 | 11231 | 6.7 |
| spell+detailed | 3/3 | 7.3 | 6.3 | 2 | 0 | 13913 | 14.8 |
| npc | 2/3 | 8.3 | 7.3 | 5 | 0 | 11730 | 17.5 |
| npc+skill | 3/3 | 4 | 3 | 0 | 0 | 9122 | 6.5 |
| npc+detailed | 2/3 | 7 | 6 | 4 | 1 | 11084 | 13.4 |
| note | 2/3 | 9.7 | 8.7 | 7 | 0 | 17796 | 27.1 |
| note+skill | 3/3 | 6.7 | 5.7 | 2 | 0 | 13738 | 12.7 |
| note+detailed | 2/3 | 8.3 | 7.3 | 2 | 1 | 10590 | 17 |

gemma4:26b, `all` (prompt ~1,088 tokens/s, generation ~40 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 6548 | 6.8 |
| read | 3/3 | 3 | 2 | 0 | 0 | 7653 | 8.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 6733 | 8.1 |
| patch | 3/3 | 5 | 4 | 0 | 0 | 9437 | 23.8 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 8741 | 17.6 |
| sword | 3/3 | 8.3 | 7.3 | 0 | 0 | 19987 | 75.2 |
| sword+skill | 3/3 | 6 | 5 | 0 | 0 | 14408 | 59.4 |
| sword+detailed | 3/3 | 13.3 | 12.3 | 4 | 1 | 26083 | 167.3 |
| spell | 3/3 | 5.7 | 4.7 | 0 | 0 | 10774 | 35.9 |
| spell+skill | 3/3 | 4 | 3 | 0 | 0 | 10135 | 19.2 |
| spell+detailed | 3/3 | 9 | 8 | 2 | 0 | 19496 | 80.4 |
| npc | 3/3 | 7.7 | 6.7 | 3 | 0 | 66031 | 68.1 |
| npc+skill | 3/3 | 6.3 | 5.3 | 2 | 0 | 10789 | 44.3 |
| npc+detailed | 3/3 | 7.7 | 6.7 | 1 | 0 | 14178 | 51.4 |
| note | 3/3 | 7 | 6 | 0 | 0 | 12968 | 51.4 |
| note+skill | 3/3 | 6 | 5 | 0 | 0 | 12539 | 34.1 |
| note+detailed | 3/3 | 8 | 7 | 0 | 0 | 15508 | 89.3 |

**Seen.**

- **26b 51 of 51**, at 7.88 s a turn (round 19: 12.95 s), and its speed check back near the earlier
  ones (~40 tokens/s): round 19's odd check was the machine at the time, not the build.
- **e4b 46 of 51** (round 19: 48): its swords went to 8 of 9 (round 19: 6 of 9), and its misses moved —
  one each in sword+detailed, npc, npc+detailed, note and note+detailed:
  - **Three of the five end on a build that succeeded, with a warning the run passed by:** npc #2 took
    Hilda's `Female` flag out while moving her level, was told "speaks with FemaleNord, a woman's voice,
    but has no Female", and reported the note to the user instead of fixing it; note+detailed #2 built
    Maven's own note, renamed, past the new warning; sword+detailed #3 enchanted the Iron Sword itself,
    an override, instead of making a new sword.
  - note #3 swung between two refusals, each fixing one half: told to indent the text's lines, it
    indented the note's fields too; told to put the fields back at the margin, it put the text there as
    well — four times, until its turns ran out.
  - npc+detailed #3 wrote its NPC outside the project, was told the path to write it to three times,
    and ended saying it had.
- e4b read Maven's note by its in-game name five times, each answered.

**What it points at next:** each of the two text refusals says what stays as it is — the text's lines
keep their spaces, the fields after them stay at the margin. And warnings a run passes by: a build that
succeeds with a warning is what three of the five misses end on.

## Round 21 — through OpenClaw, and gemma4:12b (2026-10-18)

**Changed before it** — the client and the agent more than the server:

- **OpenClaw is the client** (`--client openclaw`, OpenClaw 2026.10.4), not the eval's own loop: the user's
  configuration, with Tool Search off, thinking `max` (sent as `think: "high"`) and context 131,072, and one
  agent per model — `skyrim`, `skyrim-e4b`, `skyrim-12b` — with setup's tools and the user's web and memory
  tools: 26 tools in the first prompt, 16 of them this server's, ~9,400 tokens. The agents' workspace files
  (AGENTS.md, SOUL.md, USER.md, IDENTITY.md) were in every prompt. AGENTS.md carries what the server's
  `instructions` say, which OpenClaw drops, and two lines more: read a build's warnings, and readSkill
  takes `skill`. No `+skill` runs: through OpenClaw the harness cannot put a skill read in as the model's.
- The skills are named `skyrim-modding-*` (3261e32).
- Each text refusal says what stays as it is (b192d20, after round 20's note #3): a text at the margin is
  answered with the first field after it, which stays there; a field indented into a text, with the
  text's lines keeping their spaces.
- gemma4:12b (Q4_K_M) is measured for the first time.

The rows do not compare with round 20's directly. On the same 39 tasks, round 20's own loop gave e4b 34
and 26b 39.

gemma4:e4b, `all`, OpenClaw (prompt ~7,459 tokens/s, generation ~171 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 11007 | 43.6 |
| read | 3/3 | 3.3 | 2.3 | 0 | 0 | 12281 | 44.7 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 9774 | 39.5 |
| patch | 3/3 | 6 | 5 | 0 | 0 | 19328 | 45 |
| build | 3/3 | 7.3 | 6.3 | 0 | 0 | 20652 | 47.7 |
| sword | 1/3 | 17 | 16.3 | 7 | 9 | 33982 | 117.3 |
| sword+detailed | 0/3 | 15 | 14.3 | 3 | 6 | 30781 | 95.1 |
| spell | 3/3 | 6 | 5.3 | 0 | 0 | 16697 | 45.9 |
| spell+detailed | 3/3 | 6 | 5 | 0 | 0 | 16478 | 48.8 |
| npc | 2/3 | 13.7 | 13 | 5 | 11 | 36429 | 87 |
| npc+detailed | 3/3 | 9.7 | 8.7 | 4 | 1 | 19007 | 61.4 |
| note | 3/3 | 6.3 | 5.3 | 1 | 0 | 13232 | 53.8 |
| note+detailed | 1/3 | 9 | 8 | 2 | 0 | 19968 | 58.1 |

gemma4:12b, `all`, OpenClaw (prompt ~3,624 tokens/s, generation ~116 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 11073 | 43.1 |
| read | 3/3 | 3 | 2 | 0 | 0 | 12141 | 37.4 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 11204 | 39.1 |
| patch | 3/3 | 5.7 | 4.7 | 0 | 0 | 19454 | 45.1 |
| build | 3/3 | 6.7 | 5.7 | 0 | 0 | 15089 | 41.9 |
| sword | 2/3 | 12 | 11 | 2 | 1 | 21228 | 76.8 |
| sword+detailed | 2/3 | 11.3 | 10.3 | 3 | 1 | 24280 | 382.7 |
| spell | 3/3 | 9.3 | 8.3 | 1 | 0 | 18513 | 51.7 |
| spell+detailed | 3/3 | 9 | 8 | 1 | 0 | 18535 | 53.1 |
| npc | 3/3 | 11.7 | 10.7 | 2 | 1 | 21621 | 75.6 |
| npc+detailed | 3/3 | 8.3 | 7.3 | 1 | 0 | 18484 | 55 |
| note | 1/3 | 15.3 | 14.7 | 5 | 0 | 24699 | 431.6 |
| note+detailed | 2/3 | 11.7 | 10.7 | 3 | 0 | 19370 | 88.5 |

gemma4:26b, `all`, OpenClaw (prompt ~1,111 tokens/s, generation ~49 tokens/s):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 10965 | 58.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 12069 | 43.2 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 11177 | 39.5 |
| patch | 3/3 | 6.7 | 5.7 | 0 | 1 | 19899 | 67.9 |
| build | 3/3 | 8 | 7 | 2 | 0 | 20059 | 61.5 |
| sword | 3/3 | 14.7 | 13.7 | 0 | 3 | 26696 | 211.3 |
| sword+detailed | 3/3 | 9.7 | 8.7 | 0 | 0 | 23525 | 148.1 |
| spell | 3/3 | 7.3 | 6.3 | 0 | 1 | 17850 | 87.9 |
| spell+detailed | 3/3 | 9 | 8 | 0 | 2 | 17964 | 133.7 |
| npc | 3/3 | 9.3 | 8.3 | 1 | 0 | 17973 | 100.8 |
| npc+detailed | 3/3 | 8.3 | 7.3 | 1 | 0 | 18242 | 97 |
| note | 3/3 | 9.3 | 8.3 | 2 | 1 | 22888 | 99.4 |
| note+detailed | 3/3 | 9 | 8 | 0 | 2 | 17834 | 137.3 |

Through OpenClaw 2026.10.4 (383c124), each model: first prompt ~9,400 tokens (26 tools, 16 of them this
server's), think high, num_ctx 131072, no answer cut off; first token after 1.6 s (e4b), 3.8 s (12b) and
9.7 s (26b), the median of the first turns. 12b made three side requests, OpenClaw's own, 13–20 s each.

**Seen.**

- **26b 39 of 39.** Its 16 failed calls cost no run. Ten were `skills_read` sent readSkill's `skill` and
  `file`: OpenClaw's skills_read takes only `name` and reads only SKILL.md, and AGENTS.md showed readSkill's
  arguments beside a mention of skills_read's. Three more calls put `file` beside `name` and "succeeded"
  with SKILL.md — the tables they asked for were never read. All 30 reads of `skyrim-modding-basics`, in
  29 runs, were right. Two calls asked for `SteelSword:Skyrim.esm`, an editor ID written the way a FormID is,
  and were refused with `012EB7:Skyrim.esm` — the Iron Sword's — as the example.
- **e4b 31 of 39**, swords 1 of 6 (round 20 on the same tasks: 5 of 6):
  - **Seven of its eight misses made the "new" record with addPatch** — a copy of the Iron Sword, Maven's
    note, Adelaisa — and renamed it. Five changed only the name and built as a change to the vanilla
    record: round 19's warning said so, at the end of an answer that opened with `"status":"success"`, and
    each run ended there — though AGENTS.md said to read a build's warnings. Two changed the editor ID too,
    were refused for the copied FormKey, and lost the run removing it.
  - **Told to remove the FormKey line, e4b wrote the line below it over it** (sword #2, sword+detailed
    #1): `VersionControl` twice, answered with the reader's "Duplicate key" and the general advice to
    indent a field's own fields. It went on looking for the FormKey line it had removed; one run ended on
    2,370 tokens of thinking about "root-level duplication" that closed "I will perform a full edit
    replacement", and no call, which OpenClaw answers with the last tool error.
  - npc #1 sent the same edit six times to OpenClaw's edit tool, which refuses an `oldText` found twice.
- **12b 34 of 39**, notes 3 of 6:
  - **Three misses are notes with a backslash at the end of a line**, what a `\n` leaves when its break is
    written for real. `Value: >-\` broke the YAML and was answered with the general indentation advice
    (note #1 then wrote the same file ten times, never building); in note+detailed #2 every text line
    ended so, and the line the escapes refusal gave back for its quotes kept the backslash.
  - **Two turns ran 15 minutes each**, ~111,000 tokens until the context was full (sword+detailed #2,
    note #2): the model looping, which OpenClaw does not cut short. Both runs then answered that the mod
    was built. Without them 12b's turns took 3.75 s, about e4b's; with them, 9.49 s.
  - sword #3, refused for doubled backslashes with the line to write, ended on an empty turn.
- **Turns are slower through OpenClaw** — e4b 3.51 s (round 20: 1.91 s), 26b 8.96 s (7.88 s): find's
  largest prompt is 10,965 tokens against 6,548 in round 20 (26b), and no chat's first turn is served from
  Ollama's prompt cache.

**What it points at next** — each changed before round 22: AGENTS.md shows each skill reader with its own
arguments; an editor ID written with its plugin names that record; a build with warnings answers
`built_with_warnings`, the warnings first, and AGENTS.md says a new record is a new file, addPatch only a
change to an existing one; a field written twice is answered with both its lines; a backslash at a line's
end is refused as a copied escape, and given back without it.
