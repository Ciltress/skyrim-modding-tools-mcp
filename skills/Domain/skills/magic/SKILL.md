---
name: magic
description: Spells, magic effects, enchantments, scrolls, shouts, and the effects potions share with them, in Skyrim SE. Use when creating or changing one, or diagnosing one - an effect that does nothing, a wrong cost, an enchantment missing at the table, a perk that doesn't apply.
---

# Magic

Read [`REFERENCE.md`](REFERENCE.md) before touching a magic record: it covers the effect chain,
spells, magic effects and their archetypes, enchantments, scrolls, shouts, how perks reach magic, and
the typical bugs. Fundamentals — FormIDs, overrides, patches — are in the `skyrim-modding-basics`
skill.

## Workflow

The loop in `skyrim-modding-basics` — look up, get the text, edit, build, deploy — with these for magic:

- **Look up** with `types` from `SPEL`, `MGEF`, `ENCH`, `SCRL`, `SHOU`, `BOOK` (spell tomes). A spell
  is its effects: resolve the `MGEF` FormIDs it lists with `findRecords` and `records`, and read the
  ones that matter, before reasoning about what it does.
- **A new spell** starts from `readRecord` on a vanilla spell of the same cast type and delivery, and
  reuses vanilla effects as they are. An effect that has to differ is a new `MGEF`: write it, build,
  then list its FormID in the spell and build again. A vanilla `MGEF` itself changes only when every
  spell, potion and enchantment using it should change with it.
- **A script effect's** `.psc` goes into `scripts/`; `buildProject` compiles it and fails on a
  compile error.
- **Done** when the spell is built, every effect's cast type and delivery match the spell's, and
  something gives it to the player — a spell tome, a merchant's list, a starting spell.
- **Diagnosing**: `readRecord` with `allVersions: true` on the spell *and* on each of its effects, then
  match the symptom in REFERENCE, *Typical bugs*.
