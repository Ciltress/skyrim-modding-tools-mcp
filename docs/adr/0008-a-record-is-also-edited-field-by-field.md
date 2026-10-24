# A record is also edited field by field, with no text to match

ADR 0004 left record edits to the client's file tools: the server needed fewer tools, and the text stayed
plain. For a small local model that edit is the hard part. Its file tool replaces an exact old text, and
in eval rounds 40–47 it refused 95 of gemma4:e4b's edits:

- 64 were the model's own: a value it remembered rather than read (often the vanilla record's), lines
  indented otherwise than the file, or text that was never there. After a refusal, it often sent the same
  edit again.
- 31 had been made stale by the build: corrections it writes into the files, and links written by editor
  ID that it wrote back as FormIDs.

`editRecord` changes fields by their paths — `Data.Damage`, `Name`, `Effects[0].Data.Magnitude` — and needs
no old text. It changes only those fields' lines and leaves the rest of the file as it was, comments
included. It refuses a field the record's type does not have, and answers the file's new text, so the next
change starts from the file rather than from memory. The file tools stay as they were, for whatever a path
cannot say.

The build now keeps links as they are written: it resolves an editor ID into the plugin, and leaves it in
the file. What each link to the load order named is pinned in the project's `links.lock.json`, so a mod
installed later whose record has the same editor ID does not change the link.

## Consequences

- One more tool in every session's prompt (ADR 0001). It is in the `core` profile too, which is for the
  small models it helps most.
- A path names fields as Mutagen does, as `readRecord` shows them; a text field (`Name`, `Description`)
  takes its words, and a part of several kinds that the edit creates gets its `MutagenObjectType` where
  only one kind has the field.
- Whether models choose it over their file tools is for the eval to show. It does not replace them.
- A project's files can hold editor IDs where a pull or `addPatch` writes FormIDs; both read alike.
