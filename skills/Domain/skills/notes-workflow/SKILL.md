---
name: notes-workflow
description: How to find, read and change notes through this server without duplicating or losing any. Use before creating or editing notes, or when a search returns more than you expected. This is the template's example skill - replace it with skills for your own domain.
---

# Working with notes

A skill tells an agent *how to approach a kind of work*; the tool descriptions tell it what each
tool does. This one is the template's example: short, procedural, and written for an agent that
has never seen this server before.

## Before you write

1. **Search before you create.** `createNote` is not idempotent — calling it twice makes two notes.
   Run `searchNotes` with the title words first, and update what you find instead.
2. **Read before you overwrite.** `updateNote` replaces the fields you pass. Read the note with
   `readNote` first if you mean to extend its body rather than replace it.

## Finding things

- `searchNotes` returns summaries with a short `preview`, never full bodies. Read the one you want.
- When `more` is true, the limit cut the answer: continue with `offset` set to `nextOffset`, or
  narrow with `text` or `tag` instead of raising the limit.
- Do not know which tag to filter by? `listTags` shows every tag and how many notes carry it. It
  is withheld on backends without tag indexing — `healthcheck` says so under `withheldForBackend`.

## Changing things

- `updateNote` is safe to repeat: setting a field to the value it already has changes nothing,
  and the answer says `changed:false`.
- `tags` on `updateNote` replaces the whole list. To add one tag, read the note, append, and send
  the complete list. See [`reference/tagging.md`](reference/tagging.md) for the conventions.
- `deleteNote` is permanent. A repeated delete answers `deleted:false` rather than failing.

## Checklist

- [ ] Searched for an existing note before creating one
- [ ] Read the note before replacing its body
- [ ] Sent the complete tag list on update
