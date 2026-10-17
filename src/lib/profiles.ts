import type { ToolDefinition } from '../types/tools.js';

/**
 * Which tools this server lists, chosen at startup by MCP_PROFILE.
 *
 * Every tool schema costs tokens, and a client that cannot fetch schemas on
 * demand pays for the whole list on every single turn. Claude Code defers them
 * and does not care; a small local model with a 128k window can spend a sixth of
 * its context on tool schemas before the conversation starts, and that is where
 * the "same prompt works half the time" problem comes from.
 *
 * A profile is therefore not a convenience filter. A tool outside the active
 * profile is not routed either, so it cannot be called — which is what makes
 * `readonly` a safety property rather than a smaller menu.
 *
 * `healthcheck` is deliberately absent from every list: it is registered outside
 * the handlers and is always available, because it is the tool that answers
 * "which profile am I even running?".
 */

export type ProfileName = 'core' | 'readonly' | 'all';

/** The server's own guidance. Every profile gets it — it is what weak models lean on. */
const GUIDANCE = ['readServerGuide', 'readSkill'] as const;

/** Looking records up across the load order. */
const READ = ['findRecords', 'readRecord'] as const;

/**
 * The smallest write set that can still finish a job it starts: patch existing records, build the
 * patch, put it into Mod Organizer. A new mod from scratch and pulling Creation Kit work back need
 * the full profile.
 */
const CORE_WRITE = ['addPatch', 'buildProject', 'deployProject'] as const;

/** The mod manager's mods, read: what is installed, and whether it fits the game. */
const INSTALLED = ['listMods', 'checkGameVersion'] as const;

/**
 * The mod manager's mods, changed — so a mod that does not fit the game can be fixed as well as found:
 * installed again from a file that fits, or disabled. Both, not disabling alone, or disabling would be
 * the only remedy on offer (the user's decision, 2026-10-17).
 */
const MOD_WRITE = ['installMod', 'disableMod'] as const;

/** The Nexus Mods catalogue, read. */
const NEXUS_READ = ['searchNexus', 'readNexusMod'] as const;

/** Reading beyond the basics. Empty until the analysis wave. */
const ANALYSIS = [] as const;

export interface ProfileDefinition {
    description: string;
    /** Undefined means "every tool the handlers offer" — the `all` profile. */
    tools?: readonly string[];
}

export const PROFILES: Record<ProfileName, ProfileDefinition> = {
    core: {
        description:
            'The smallest set that can still find, read and change something. For small local models ' +
            'that receive every schema on every turn.',
        tools: [...READ, ...INSTALLED, ...CORE_WRITE, ...MOD_WRITE, ...GUIDANCE]
    },
    readonly: {
        description:
            'Reading, never changing. The write tools are absent rather than discouraged, so this ' +
            'profile cannot modify anything — profiles.test.ts holds every member to readOnlyHint.',
        tools: [...READ, ...INSTALLED, ...NEXUS_READ, ...ANALYSIS, ...GUIDANCE]
    },
    all: {
        description:
            'Every tool. The default, and the right choice for a client that fetches tool schemas ' +
            'on demand rather than carrying them all.'
    }
};

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];

/** The default. `all`, so a server with no profile configured behaves as it always has. */
export const DEFAULT_PROFILE: ProfileName = 'all';

export class ProfileError extends Error { }

/**
 * Reads MCP_PROFILE. An unrecognised name throws rather than falling back:
 * silently serving every tool to something that asked for six is the exact
 * failure profiles exist to prevent, and a typo would never be noticed.
 */
export function resolveProfile(env: NodeJS.ProcessEnv = process.env): ProfileName {
    const raw = String(env.MCP_PROFILE ?? '').trim().toLowerCase();
    if (!raw) return DEFAULT_PROFILE;

    if (!PROFILE_NAMES.includes(raw as ProfileName)) {
        throw new ProfileError(
            `MCP_PROFILE='${env.MCP_PROFILE}' is not a known profile. ` +
            `Use one of: ${PROFILE_NAMES.join(', ')}.`
        );
    }
    return raw as ProfileName;
}

/**
 * Applies a profile to the tools the handlers offer.
 *
 * A name in a profile that no handler provides is a bug in this file — most
 * likely a tool that was renamed or removed — and throwing here turns it into a
 * startup failure rather than a capability that quietly disappears.
 */
export function applyProfile(
    profile: ProfileName,
    tools: readonly ToolDefinition[]
): ToolDefinition[] {
    const wanted = PROFILES[profile].tools;
    if (!wanted) return [...tools];

    const available = new Set(tools.map(tool => tool.name));
    const unknown = wanted.filter(name => !available.has(name));
    if (unknown.length) {
        throw new ProfileError(
            `Profile '${profile}' lists ${unknown.length} tool(s) no handler provides: ` +
            `${unknown.join(', ')}. Update src/lib/profiles.ts.`
        );
    }

    const keep = new Set(wanted);
    return tools.filter(tool => keep.has(tool.name));
}
