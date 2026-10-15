/**
 * The MCP `instructions` this server announces at `initialize`.
 *
 * They are the only thing a client sees before it calls anything, which makes
 * them the place for two facts a tool list cannot carry:
 *
 * - **What this instance is bound to.** When several of these servers are
 *   registered — one per environment, account or tenant — an agent asked to
 *   "check something in staging" has to pick the right one, and tool names
 *   alone do not say.
 * - **Where the help is.** A cold session knows nothing about this server; the
 *   one sentence pointing at `readServerGuide` is what turns a wrong first
 *   guess into a lookup.
 *
 * Kept short on purpose: clients put this into the system prompt on every turn.
 */
export function serverInstructions(target: string): string {
    return [
        'This server authors and analyses Skyrim Special Edition mods: it looks records up across the ' +
        'load order, builds mods kept as text projects into plugins deployed to the mod manager (Mod Organizer or Amethyst), ' +
        'and installs downloaded mods — with a Nexus Mods API key, it also finds them on Nexus Mods. ' +
        'Records are changed by editing the project\'s YAML files with your ordinary file tools.',
        `It is bound to ${target} and cannot be switched to another at runtime.`,
        'Before modding, read the skill skyrim-modding-basics (readSkill).',
        'If you know the job but not the tool, call readServerGuide with {"guide":"router"}; with no ' +
        'arguments it lists every guide and its sections. healthcheck reports what this server is bound ' +
        'to, the active tool profile, and anything withheld.',
        'An answer marked status:"truncated" was too large for this profile: narrow the request as its ' +
        'nextStep says instead of repeating it.'
    ].join(' ');
}
