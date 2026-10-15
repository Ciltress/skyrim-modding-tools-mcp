# syntax=docker/dockerfile:1

# This server speaks MCP over **stdio** by default, and over **Streamable HTTP**
# when started with `MCP_TRANSPORT=http` (see docs/Hosting.md). In stdio mode
# there is no port to publish and nothing to health-probe: a client starts it
# with `docker run -i --rm` and talks to it over the container's stdin/stdout. In
# HTTP mode it listens on `MCP_HTTP_PORT` (default 3000, `EXPOSE`d below) and
# each connecting client supplies its own bearer token.

FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Dependencies first, from the lockfile, so a source-only change does not
# reinstall them. `npm ci` rather than `npm install`: it fails on a lockfile that
# disagrees with package.json instead of quietly resolving something else.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Prune in the same layer, so the devDependencies never reach the runner.
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Not optional. The server reads its name and version from package.json, and
# serves guides and skills from these paths at runtime: an image without them
# answers every readServerGuide, readSkill and resource read with a
# file-not-found while the rest of the server looks perfectly healthy.
#
# `skills/Development` is a git submodule: build from a `--recurse-submodules`
# clone or the image ships without it.
COPY docs ./docs
COPY skills ./skills
COPY AGENTS.md ./

# Only listened on in Streamable HTTP mode; harmless to publish otherwise,
# since stdio mode never opens it.
EXPOSE 3000

USER node

# One process talking MCP on stdout. Everything else it says goes to stderr: a
# stray line on stdout is not a protocol frame and corrupts every tool at once.
ENTRYPOINT ["node", "dist/index.js"]
