import {
    applyProfile,
    resolveProfile,
    DEFAULT_PROFILE,
    PROFILES,
    PROFILE_NAMES,
    ProfileError
} from '../lib/profiles';
import type { ProfileName } from '../lib/profiles';
import { createHandlers } from '../handlers/index';
import type { AppBackend } from '../backend/index';
import type { ToolDefinition } from '../types/tools';

const tool = (name: string): ToolDefinition => ({
    name,
    description: `does ${name}`,
    inputSchema: { type: 'object', properties: {} }
});

/** The real catalogue, by name. getTools() never touches the backend. */
const CATALOGUE = new Map(
    createHandlers(undefined as unknown as AppBackend).flatMap(h => h.getTools()).map(t => [t.name, t])
);

const named = (name: ProfileName) => PROFILES[name].tools ?? [];

describe('resolveProfile', () => {
    it('defaults when unset, so an existing setup is unchanged', () => {
        expect(resolveProfile({})).toBe(DEFAULT_PROFILE);
        expect(resolveProfile({ MCP_PROFILE: '' })).toBe(DEFAULT_PROFILE);
        expect(resolveProfile({ MCP_PROFILE: '   ' })).toBe(DEFAULT_PROFILE);
    });

    it('accepts every defined profile, case- and space-insensitively', () => {
        for (const name of PROFILE_NAMES) {
            expect(resolveProfile({ MCP_PROFILE: name.toUpperCase() })).toBe(name);
            expect(resolveProfile({ MCP_PROFILE: ` ${name} ` })).toBe(name);
        }
    });

    it('throws on an unknown name rather than falling back', () => {
        // Falling back to `all` would hand every tool to something that asked for
        // a few, which is the exact failure profiles exist to prevent.
        expect(() => resolveProfile({ MCP_PROFILE: 'minimal' })).toThrow(ProfileError);
        expect(() => resolveProfile({ MCP_PROFILE: 'minimal' })).toThrow(new RegExp(PROFILE_NAMES.join(', ')));
    });
});

describe('applyProfile', () => {
    it('returns everything for a profile without a list', () => {
        const tools = [tool('a'), tool('b')];
        expect(applyProfile('all', tools)).toHaveLength(2);
    });

    it('keeps only the profile members, in tools/list order', () => {
        const members = [...named('core')];
        const offered = [tool('unlisted'), ...[...members].reverse().map(tool)];
        const kept = applyProfile('core', offered).map(t => t.name);

        expect(kept).not.toContain('unlisted');
        expect(kept).toHaveLength(members.length);
        // Order follows the input, not the profile definition.
        expect(kept).toEqual([...members].reverse());
    });

    it('throws when a profile names a tool no handler provides', () => {
        // A rename that misses profiles.ts must break the build, not silently
        // drop the tool from every profile that listed it.
        expect(() => applyProfile('core', [tool('findRecords')])).toThrow(ProfileError);
        expect(() => applyProfile('core', [tool('findRecords')])).toThrow(/Update src\/lib\/profiles\.ts/);
    });
});

describe('profile definitions', () => {
    it('names only tools the handlers actually provide', () => {
        const missing = PROFILE_NAMES.flatMap(name =>
            named(name).filter(t => !CATALOGUE.has(t)).map(t => `${name}: ${t}`));
        expect(missing).toEqual([]);
    });

    it('gives every profile the guides and skills, which is what weak models rely on', () => {
        for (const name of PROFILE_NAMES) {
            if (!PROFILES[name].tools) continue; // a profile without a list has them by definition
            expect(named(name)).toContain('readServerGuide');
            expect(named(name)).toContain('readSkill');
        }
    });

    it('makes readonly read-only by the tools\' own annotations, not by a list of names', () => {
        // Derived, so a write tool added to it later fails here even if nobody
        // remembered to think of it as a write.
        const writers = named('readonly').filter(t => CATALOGUE.get(t)?.annotations?.readOnlyHint !== true);
        expect(writers).toEqual([]);
    });

    it('gives core a write it can finish, not half a cycle', () => {
        // A profile that can start a job it cannot complete is worse than one
        // that cannot start it: a patch it can create, it must also be able to
        // build and deploy.
        expect(named('core')).toEqual(expect.arrayContaining(
            ['findRecords', 'readRecord', 'addPatch', 'buildProject', 'deployProject']));
        // The same for a mod that does not fit the game: core can find it, and both reinstall a file that
        // fits and disable it — not disable only (the user's decision, 2026-10-17).
        expect(named('core')).toEqual(expect.arrayContaining(['listMods', 'checkGameVersion', 'installMod', 'disableMod']));
    });

    it('lists no tool twice', () => {
        for (const name of PROFILE_NAMES) expect(new Set(named(name)).size).toBe(named(name).length);
    });

    it('describes every profile', () => {
        for (const name of PROFILE_NAMES) expect(PROFILES[name].description.length).toBeGreaterThan(30);
    });

    it('has a default that exists', () => {
        expect(PROFILE_NAMES).toContain(DEFAULT_PROFILE);
    });
});
