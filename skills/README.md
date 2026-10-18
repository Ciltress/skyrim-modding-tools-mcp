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
| `skyrim-modding-items-and-crafting` | Weapons, armor and addons, ammo, potions, books, recipes and tempering | `REFERENCE.md` |
| `skyrim-modding-magic` | Spells, magic effects, enchantments, scrolls, shouts, how perks reach magic | `REFERENCE.md` |
| `skyrim-modding-npcs` | NPCs, templates, FaceGen, outfits, factions, AI packages, followers | `REFERENCE.md` |
| `skyrim-modding-leveled-lists` | Leveled items, NPCs and spells: how a pick works, the conflict problem | `REFERENCE.md` |
| `skyrim-modding-game-versions` | Mods whose SKSE plugins do not fit the game version: checking, a fitting file or disabling, saves | `REFERENCE.md` (game versions, SKSE builds, the rules) |

Each `SKILL.md` stays short and points at its `REFERENCE.md`, where the record family's fields,
gotchas, real project text and typical bugs live. The `SKILL.md` of items, magic and NPCs holds one
complete new record of the family, linked by editor IDs, as it builds, and every family's `SKILL.md`
tables of the vanilla records and values its records are written with — every school's everyday
spells, weapon and armor kinds, enchantments, potions, recipe stations and materials, races and their
voices, classes, outfits, the leveled lists new things go into; models read `SKILL.md` and seldom its
`REFERENCE.md`. Every table value is a Skyrim.esm record, so the tables say to write them without a
search. Change an example or a table row only after building it, as written, against a test instance.
Keep the examples unlike the authoring tasks of `scripts/eval-ollama.mjs` — another element, another
kind — so the eval measures a model working its record out of the tables rather than copying one. The tool workflow every task follows is in
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
