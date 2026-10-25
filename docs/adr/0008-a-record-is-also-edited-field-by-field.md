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
  takes its words, or its `Value` as the file writes it, and a part of several kinds that the edit creates
  gets its `MutagenObjectType` where only one kind has the field.
- An object for a part the file has is merged into it, as a JSON merge patch is, rather than written whole:
  e4b's first `{"BasicStats": {"Damage": 12}}` took the Iron Sword's value and weight with it (eval round
  49). One that names another kind of the part is written whole.
- `set` lists each field as `{"path": …, "value": …}`, the path never a key of the call: as an object keyed by
  path, a dotted key with words for its value — `{"Name.Value": "Mavens Warning"}` — was dropped by Ollama's
  gemma4 parser, 22 times in 56 asked for, and turns that planned one ended six runs of eval rounds 49–55 with
  no call. The object it took first is still read, for clients that send one.
- A field sent to a place without it is set where it is when that place is plain, and the answer says so —
  `Configuration.CalcMinLevel (sent as Level.CalcMinLevel)`: a field of the part above, sent below one of its
  fields, and one the top level lacks of the one part it belongs to, as an NPC's level is Configuration's. Told
  an NPC's level is "three lines under Configuration", as the build tells a file, e4b sent four calls that were
  refused, then a fifth that Ollama dropped (eval round 60). A part given another kind loses the fields that
  kind has not.
- Whether models choose it over their file tools is for the eval to show. It does not replace them.
- A project's files can hold editor IDs where a pull or `addPatch` writes FormIDs; both read alike.
