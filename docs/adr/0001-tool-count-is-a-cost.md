# The tool count is a cost, not a goal

Inherited from the server this template was extracted from, where it was decided against a measured
case: its backend offered 215 endpoint collections, the server wrapped about a quarter of them, and
full coverage would have meant roughly 350 tools.

We do not build toward wrapping everything a backend offers. The tool set stays as small as the jobs
it serves, and the backend's remaining surface is treated as a source of **improvements to the tools
we already have** — better arguments, fewer round trips, richer results — rather than as a list of
tools to build.

The reason is measured, not aesthetic. Every tool schema costs tokens, and every client without
on-demand schema fetching pays for the whole list on every turn: there, ~140 tools serialised to about
19,000 tokens per turn, and full coverage would have been about 51,000. The smallest client in scope
is a small local model with a 128k window, and it is the design target — reliability there comes from
better tools rather than more of them.

## Consequences

- Coverage is a diagnostic, not a target. A gap against what the backend offers is not a defect.
- A capability that genuinely blocks a real task is still a good reason to add a tool. **Demand is
  the evidence**, not the backend's catalogue.
- Profiles ([`src/lib/profiles.ts`](../../src/lib/profiles.ts)) exist for the same reason: they let one
  server serve both a client that can afford every tool and one that cannot.
