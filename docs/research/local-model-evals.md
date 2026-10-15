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
server against the instance in `.env`, with its own agent loop on Ollama's `/api/chat`. At the end it
prints the entry for this log — the summary row and the per-task table — and saves it beside the JSON
record of every call (`<out>.md`, `<out>.json`; by default under the system temp folder). Paste the
entry into a new round below, and write down what changed before it and what the transcripts showed.

**The tasks.** Each is checked against the instance itself, never against values written into the
script. Nothing is deployed: `deployProject` stays listed, but a call to it is refused.

| task | the prompt asks | passes when |
|---|---|---|
| find | which plugin defines the Iron Sword, and its FormID | the answer names `012EB7` (any spelling of the FormID) and `Skyrim.esm` |
| read | the Iron Sword's damage and weight in the load order | the answer has both numbers as the instance has them |
| filter | three armor pieces Dawnguard.esm adds, with FormIDs | three FormIDs that are ARMO records defined in Dawnguard.esm |
| patch | a patch IronSwordBuff raising the Iron Sword's damage to 12, not built | the project's copy has `Damage: 12`, its editor ID and its weight unchanged |
| build | a patch SteelSwordLight in which the Steel Sword weighs 5, built | the copy has `Weight: 5`, and buildProject succeeded and wrote the plugin |

**The columns.** *calls*: tool calls per run, file tools included. *invalid arguments*: calls refused
with `InvalidParams`. *other errors*: every other failed call, file tools included. *largest prompt*:
the most tokens Ollama evaluated in one turn. *seconds*: per run, mean. *s/turn*: mean time of a
model turn, the session's first (the model loading) left out. *GPU*: the share of the model Ollama
put on the GPU.

**The machine**, unless a round says otherwise: Windows 11, RTX 5080 16 GB, 32 GB RAM; Ollama 0.40.4
with `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`; num_ctx 131072; the model's own defaults
otherwise (gemma4: thinking on, temperature 1); three runs per task, seeds 1001–1003. The instance is
the test instance — a portable Mod Organizer on Skyrim SE 1.7.104 with no mods.

## All rounds

| date | model | profile | build | passed | s/turn | GPU |
|---|---|---|---|---|---|---|
| 2026-10-15 | gemma4:26b | `all` | 1cba00d | 15/15 | 3.0 s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 1cba00d + round 2's changes | 15/15 | 2.9 s | 77% |
| 2026-10-15 | gemma4:26b | `core` | 1cba00d + round 2's changes | 15/15 | 2.8 s | 77% |
| 2026-10-15 | qwen2.5-coder:3b | `all` | 1cba00d + round 2's changes | 0/15 | 0.2 s | 100% |
| 2026-10-15 | qwen2.5-coder:3b | `core` | 1cba00d + round 2's changes | 0/15 | 0.2 s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 37a2c1c (patch and build only) | 6/6 | 2.5 s | 77% |
| 2026-10-15 | gemma4:26b | `all` | 37a2c1c + round 4's changes | 15/15 | 3.4 s | 77% |
| 2026-10-15 | gemma4:e4b | `all` | 37a2c1c + round 4's changes | 14/15 | 1.8 s | 100% |
| 2026-10-15 | gemma4:e4b | `all` | 37a2c1c + rounds 4 and 5's changes | 15/15 | 1.3 s | 100% |
| 2026-10-15 | gemma4:26b | `all` | 37a2c1c + rounds 4 and 5's changes | 15/15 | 2.9 s | 77% |

## Round 1 — the baseline (2026-10-15)

gemma4:26b, `all` (10 server tools + 4 file tools, 10,754 bytes of schemas), build 1cba00d.

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4555 | 5.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5557 | 10.5 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4809 | 8.7 |
| patch | 3/3 | 9.7 | 8.7 | 0 | 4 | 8037 | 32.7 |
| build | 3/3 | 10.3 | 9.3 | 0 | 3 | 6877 | 25.9 |

**Seen.** Every patch and build run lost 2–6 calls the same way: `addPatch` named the copied files
relative to the plugin folder (`Weapons/IronSword - 012EB7_Skyrim.esm.yaml`), the model joined them to
the *project* folder, the read failed, and it listed folders until it found `plugin/`. No malformed
arguments at all.

## Round 2 — full paths in answers (2026-10-15)

**Changed before it:** `addPatch` (`added[].files`, `alreadyInProject[].file`) and `buildProject`
(`assignedFormIds[].file`) answer full paths; `BaseHandler` takes an argument sent as text as its
declared type (a list as JSON text, one item for a list, a number or `true`/`false` in quotes).

gemma4:26b, `all`:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4557 | 6 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5564 | 7.5 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4754 | 7.9 |
| patch | 3/3 | 5.7 | 4.7 | 0 | 1 | 6564 | 18.7 |
| build | 3/3 | 6 | 5 | 0 | 0 | 6234 | 14.9 |

gemma4:26b, `core` (8 tools):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4169 | 5.6 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5169 | 7.6 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4329 | 7.9 |
| patch | 3/3 | 5.3 | 4.3 | 0 | 0 | 6415 | 16.2 |
| build | 3/3 | 6 | 5 | 0 | 0 | 5815 | 14.9 |

qwen2.5-coder:3b, `all` and `core`: 0/15 each, every run one turn and no tool call.

**Seen.** Patch calls nearly halved; 10 of 12 patch and build runs took the shortest route,
`findRecords → addPatch → read_file → edit_file (→ buildProject)`. The one error left: the model read
the record with `readRecord` and used that answer's relative `path` as a file path. `core` measured the
same as `all`, so the size of the tool list is not what costs turns — no `local` profile was built.
qwen2.5-coder:3b writes its calls into the answer as JSON text (`{"name": "findRecords", …}`), which
no client acts on; it is fine for code completion, and left out of later rounds.

## Round 3 — the committed build (2026-10-15)

**Changed before it:** `addPatch`'s description says the full paths are in `added[].files`. Build
37a2c1c. gemma4:26b, `all`, patch and build only:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| patch | 3/3 | 5.3 | 4.3 | 0 | 0 | 6864 | 15.2 |
| build | 3/3 | 6 | 5 | 0 | 0 | 6250 | 15 |

## Round 4 — the copied text in the answer, and a second model (2026-10-15)

**Changed before it:** `addPatch` answers each copied file as `{path, text}`, so it can be edited at
once (past 16,000 bytes of text the rest is left out, and `textLeftOut` says so); `pullProject` answers
full paths; `readRecord`'s relative `path` is called `pathInPluginFolder`, so that a field named `path`
is always one a file tool opens.

gemma4:26b, `all`:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4623 | 6.3 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5630 | 8.3 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4807 | 8 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 6072 | 14.8 |
| build | 3/3 | 5 | 4 | 0 | 0 | 6366 | 17.9 |

gemma4:e4b, `all` (first round with it; it fits the GPU whole):

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4665 | 18.7 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5969 | 6.1 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 3535 | 2.8 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 7206 | 6.8 |
| build | 2/3 | 5.3 | 4.3 | 0 | 1 | 8702 | 11.8 |

(e4b's find includes the model loading: 51 s for its first run.)

**Seen.** gemma4:26b took the shortest possible route in every run: `findRecords → addPatch →
edit_file (→ buildProject)` — a patch in 3 calls, from 8.7 in round 1. e4b's failed build: it asked
for `types: ["WEPN"]` (WEAP is meant), the server answered `total: 0` as if no such weapon existed,
the model broadened to "Steel", took the first-person static `1stPersonSteelSword` from the top of 816
rows, found no weight to change, built anyway, and said so in its answer.

## Round 5 — misspelled types refused, in-game names first (2026-10-15)

**Changed before it** (in the helper): a `types` entry that is no record type is refused with the
closest real ones — `'WEPN' is not a record type. Did you mean WEAP (Weapon), REGN (Region)?` — instead
of matching nothing. Text matches rank exact matches first, then in-game names, then editor IDs only,
and among equals the editor ID that spells the text out (`SteelSword` before the quest sword
`FFRiften16HarraldSword`, both named "Steel Sword").

gemma4:e4b, `all`:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4853 | 2.6 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5989 | 3.5 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 3534 | 2.6 |
| patch | 3/3 | 4.3 | 3.3 | 0 | 0 | 7200 | 6.9 |
| build | 3/3 | 5.3 | 4.3 | 0 | 0 | 7716 | 6.2 |

gemma4:26b, `all`:

| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |
|---|---|---|---|---|---|---|---|
| find | 3/3 | 2 | 1 | 0 | 0 | 4629 | 16.4 |
| read | 3/3 | 3 | 2 | 0 | 0 | 5637 | 7.4 |
| filter | 3/3 | 2 | 1 | 0 | 0 | 4827 | 7.2 |
| patch | 3/3 | 4 | 3 | 0 | 0 | 6139 | 13.4 |
| build | 3/3 | 5 | 4 | 0 | 0 | 6301 | 14.6 |

(26b's find includes reloading the model after e4b.)

**Seen.** Both models passed everything, with no failed call in 30 runs. gemma4:26b took the shortest route in every patch and build run; e4b once read the file it had just been given, and once looked the record up with `readRecord` before copying it. e4b is about twice as fast (1.3 s a turn against 2.9 s), as it runs on the GPU alone.

## Speed of gemma4:26b on this machine (2026-10-15)

Gemma-4-26B-A4B: 30 layers, 128 experts with 8 used per token, 15.8 GiB at Q4_K_M, plus a small draft
model for speculative decoding. It does not fit 16 GB: Ollama keeps the always-used layers on the GPU
and moves expert weights to system memory first — 10.4 GiB on the GPU, 6.4 GiB in pinned host memory
(Task Manager's "shared GPU memory"), 77% in all. The CPU works on the experts in system memory while
the GPU waits, so 30–40% GPU load is expected. Only 5 of the 30 layers attend globally (the others use
a 1,024-token window), so the KV cache at 128k is 1.5 GiB.

Measured with a 2,349-token prompt and 300 tokens generated, three runs each:

| num_ctx | load | on the GPU | prompt | generation |
|---|---|---|---|---|
| 131072 | 37 s | 77% | ~900 tokens/s | ~50 tokens/s |
| 32768 | 32 s | 76% | ~1,290 tokens/s | ~62 tokens/s |
