# Plugins are read and written by a Mutagen helper, not by TypeScript

No maintained TypeScript library reads or writes Bethesda plugins, and writing them correctly for
every game version this server supports — the 1.70 and 1.71 headers, light plugins, localized
strings, compressed records — is years of work that Mutagen has already done. So the TypeScript
server does no plugin I/O itself: it delegates every read and write to a small compiled C# helper
built on Mutagen, which it talks to over stdio. The helper ships compiled, so a user needs the .NET
runtime, not the SDK.

## Considered options

- **Our own TypeScript reader and writer.** Months to cover every record type, and writing is where
  correctness is hard.
- **The Spriggit command line.** Needs the .NET SDK and nuget.org access on every user's machine.
- **A TypeScript reader for analysis, Mutagen only for writing.** Two parsers of one format, which
  will eventually disagree about the same record.

## Consequences

- The repository holds two languages and two builds.
- Mutagen is GPL-3.0, which is why the project is too ([ADR-0006](0006-gpl-3.md)).
- The helper also writes the project text format itself. Spriggit's Skyrim package is published as a
  dotnet tool and cannot be referenced, so the helper generates the same converter from Mutagen's
  serialization source generator, with Spriggit's customization copied in. Mutagen and the generator
  are pinned together, to the versions a Spriggit release uses
  ([spike](../research/2026-10-15-spriggit-embedding-spike.md)).
