# mcp-template

<!-- TEMPLATE: your server's name, one paragraph on what it gives an agent access to, and badges. -->

A template for building **MCP servers in TypeScript** that a model uses correctly on the first try —
whether it runs in an agent harness that fetches tool schemas on demand or in a small local model
that carries every schema on every turn.

It was extracted from a production MCP server and stripped of its domain. What is left is the
machinery that made that server reliable, with an in-memory **notes** store standing in for a real
backend so that every pattern has a working, tested example.

## What you get

- **One-file tools.** A tool is a definition plus a `run(args)` that returns plain data. Dispatch,
  timing, the MCP envelope and error mapping live in one base class; the router, `tools/list` and the
  contract tests are all derived from the definitions, so a listed tool is always callable and tested.
- **Honest annotations.** All four MCP hints on every tool, held there by tests — including on the
  wire, which is what directories such as OpenAI's check.
- **Profiles.** `MCP_PROFILE` picks which tools are listed *and* routable, so a small client carries
  a small menu and `readonly` genuinely cannot write.
- **A response budget.** An over-sized answer is replaced by valid JSON that names the next step,
  never by a fragment a model will retry.
- **A capability gate.** Tools the backend cannot serve are withheld before `tools/list` answers, and
  every failure path fails open.
- **Self-documentation.** The guides in `docs/` and the skills in `skills/` are served as MCP
  resources *and* through `readServerGuide` / `readSkill`, so an agent can look things up by itself.
- **Session recovery.** Connect on demand, reconnect and retry once after a dropped session, and never
  retry a refused credential — retries lock accounts.
- **Two transports.** stdio, and Streamable HTTP with one backend session per caller's bearer token,
  sessions bound to their token, origin and host allow-lists, and a per-session rate limit.
- **Docs that cannot drift.** The tool reference is generated and a test compares it; `server.json`
  is checked against every environment variable the code reads.
- **A container.** A two-stage Dockerfile that ships the docs and skills the server reads at runtime.

## Quick start

```bash
git clone --recurse-submodules <this repository> my-server
cd my-server
npm install
npm run build
npm test
npm run smoke        # drives the built server over stdio
npm run dev          # the MCP Inspector, against the build
```

Register it with a client:

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["C:/path/to/my-server/dist/index.js"]
    }
  }
}
```

## Making it yours

[`AGENTS.md`](AGENTS.md#starting-a-new-server-from-this-template) has the step-by-step list. In short:
rename it in `package.json` and `server.json`, replace the backend in `src/backend/` and the tools in
`src/handlers/`, rewrite the domain parts of the docs, and swap the example skill. Every place that
needs a decision is marked `TEMPLATE:`:

```bash
grep -rn "TEMPLATE" --exclude-dir=node_modules --exclude-dir=dist .
```

Asking an agent to do it? Point it at `AGENTS.md` first — it was written for exactly that.

## Configuration

Everything is optional; the example runs with no configuration. See [`.env.example`](.env.example).

| Variable | Default | Effect |
| --- | --- | --- |
| `MCP_PROFILE` | `all` | `core`, `readonly` or `all` — which tools are listed and callable |
| `MCP_MAX_RESPONSE_BYTES` | per profile | Ceiling on one answer; `0` removes it |
| `MCP_GATE` | on | `off` skips asking the backend which features it has |
| `MCP_TRANSPORT` | `stdio` | `http` for Streamable HTTP at `/mcp` |
| `MCP_HTTP_PORT`, `MCP_HTTP_HOST` | `3000`, `0.0.0.0` | Where HTTP mode listens |
| `MCP_HTTP_ALLOWED_ORIGINS` | none | Browser origins allowed; `*` for any |
| `MCP_HTTP_ALLOWED_HOSTS` | any | `Host` values answered to |
| `MCP_HTTP_RATE_LIMIT` | `0` (off) | Requests per minute per session |
| `EXAMPLE_ACCEPTED_TOKENS` | none | Example backend: bearer tokens HTTP callers may present |

Running it for a team, over HTTP or in Docker: [`docs/Hosting.md`](docs/Hosting.md).

## Documentation

| Document | For |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Working on this code — conventions, layout, how to test, how to start a new server |
| [`docs/MCP-Tools.md`](docs/MCP-Tools.md) | How the server behaves: architecture, profiles, budget, gate, errors, troubleshooting |
| [`docs/Tool-Router.md`](docs/Tool-Router.md) | Which tool does what, in the words people use |
| [`docs/Tool-Reference.md`](docs/Tool-Reference.md) | Every tool and argument — generated, never edited by hand |
| [`docs/Hosting.md`](docs/Hosting.md) | stdio, Streamable HTTP, Docker |
| [`docs/Development-Skills.md`](docs/Development-Skills.md) | The bundled engineering skills |
| [`CONTEXT.md`](CONTEXT.md), [`docs/adr`](docs/adr) | Vocabulary and design decisions |

The guides are served to clients too: ask the running server with `readServerGuide`.

## Development

```bash
npm run build          # tsc -> dist/
npm test               # vitest, fully offline
npx tsc --noEmit       # type check only
npm run docs:tools     # regenerate docs/Tool-Reference.md after changing a tool (needs a build)
npm run smoke          # the built server over real stdio
```

## License

MIT — see [`LICENSE`](LICENSE).
