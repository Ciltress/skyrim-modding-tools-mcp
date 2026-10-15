# The Creation Kit is used only through its command line

The Creation Kit cannot be driven reliably through its GUI: it loads slowly, interrupts loading with
modal warning dialogs, and its layout moves with every patch, so an automation that works today breaks
silently tomorrow. The server uses only the parts that run without a window — the Papyrus compiler,
and the Creation Kit's command-line switches such as `-GenerateLips` and `-ConvertToESL` — and never
automates the GUI or uses it to edit records. Records are edited in the project
([ADR-0004](0004-mods-are-authored-as-text-projects.md)). What only the GUI can do, such as placing
objects in the render window or navmesh, stays a manual step whose result comes back into the project
by pull.

## Considered options

- **GUI automation for jobs that have no switch.** Rejected: fragile, and the manual step plus pull
  covers the same jobs.
- **The Creation Kit as the record editor.** Rejected: slower and more fragile than writing records
  directly, for every edit.

## Consequences

- The switches are undocumented. Each one's argument syntax has to be verified against the Creation
  Kit before a tool relies on it.
