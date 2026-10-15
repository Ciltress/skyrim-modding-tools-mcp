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
