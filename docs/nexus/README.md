# The Nexus Mods page

What the MCP server's page on Nexus Mods (Skyrim Special Edition) holds. A new mod page can only be created on the
website; afterwards, Nexus's v3 API can update its description and upload new file versions.

## The form

| Field | Value |
| --- | --- |
| Game | Skyrim Special Edition |
| Name | Skyrim Modding Tools - MCP Server |
| Category | Utilities |
| Short description (at most 350 characters, on the mod card) | Mod Skyrim Special Edition by talking to your AI agent. This MCP server gives an AI model — any MCP client — the tools to look into your whole load order, make mods and patches, install mods from Nexus Mods and read your crash logs. |
| Full description | [`description.bbcode`](description.bbcode), pasted into the editor's source view (its `[ ]` button). It follows the five sections Nexus's editor starts with — Description, Installation instructions, Main features, Requirements, Shout outs — and replaces that template |
| Media: Header (the banner at the top of the page, 1300x372 recommended) | [`header.jpg`](header.jpg), 1300x372: [`.github/banner.jpg`](../../.github/banner.jpg) cut to its 3.5:1, the title and Muddy whole |
| Media: Images (the gallery, at least one, 1920x1080 recommended) | [`tile.jpg`](tile.jpg), 1600x900, the same 16:9 |
| Image in the description | [`muddy.png`](muddy.png), 200x200, Muddy for his section: [`assets/icon.png`](../../assets/icon.png) made smaller; the description links it from GitHub, so it is pushed before the page is pasted |
| Tags | Utilities; **AI-Generated Content** (the code, written with Claude); **AI Media** (the banner, the tile and this page's text) |
| Requirements (the legacy mod requirements: file-to-file ones name only Nexus files and DLC) | Off-site: Node.js 24 (https://nodejs.org), runs the server and its setup; git (https://git-scm.com), with which the setup fetches the core. Nexus mods: Mod Organizer 2, 2.5.2 or later, "On Windows. On Linux, Amethyst Mod Manager instead." The .NET 10 SDK is none: the setup installs it |
| The file's options | Mod manager download off: it is a program for the user's PC, not a mod to install into the game. Primary file. The requirements popup on download on |
| Third-party content | Yes, with permission: Phostwood's crash rules (GPL-3.0, as this package), offsets read from Address Library, Crash Logger SSE's log format (the core's THIRD_PARTY_NOTICES.md) |
| Permissions | custom: open, as GPL-3.0 has it — upload, modify, convert and reuse, with credit, the same license and the source; Nexus's recommended settings forbid what GPL-3.0 allows |

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
