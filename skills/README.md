# Skills

Agent skills served by this MCP server — as resources under `<scheme>://skills/<collection>/<name>`
and through the `readSkill` tool. Discovery walks each collection for `SKILL.md` files, so adding,
editing or removing one needs **no rebuild** — but the result is cached per process
([`discoverSkills()`](../src/lib/skills.ts)), so a running server keeps serving the old set until it is
**restarted**.

A collection is one directory here. Inside it, skills live under its own `skills/` folder when it has
one, at any depth; every directory containing a `SKILL.md` is one skill, and everything beside the
`SKILL.md` is a supporting file `readSkill` can return.

## Provenance

| Collection | Upstream | Tracked as |
| --- | --- | --- |
| [`Domain`](Domain) | this repository | **vendored** — ours, edit freely |
| [`Development`](Development) | [mattpocock/skills](https://github.com/mattpocock/skills) | **git submodule** — do not edit |

<!-- TEMPLATE: replace skills/Domain/skills/notes-workflow with skills for your domain. -->

**Domain** holds the skills for working with whatever this server wraps. The template ships one
example, `notes-workflow`, with one supporting file.

**Development** is a submodule because we do not modify it: upstream stays the source of truth and
updates arrive with one command. See [`docs/Development-Skills.md`](../docs/Development-Skills.md).

### Cloning

A plain `git clone` leaves `skills/Development` **empty**. Either clone with submodules:

```bash
git clone --recurse-submodules <repository>
```

or initialise them afterwards:

```bash
git submodule update --init --recursive
```

### A SKILL.md

```markdown
---
name: my-skill
description: What it is for and when to reach for it - the text an agent selects on, so make it specific.
---

# Title

The procedure, the conventions, the checklist.
```

`name` and `description` are required; the description is what makes a skill findable, so say *when*
to use it, not only what it is.
