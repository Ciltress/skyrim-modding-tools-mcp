# The operating system and the mod manager are separate seams

The server was written for Mod Organizer 2 on Windows. On Linux, people run Skyrim through Proton and
manage mods either with MO2 inside the game's Proton prefix, or with a native manager such as Amethyst.
Two things vary, and they vary independently — MO2 runs on both systems:

- **What differs by operating system**: the helper's executable name, the Papyrus compiler, how an
  outside program is started, how a running process is found.
- **What differs by mod manager**: where its settings live, what its profile files mean, how a mod is
  added and enabled, whether the manager can be told to re-read its files, where a plugin it deployed
  really is.

So there are two seams. A `Platform` is chosen once, from the operating system, in `createBackend()`,
and nothing else in the code asks which system it runs on. A `ModManager` is chosen by
configuration — `SKYRIM_MOD_MANAGER=mo2|amethyst` — and never inferred from the operating system. The
tools are the same for every manager: the same names, arguments and meaning, with manager-specific
detail only in their answers ([ADR-0001](0001-tool-count-is-a-cost.md)). **Instance** names any
manager's setup for Skyrim, and **mod manager** the program that keeps it (`CONTEXT.md`).

## Considered options

- **One seam: Linux means Amethyst.** Rejected: MO2 under Proton is a Linux setup too, and a second
  Linux manager would have to undo the assumption everywhere it was made.
- **Tools per mod manager** (`deployToAmethyst`, …). Rejected: twice the tools for the same jobs, and
  every skill would have to say which to call.
- **A Docker image instead of native Linux support.** Deferred, not rejected: a container needs the
  game, the instance and the Proton prefix bind-mounted at identical paths and cannot see a running
  mod manager, so it is a separate decision once native support works.

## Consequences

- MO2 under Proton writes Windows paths into `ModOrganizer.ini`. They are mapped to Linux paths through
  the prefix's `dosdevices` links; the prefix comes from `SKYRIM_WINE_PREFIX`, else MO2-LINT's
  `state.json`, else `Z:` is taken to be `/`. MO2's `refresh` is not delivered into a Proton prefix,
  so a deploy is refused while that instance's MO2 runs. Until someone runs it for real, this binding
  is documented as unverified.
- Amethyst cannot be told to re-read its files, and it overwrites outside changes to modlist lines it
  already knows. A deploy therefore only adds what is new — a mod folder, a new `+` line, the plugin —
  and runs Amethyst's own `deploy` command when its window is closed; when it is open, the answer asks
  the user to press Refresh and Deploy.
- Linux file systems are case-sensitive and Skyrim's files are not. Every lookup in the game's `Data`,
  mod folders and overwrite compares lower-cased relative paths, on every system, so the Windows test
  suite exercises it.
- On Linux, Papyrus is compiled by a third-party compiler whose output is not byte-identical to the
  Creation Kit's, until one that is gets released.
- `FileVersionInfo` cannot read a native executable's version on Linux, so the helper reads the game's
  version resource itself, on both systems.
- Continuous integration runs on Windows and Linux.
