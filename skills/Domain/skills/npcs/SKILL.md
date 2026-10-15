---
name: npcs
description: NPCs and what defines them in Skyrim SE - race, class, factions, outfits, AI packages, templates, voice types, FaceGen faces, followers. Use when creating or changing an NPC or follower, or diagnosing one - a dark face, an edit with no effect, a wrong outfit, an NPC ignoring its packages.
---

# NPCs

Read [`REFERENCE.md`](REFERENCE.md) before touching an NPC record: it covers the NPC record and the
records around it, templates, FaceGen, outfits, factions, AI packages, followers, what a save keeps,
and the typical bugs. Fundamentals — FormIDs, overrides, references — are in the
`skyrim-modding-basics` skill.

## Workflow

The loop in `skyrim-modding-basics` — look up, get the text, edit, build, deploy — with these for NPCs:

- **Look up** with `types` from `NPC_`, `LVLN`, `RACE`, `CLAS`, `FACT`, `OTFT`, `PACK`.
- **Before editing a field**, read the NPC and find out where the field comes from: a set template
  flag means the template's record holds it (REFERENCE, *Templates*) — patch that record instead.
- **Appearance** — anything from `HeadParts` down — needs new FaceGen from the Creation Kit, a step
  only the user can take (REFERENCE, *FaceGen*). Ask them to generate it, then copy the generated files
  into `assets/` at the same paths, so the deploy carries them.
- **Many NPCs at once** — a perk for every bandit, an outfit for every guard — go into a SPID
  `<Mod>_DISTR.ini` in `assets/`, with no NPC overridden (REFERENCE, *Distribution instead of edits*).
- **Done** when built and deployed, and the user knows to test on a new game or with `coc` from the
  main menu, since a save keeps the state of an NPC already met (REFERENCE, *What a save keeps*).
- **Diagnosing**: `readRecord` with `allVersions: true` on the NPC, and on her template if she has one,
  then match the symptom in REFERENCE, *Typical bugs*.
