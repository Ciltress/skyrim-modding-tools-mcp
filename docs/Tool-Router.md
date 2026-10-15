# Tool router

**What you want to do → the tool that does it.** Written by hand, in the words people actually use,
because a generated index can only ever say a tool's own name back to you. If you know the job but not
the tool, start here.

Not all of these are callable on every server: `MCP_PROFILE` decides what is listed, and anything the
connected backend does not support is withheld. **`tools/list` is the truth.** A tool named here but
missing there is not a mistake — it is out of profile, or not supported by this backend.

Arguments live in each tool's own `inputSchema`. Full list: [`Tool-Reference.md`](./Tool-Reference.md).
Workflows and the error model: [`MCP-Tools.md`](./MCP-Tools.md).

<!-- TEMPLATE: one section per kind of job, one row per way of asking. Add a row whenever a new tool
     answers a question someone would ask in their own words; delete the notes rows with the example. -->

---

## Finding and reading

| You want to… | Call |
| --- | --- |
| Find a note when you know a word from it | `searchNotes` with `text` — summaries, newest first. **Start here.** |
| See everything carrying a label | `searchNotes` with `tag` |
| Read a note in full | `readNote` with the id from `searchNotes` |
| See which tags exist, and how often | `listTags` |
| Page through a long result | `searchNotes` with `offset` set to the `nextOffset` it answered |

## Changing things

**Search before you create.** `createNote` makes a new note on every call; `updateNote` is safe to
repeat.

| You want to… | Call |
| --- | --- |
| Write something down | `createNote` — after `searchNotes` found nothing similar |
| Change a title or body | `updateNote` with only the fields that change |
| Add or remove a tag | `readNote`, then `updateNote` with the **complete** new `tags` list |
| Remove a note for good | `deleteNote` — a repeat answers `deleted:false`, not an error |

## When something went wrong

| You want to… | Call |
| --- | --- |
| Find out whether the server and its backend are up | `healthcheck` — it answers even when nothing else does |
| Find out which profile is active and what is withheld | `healthcheck` → `tools` |
| Understand an error message or a failing workflow | `readServerGuide` with `{"guide":"tools","section":"troubleshooting"}` |

## Guidance

| You want to… | Call |
| --- | --- |
| Find the right tool for a job | `readServerGuide` with `{"guide":"router"}` — this page |
| See every tool's arguments | `readServerGuide` with `{"guide":"tool-reference"}`, one family by `section` |
| Follow a proven procedure for a kind of work | `readSkill` — no arguments for the list |
| Learn how to work on this server's own code | `readServerGuide` with `{"guide":"agents"}` |

## Words that lead people astray

| If you are thinking… | You probably want… |
| --- | --- |
| "list notes" | `searchNotes` with no arguments — there is no separate list tool |
| "edit", "rename", "retag" | `updateNote`; tags are replaced, not merged |
| "is it connected?" | `healthcheck`, not a test call to a write tool |
| "help", "docs", "manual" | `readServerGuide` — the server documents itself |
