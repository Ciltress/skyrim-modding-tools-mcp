# Tool reference

<!-- GENERATED FILE - do not edit by hand.
     Run `npm run build && npm run docs:tools` after changing any getTools(). -->

Every tool this server can expose: **8 tools across 3 families**, rendered from the tool definitions themselves so it cannot drift from the code. `healthcheck` is not listed here: the server defines it outside every handler and lists it in every profile.

**How many you can actually call is smaller.** The active `MCP_PROFILE` decides what is
listed, and the server withholds anything the connected backend does not support.
`tools/list` is always the truth; `healthcheck` reports the profile and what was withheld.

Looking for the tool that does a particular job? Start with
[`Tool-Router.md`](./Tool-Router.md), which maps intent to tool. For workflows and the error
model, see [`MCP-Tools.md`](./MCP-Tools.md).

An argument marked **\*** is required. Argument *descriptions* are not repeated here: they
reach you in the `inputSchema` of every tool you can call.

The italic line under each tool is its MCP **annotations**, sent to clients in `tools/list`:
whether it only reads, whether it *writes*, whether the write is *destructive* (it overwrites
or removes something that was there) or *idempotent* (repeating it changes nothing further),
and whether it reaches past the backend this server is bound to. They are hints for deciding
what needs a human, not a permission system: nothing here is enforced.

## Families

- [Bundled skills](#bundled-skills) — 1 tool
- [Notes](#notes) — 6 tools
- [This server's own guides](#this-servers-own-guides) — 1 tool

---

## Bundled skills

From `src/handlers/SkillsHandlers.ts`.

**`readSkill`** — Bundled agent skills — reusable procedures for working with this server and for general engineering (TDD, code review, diagnosing bugs, domain modelling…). Call with no arguments to see which exist, then pass `collection` for their descriptions and `skill` to read one. Consult a skill's SKILL.md before starting a task it covers: they carry the conventions and checklists the tool descriptions alone do not.

_read-only_

`collection` string · `skill` string · `file` string

## Notes

From `src/handlers/NotesHandlers.ts`.

**`searchNotes`** — Find notes by text and/or tag, newest first. Returns summaries with a short preview — not the full body; read one with readNote. `total` is the number of matches before the limit, so a smaller `notes` list means there is more to page through.

_read-only_

`text` string · `tag` string · `limit` number, default `20` · `offset` number

**`readNote`** — One note in full — title, body, tags and when it last changed — by its id.

_read-only_

`id`**\*** string

**`createNote`** — Create a note and return it with its new id. Calling it twice creates two notes — search first if the note might already exist.

_writes_

`title`**\*** string · `body` string · `tags` array

**`updateNote`** — Replace the title, body and/or tags of an existing note. Fields you omit are kept; `tags` replaces the whole list. Returns the note as it now is, and `changed:false` when the note already had these values.

_writes · destructive · idempotent_

`id`**\*** string · `title` string · `body` string · `tags` array

**`deleteNote`** — Delete a note permanently. Answers `deleted:false` rather than failing when the note does not exist, so a repeated call is harmless.

_writes · destructive · idempotent_

`id`**\*** string

**`listTags`** — Every tag in use and how many notes carry it, most used first. Use it to find the tag to pass to searchNotes.

_read-only_

Needs the backend feature `tags`; withheld where it is missing.

_no arguments_

## This server's own guides

From `src/handlers/DocsHandlers.ts`.

**`readServerGuide`** — This server's own documentation. Call with no arguments for an index of the available guides and their sections, then request one section by number or title. Use it when you are unsure which tool to use, what an argument means, how a workflow fits together, or why a call is failing.

_read-only_

`guide` string, one of router/tool-reference/tools/hosting/development-skills/agents · `section` string
