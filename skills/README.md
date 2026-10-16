# Skills

Agent skills served by this MCP server — as resources under `<scheme>://skills/<collection>/<name>`
and through the `readSkill` tool. Discovery walks each collection for `SKILL.md` files, so adding,
editing or removing one needs **no rebuild** — but the result is cached per process
([`discoverSkills()`](../src/lib/skills.ts)), so a running server keeps serving the old set until it is
**restarted**.

A collection is one directory here. Inside it, skills live under its own `skills/` folder when it has
one, at any depth; every directory containing a `SKILL.md` is one skill, and everything beside the
`SKILL.md` is a supporting file `readSkill` can return.

## Domain

[`Domain`](Domain) holds the Skyrim modding skills, ours to edit:

| Skill | Covers | Supporting files |
| --- | --- | --- |
| `skyrim-modding-basics` | Plugins, masters, FormIDs, load order and mod order, overrides and patches, archives, game versions and SKSE, Papyrus and saves, where errors show up, what a project looks like | `REFERENCE.md`, `TOOLS.md` (the community's tools) |
| `items-and-crafting` | Weapons, armor and addons, ammo, potions, books, recipes and tempering | `REFERENCE.md` |
| `magic` | Spells, magic effects, enchantments, scrolls, shouts, how perks reach magic | `REFERENCE.md` |
| `npcs` | NPCs, templates, FaceGen, outfits, factions, AI packages, followers | `REFERENCE.md` |
| `leveled-lists` | Leveled items, NPCs and spells: how a pick works, the conflict problem | `REFERENCE.md` |

Each `SKILL.md` stays short and points at its `REFERENCE.md`, where the record family's fields,
gotchas, real project text and typical bugs live. The `SKILL.md` of items, magic and NPCs holds one
complete new record of the family, linked by editor IDs, as it builds, and those of items and magic
tables of the vanilla values their records are written with — damage spells by element and casting,
weapon kinds, weapon enchantments; models read `SKILL.md` and seldom its `REFERENCE.md`. Change an
example or a table row only after building it, as written, against a test instance. Keep the examples
unlike the authoring tasks of `scripts/eval-ollama.mjs` — another element, another kind — so the eval
measures a model working its record out of the tables rather than copying one. The tool workflow every task follows is in
`skyrim-modding-basics`; each record family's `SKILL.md` adds what its records need, naming the real
tools.

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
