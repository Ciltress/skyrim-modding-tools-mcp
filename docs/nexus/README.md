# The Nexus Mods page

What the MCP server's page on Nexus Mods (Skyrim Special Edition) holds. A new mod page can only be created on the
website; afterwards, Nexus's v3 API can update its description and upload new file versions.

## The form

| Field | Value |
| --- | --- |
| Game | Skyrim Special Edition |
| Name | Skyrim Modding Tools - MCP Server |
| Category | Utilities |
| Summary (at most 350 characters) | Mod Skyrim SE by talking to your AI assistant: an MCP server that looks up records across your load order, builds mods and patches from plain text, installs mods from Nexus and reads your crash logs. For Claude, VS Code and local models; Mod Organizer 2 and Amethyst. |
| Description | [`description.bbcode`](description.bbcode), pasted into the editor's source view |
| Primary image | [`.github/banner.jpg`](../../.github/banner.jpg) |
| Image, 16:9 | [`tile.jpg`](tile.jpg), 1600x900, for where Nexus shows the mod as a tile |
| Image in the description | [`muddy.png`](muddy.png), 200x200, Muddy for his section: [`assets/icon.png`](../../assets/icon.png) made smaller; the description links it from GitHub, so it is pushed before the page is pasted |
| Tags | Utilities; **AI-Generated Content** (the code, written with Claude); **AI Media** (the banner, the tile and this page's text) |
| Requirements, off-site | Node.js 24 (https://nodejs.org), git (https://git-scm.com) |
| Requirements, Nexus mods | none |
| Mod manager download | off: it is a program for the user's PC, not a mod to install into the game |
| Permissions | open, as GPL-3.0 has it: upload, modify, convert and reuse, with credit and the same license |

## The file

The main file is the repository at a release tag, packed by git, so it holds exactly what is committed:

```bash
git archive --format=zip --prefix=skyrim-modding-tools-mcp/ -o skyrim-modding-tools-mcp-<version>.zip <tag>
```

Its Nexus name is at most 50 characters of letters, digits, spaces and `_'().-`; its version, letters, digits, `.`
and `-`. Unpacked, `npm run setup` takes it from there, as from a clone; only `git pull` needs the clone.

## Before publishing

- **Nexus's API acceptable-use policy** tolerates personal API keys "for personal use", and asks applications that
  others use to register with Nexus (support@nexusmods.com: a name, a short description and a logo — the mudcrab
  icon), which gives them a slug for single sign-on. Searching and reading Nexus need no key; downloading through the
  API does. A page on Nexus makes this an application others use.
- **AI tags** (Nexus, 2026-07-31): AI-Generated Content covers AI-generated code; AI Media covers promotional art,
  thumbnails and mod page descriptions. A mod without the tags its content needs may be moderated.
