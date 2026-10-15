# A mod is authored as a text project, not as a plugin

A mod we author lives as a **project**: one text file per record, with each FormID written against
the plugin that defines it (`087835:Skyrim.esm`) rather than a load-order slot, plus its scripts and
assets, versioned in git. The plugin is a build output, deployed into the instance. Claude edits the
text with its ordinary file tools, so the server needs far fewer tools, and git gives diff, review
and rollback for free.

Edits made to the deployed plugin outside the project — placing objects in the Creation Kit's render
window, a fix in xEdit — are **pulled** back into the text. Git referees when both sides changed:
deploy refuses to overwrite a plugin that changed since the last deploy, and pull refuses to write
over uncommitted text. Without that, work done in the Creation Kit would vanish without a trace on the
next deploy.

## Consequences

- Build assigns a FormID to every new record and writes it back into the project. Once assigned, a
  FormID never changes.
- Build, deploy and pull are explicit steps. Nothing watches files in the background.
- Pull's guard needs git to answer. Where it cannot — git is not installed, or the projects folder is
  not in a repository — pull goes ahead and says so in a warning, rather than refusing: the projects
  folder normally sits inside this repository, so that case is rare, and refusing would leave no way
  to pull at all.
- A copy of the plugin that the Creation Kit saves anew lands in Mod Organizer's overwrite folder,
  which outranks the mod. Deploy guards that copy like the mod's own, and removes it once it has been
  pulled, so it cannot hide the next deploy.
