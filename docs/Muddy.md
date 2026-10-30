# Modding with Muddy 🦀

<img src="../assets/icon.png" align="right" width="160" alt="Muddy, a mudcrab with a sword">

**Muddy** is the modding agent of the Skyrim Modding Tools: a mudcrab from the shore below Riverwood who learned to
mod Skyrim. He reads the modding skills before he writes a record, builds until the build says `success`, tells you
what he made and where, and leaves your mod manager alone unless you ask. His files are in the core:
[`agents/muddy`](https://github.com/Ciltress/skyrim-modding-tools-core/tree/main/agents/muddy).

Muddy needs the tools. Set up this server first ([README → Setup](../README.md#setup)), then set Muddy up in your
client as described below.

- [The quick way: `npm run setup`](#the-quick-way-npm-run-setup)
- [OpenClaw](#openclaw) · [Claude Code](#claude-code) · [Claude Desktop](#claude-desktop) · [VS Code](#vs-code) ·
  [ChatGPT](#chatgpt) · [Any other MCP client](#any-other-mcp-client)
- [Let your agent set him up](#let-your-agent-set-him-up)
- [The simplest way: two files in a folder](#the-simplest-way-two-files-in-a-folder)

## The quick way: `npm run setup`

Setup asks *"Set up Muddy, the modding agent, for your clients?"* After a yes, it writes three files:

| File | For |
| --- | --- |
| `~/.claude/agents/muddy.md` | Claude Code, and VS Code, which reads the same folder |
| `AGENTS.md` in your projects folder | Codex, the ChatGPT desktop app, VS Code, Cursor: every client that reads a folder's `AGENTS.md` |
| `CLAUDE.md` in your projects folder | Claude Code started in that folder; it holds only `@AGENTS.md` |

A file that is already there and differs from Muddy's (your own, or an older Muddy) is replaced only if you say yes.
The server also offers Muddy as an MCP **prompt** named `muddy`, for clients that start a chat from a prompt.

## OpenClaw

OpenClaw gets the tools from the [OpenClaw plugin](https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin),
not from this server, and the plugin has its own wizard for Muddy:

```bash
openclaw plugins install clawhub:skyrim-modding-tools
openclaw skyrim setup
```

It asks for his model (one OpenClaw lists, or one Ollama has installed), his context and how long he thinks, gives
him his own workspace, tools and skills, and lets him learn skills of his own from his work if you want.

## Claude Code

After `npm run setup`, Muddy is a Claude Code agent:

- **Work with Muddy all session:** `claude --agent muddy`. He greets you and asks what you want to mod.
- **Call him in a normal session:** type `@agent-muddy`, or say "let Muddy do it".
- **From the prompt:** `/skyrim:muddy` in the `/` menu starts him in the current chat.

By hand: copy the file `npm run setup` writes into `~/.claude/agents/muddy.md` yourself. Its frontmatter is `name`,
`description`, `model: inherit` and `color: orange`; the rest is [Muddy's prompt](#the-simplest-way-two-files-in-a-folder).
Change `model:` to `sonnet`, `opus` or `haiku` to give him a model of his own.

## Claude Desktop

Claude Desktop's chat has no agent files, but a **project** keeps instructions for every chat in it:

1. Register the server (`npm run setup` does it; by hand: [Hosting §1.1](Hosting.md)), then restart Claude Desktop.
2. Make a project named *Muddy* and paste the text of `AGENTS.md` from your projects folder into its instructions.
3. Start your chats in that project, with the `skyrim` connector switched on in the chat's **+** menu.

Where Claude Desktop lists the server's prompts in the **+** menu, the `muddy` prompt starts a single chat as Muddy,
without a project.

## VS Code

VS Code (GitHub Copilot Chat) reads Claude Code's agent folder, so after `npm run setup` **Muddy** is in the chat's
agent list: pick him there. VS Code also attaches the `AGENTS.md` of the folder you open, so opening your projects
folder brings him in as well. `/skyrim.muddy` in the chat starts him from the prompt.

By hand: make `~/.copilot/agents/muddy.agent.md` with `name: Muddy` and a `description` in its frontmatter, and
Muddy's prompt below it.

## ChatGPT

- **ChatGPT desktop app:** *Settings → MCP servers → Add server*, type **STDIO**, command `node` with the full path to
  this server's `dist/index.js`. Save, and restart the app. Then make a local project on your projects folder: the
  app reads its `AGENTS.md`, which is Muddy. (The desktop app keeps its servers in `~/.codex/config.toml`, shared with
  the Codex CLI, so Codex gets Muddy the same way.)
- **ChatGPT in the browser** reaches only servers on the internet, so this server would need a public HTTPS address.
  That opens your mod manager to the web, so we do not recommend it. Use the desktop app.

## Any other MCP client

Most clients take the server in this shape, in their own config file:

```json
{
  "mcpServers": {
    "skyrim": {
      "command": "node",
      "args": ["C:\\Users\\you\\skyrim-modding-tools-mcp\\dist\\index.js"]
    }
  }
}
```

Use the full path to `dist/index.js` in the folder where you cloned the server; on Linux, for example
`/home/you/skyrim-modding-tools-mcp/dist/index.js`. The settings stay in the server's `.env`, which `npm run setup`
wrote. Then give the client Muddy: as its custom instructions or system prompt, paste the text of `AGENTS.md` from your
projects folder. If the client shows MCP prompts, the `muddy` prompt does the same for one chat.

## Let your agent set him up

Paste this into the agent you already use (one that can run commands and edit files):

> Please set up Muddy, the Skyrim modding agent, for me in this client. Follow
> https://github.com/Ciltress/skyrim-modding-tools-mcp/blob/main/docs/Muddy.md. If the Skyrim Modding Tools MCP
> server is not installed yet, install it as its README says (`npm run setup`; I answer its questions myself, or you
> run it with `--instance` and the folder of my Mod Organizer test instance). Then set Muddy up the way the guide
> describes for this client. Ask me before you change anything outside the server's folder and this client's
> settings.

## The simplest way: two files in a folder

Muddy is two text files: [`SOUL.md`](https://github.com/Ciltress/skyrim-modding-tools-core/blob/main/agents/muddy/SOUL.md),
who he is, and [`AGENTS.md`](https://github.com/Ciltress/skyrim-modding-tools-core/blob/main/agents/muddy/AGENTS.md),
how he works. Copy both into the folder your agent works in, your projects folder for example:

- **OpenClaw** reads both from an agent's workspace.
- **Claude Code** reads `AGENTS.md`; add `@SOUL.md` as its first line to bring the soul along. If a `CLAUDE.md` is in
  that folder or above it, Claude Code reads that one instead: put `@AGENTS.md` into it.
- **Codex, the ChatGPT desktop app, VS Code and Cursor** read only `AGENTS.md`: paste the text of `SOUL.md` at its top.
