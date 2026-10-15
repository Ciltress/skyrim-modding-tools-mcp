# Tagging conventions

A supporting file: something a skill refers to but an agent only needs sometimes. `readSkill` lists
it in the skill's `files`, and returns it with `{"skill":"notes-workflow","file":"reference/tagging.md"}`.

- Tags are stored lower-case and without duplicates, whatever you send.
- Prefer a few broad tags (`howto`, `template`) over many narrow ones: a tag is only useful as a
  `searchNotes` filter if more than one note carries it.
- Check `listTags` before inventing a new tag — reuse beats a near-duplicate.
