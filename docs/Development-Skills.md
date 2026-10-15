# Development skills

General engineering skills at [`skills/Development`](../skills/Development), a **git submodule** of
[github.com/mattpocock/skills](https://github.com/mattpocock/skills) — tracked, not copied, because we
do not modify them. They are language-agnostic and cover the *process* around writing code: testing,
review, design, debugging, planning, writing.

The domain collection, [`skills/Domain`](../skills/Domain), is vendored instead: it is ours, and
edited freely. See [`skills/README.md`](../skills/README.md) for how the two are tracked.

## 1. How to reach them

The server serves every skill two ways, both from the files on disk:

- **As an MCP resource**, `<scheme>://skills/development/<name>`, listed by `resources/list`. Use this
  to attach a skill in your client's UI.
- **Through the `readSkill` tool**, which an agent can call by itself. Resources are usually
  user-attached, so this is the route that works mid-task.

```jsonc
{"tool":"readSkill","args":{}}                                  // the index: collections and names
{"tool":"readSkill","args":{"collection":"development"}}        // every skill with its description
{"tool":"readSkill","args":{"skill":"tdd"}}                     // one SKILL.md
{"tool":"readSkill","args":{"skill":"tdd","file":"mocking.md"}} // one supporting file
```

Reading is a drill-down on purpose: the descriptions are what make a skill findable, and they are
long. Start with the index. The live list is always `readSkill` — this page deliberately does not
copy it, because upstream adds and renames skills.

## 2. What is there

Upstream groups them by category: **engineering** (the plan → implement → test → review loop: `tdd`,
`code-review`, `diagnosing-bugs`, `codebase-design`, `domain-modeling`, `prototype`, `research`, …),
**productivity** (conversation-shaping: `writing-for-agents`, `grilling`, `handoff`, …), **misc**
(setup one-offs such as `setup-pre-commit` and `git-guardrails-claude-code`) and **in-progress**
(upstream's unstable work).

Many are marked `disable-model-invocation: true` upstream, meaning they are meant to be *invoked by
the user*, not chosen autonomously by an agent. The tracker-based ones (`to-tickets`, `triage`,
`wayfinder`, `to-spec`) expect `setup-matt-pocock-skills` to have been run first.

## 3. Which of these fit this repository

This is a TypeScript project with an offline vitest suite and a smoke test against the built server,
so the process skills apply directly:

- **`tdd`** — the suites here already follow its shape: behaviour-level tests against fakes, with the
  smoke test reserved for what a fake cannot prove.
- **`code-review`** — the Standards axis has something to read: [`AGENTS.md`](../AGENTS.md) documents
  this repository's conventions.
- **`diagnosing-bugs`** — for the bugs this kind of server produces, where the failure is in the
  backend's behaviour rather than in the TypeScript.
- **`writing-for-agents`** — the guides in `docs/` and `AGENTS.md` are agent-facing documents, served
  to clients as resources.
- **`codebase-design`** — the backend seam is a deep-module question: a narrow lifecycle interface
  in front of whatever the domain client does.
- **`domain-modeling`** — [`CONTEXT.md`](../CONTEXT.md) and [`docs/adr`](./adr) are in the format it
  writes.

## 4. Tracking upstream

`skills/Development` is a **submodule**, not a copy. Two consequences:

- **A plain `git clone` leaves the directory empty**, and the server then offers only the domain
  skills. Clone with `--recurse-submodules`, or run `git submodule update --init --recursive`.
- **Do not edit these files.** Changes here are changes to someone else's repository: they are not
  recorded by this project and are lost on the next update. Copy a skill into `skills/Domain` and
  edit it there instead.

To take upstream's latest:

```bash
git submodule update --remote skills/Development
git add skills/Development && git commit
```

To drop the collection entirely, `git rm skills/Development` — discovery simply finds one collection
fewer, and nothing else depends on it.
