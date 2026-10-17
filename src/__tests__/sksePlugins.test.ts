import {
    addressLibraryFile, judgeGame, packVersion, parseSkseLog, predict, versionText, type GameInput, type SksePluginInfo
} from '../backend/skyrim/sksePlugins';

/**
 * Whether an SKSE plugin fits the game: the rules SKSE and Address Library apply, as Amethyst reads
 * them (AMM src/Utils/bethesda/skse_plugins.py), on the plugin's own declaration — and SKSE's log of
 * the last start, which says what it really loaded.
 */

const R1597 = packVersion('1.5.97.0');
const R1170 = packVersion('1.6.1170.0');
const R17104 = packVersion('1.7.104.0');

/** A plugin built with CommonLibSSE-NG against Address Library, after 1.7.99's change: what fits everywhere. */
function plugin(over: Omit<Partial<SksePluginInfo>, 'data'> & { data?: Partial<NonNullable<SksePluginInfo['data']>> } = {}): SksePluginInfo {
    const { data, ...rest } = over;
    return {
        file: 'Example.dll', machine: 0x8664, timestamp: Date.UTC(2026, 0, 1) / 1000, query: true, load: true, version: true,
        ...rest,
        data: data === undefined && 'data' in over ? undefined : {
            dataVersion: 1, pluginVersion: 0x01000000, name: 'Example', author: 'someone',
            independence: 1 | 4, independenceEx: 2, compatibleVersions: [], skseRequired: 0,
            ...data
        }
    };
}
const fits = { addressLibrary: true, skse: packVersion('2.3.1.0') };

describe('runtimes', () => {
    it('packs a version as SKSE does, the store digit last, and writes it back', () => {
        expect(R17104).toBe(0x01070680);
        expect(packVersion('1.6.1170')).toBe(R1170);
        expect(versionText(R1170)).toBe('1.6.1170');
        expect(packVersion('not a version')).toBe(0);
    });

    it('names Address Library\'s file for a runtime: versionlib from 1.6 on, version before', () => {
        expect(addressLibraryFile(R17104)).toBe('versionlib-1-7-104-0.bin');
        expect(addressLibraryFile(R1597)).toBe('version-1-5-97-0.bin');
    });
});

describe('what a plugin declares', () => {
    it('fits when it is built against Address Library, after 1.7.99\'s change', () => {
        expect(predict(plugin(), R17104, fits)).toBeUndefined();
        expect(predict(plugin(), R1170, fits)).toBeUndefined();
    });

    it('will not load a 32-bit DLL, made for Skyrim LE', () => {
        expect(predict(plugin({ machine: 0x14C }), R17104, fits)).toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/32-bit.*Skyrim LE/) });
    });

    it('will not load a plugin listing other runtimes only, naming them', () => {
        const pinned = plugin({ data: { independence: 0, independenceEx: 0, compatibleVersions: [R1170] } });
        expect(predict(pinned, R17104, fits)).toMatchObject({ kind: 'willNotLoad', runtimes: ['1.6.1170'], reason: expect.stringMatching(/built for 1\.6\.1170 only/) });
        // The last digit tells the store apart, not the game: a GOG build's 1.6.1179.1 is Steam's 1.6.1179.0.
        expect(predict(pinned, R1170 | 1, fits)).toBeUndefined();
    });

    it('will not load, on 1.6 or later, a plugin made for 1.5.97 — it has no version data', () => {
        const se = plugin({ version: false, data: undefined });
        expect(predict(se, R17104, fits)).toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/1\.5\.97.*no version data/) });
        expect(predict(se, R1597, fits)).toBeUndefined();
        expect(predict(plugin({ query: false }), R1597, fits)).toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/1\.6 or later/) });
    });

    it('may not work: an Address Library plugin built before 2025-05-26, without the newer flag, on 1.7.99 or later', () => {
        const old = plugin({ timestamp: Date.UTC(2024, 5, 1) / 1000, data: { independenceEx: 0 } });
        expect(predict(old, R17104, fits)).toMatchObject({ kind: 'mayNotWork', reason: expect.stringMatching(/before.*1\.7\.99/) });
        expect(predict(old, R1170, fits)).toBeUndefined();
        // Listing the runtime itself, it is built for it.
        expect(predict({ ...old, data: { ...old.data!, compatibleVersions: [R17104] } }, R17104, fits)).toBeUndefined();
    });

    it('will not load a plugin on the wrong side of 1.6.629\'s struct change', () => {
        expect(predict(plugin({ data: { independence: 1, independenceEx: 2 } }), R17104, fits))
            .toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/before 1\.6\.629/) });
        expect(predict(plugin({ data: { independence: 1 | 4, independenceEx: 2 } }), packVersion('1.6.353.0'), fits))
            .toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/1\.6\.629 or later/) });
        // A plugin that uses no game structs at all fits both sides.
        expect(predict(plugin({ data: { independence: 1, independenceEx: 1 | 2 } }), R17104, fits)).toBeUndefined();
    });

    it('will not work without Address Library\'s file for the runtime, or with an SKSE older than it needs', () => {
        expect(predict(plugin(), R17104, { ...fits, addressLibrary: false }))
            .toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/versionlib-1-7-104-0\.bin/) });
        expect(predict(plugin({ data: { skseRequired: packVersion('2.3.2.0') } }), R17104, fits))
            .toMatchObject({ kind: 'willNotLoad', reason: expect.stringMatching(/SKSE 2\.3\.2 or newer.*2\.3\.1/) });
    });

    it('says nothing of flags it does not know, rather than guess', () => {
        expect(predict(plugin({ data: { independence: 8 } }), R17104, fits)).toBeUndefined();
    });
});

describe('judging a game\'s SKSE plugins', () => {
    const now = Date.UTC(2026, 9, 17);
    const pinned = plugin({ file: 'mods/Pinned/SKSE/Plugins/Pinned.dll', data: { independence: 0, independenceEx: 0, compatibleVersions: [R1170] } });
    const old = plugin({ file: 'mods/Old/SKSE/Plugins/Old.dll', timestamp: Date.UTC(2024, 5, 1) / 1000, data: { independenceEx: 0 } });
    const oldToo = plugin({ file: 'mods/OldToo/SKSE/Plugins/OldToo.dll', timestamp: Date.UTC(2024, 1, 1) / 1000, data: { independenceEx: 0 } });
    const good = plugin({ file: 'mods/Good/SKSE/Plugins/Good.dll' });
    const entry = (info: SksePluginInfo, mod: string, nexus?: { modId: number; version?: string }) =>
        ({ dll: info.file.split('/').pop()!, mod, info, modified: now - 86_400_000, ...(nexus ? { nexus } : {}) });
    const input = (over: Partial<GameInput> = {}): GameInput => ({
        runtime: R17104,
        skse: { version: packVersion('2.3.1.0'), runtimes: ['1.7.104'] },
        addressLibrary: true,
        plugins: [entry(good, 'Good'), entry(pinned, 'Pinned', { modId: 16495, version: '5.0' }), entry(old, 'Old'), entry(oldToo, 'OldToo')],
        disabledWithSkse: 2,
        ...over
    });

    it('groups the plugins that do not fit by verdict and reason, each with its mod and Nexus record, and counts the rest', () => {
        const judged = judgeGame(input());
        expect(judged).toMatchObject({
            game: { runtime: '1.7.104' },
            skse: { installed: true, version: '2.3.1', forThisRuntime: true },
            addressLibrary: { file: 'versionlib-1-7-104-0.bin', installed: true },
            plugins: { checked: 4, fit: 1, inDisabledMods: 2 }
        });
        expect(judged.problems).toEqual([
            { verdict: 'willNotLoad', reason: 'built for 1.6.1170 only, not 1.7.104', runtimes: ['1.6.1170'], plugins: [{ dll: 'Pinned.dll', mod: 'Pinned', nexusModId: 16495, version: '5.0' }] },
            {
                verdict: 'mayNotWork', reason: expect.stringMatching(/before 2025-05-26/),
                plugins: [{ dll: 'Old.dll', mod: 'Old' }, { dll: 'OldToo.dll', mod: 'OldToo' }]
            }
        ]);
        expect(judged.nextStep).toMatch(/readNexusMod.*installMod.*replace.*ask the user/);
    });

    it('takes SKSE\'s log of the last start as the fact for what it says, when it is this game\'s and the plugin is unchanged since', () => {
        const log = parseSkseLog([
            'SKSE64 runtime: initialize (version = 2.3.1 01070680 01DD5B2135D4A5DD, os = 6.2 (9200))',
            'plugin Good.dll (00000001 Good 00000001) disabled, fatal error occurred while loading plugin 00000000 (handle 0)',
            'plugin Pinned.dll (00000001 Pinned 00000001) disabled, incompatible with current runtime version 00000000 (handle 0)',
            'plugin Old.dll (00000001 Old 00000001) loaded correctly (handle 3)'
        ].join('\r\n'))!;
        const judged = judgeGame(input({ log: { file: 'skse64.log', modified: now, parsed: log, thisGame: true } }));
        expect(judged.log).toMatchObject({ used: true, date: '2026-10-17T00:00:00.000Z' });
        expect(judged.problems.map(p => [p.verdict, p.plugins.map(x => x.dll)])).toEqual([
            ['refusedAtLastStart', ['Good.dll']],
            ['refusedAtLastStart', ['Pinned.dll']],
            // Loaded is not working: an Address Library plugin from before the change keeps its warning.
            ['mayNotWork', ['Old.dll', 'OldToo.dll']]
        ]);
        expect(judged.problems[0].reason).toMatch(/SKSE said: disabled, fatal error/);
        expect(judged.problems[2].reason).toMatch(/SKSE loaded Old\.dll at the last start/);
    });

    it('does not take the log of another game, another runtime, or one older than the plugin', () => {
        const log = parseSkseLog('SKSE64 runtime: initialize (version = 2.2.6 01064920 01DD5B2135D4A5DD, os = 6.2 (9200))\r\n' +
            'plugin Pinned.dll (00000001 Pinned 00000001) loaded correctly (handle 3)')!;
        expect(judgeGame(input({ log: { file: 'skse64.log', modified: now, parsed: log, thisGame: true } })).log)
            .toMatchObject({ used: false, why: expect.stringMatching(/1\.6\.1170.*1\.7\.104/) });
        expect(judgeGame(input({ log: { file: 'skse64.log', modified: now, parsed: log, thisGame: false } })).log)
            .toMatchObject({ used: false, why: expect.stringMatching(/another game folder/) });
    });

    it('says when SKSE is missing, or built for another runtime', () => {
        expect(judgeGame(input({ skse: { runtimes: [] } })).skse).toMatchObject({ installed: false, note: expect.stringMatching(/skse64_loader\.exe/) });
        expect(judgeGame(input({ skse: { version: packVersion('2.2.6.0'), runtimes: ['1.6.1170'] } })).skse)
            .toMatchObject({ installed: true, forThisRuntime: false, note: expect.stringMatching(/1\.6\.1170.*1\.7\.104/) });
    });
});

describe('SKSE\'s log', () => {
    const log = [
        'SKSE64 runtime: initialize (version = 2.2.6 01064920 01DD5B2135D4A5DD, os = 6.2 (9200))',
        'imagebase = 00007FF6E09E0000',
        'plugin directory = G:\\LoreRim\\Stock Game\\Data\\SKSE\\Plugins\\',
        'checking plugin ActorLimitFix.dll',
        'plugin msdia140.dll (00000000  00000000) no version data 0 (handle 0)',
        'plugin po3_DualCastingFix.dll (00000000  00000000) no version data 0 (handle 0)',
        'loading plugin "Actor Limit Fix"',
        'plugin ActorLimitFix.dll (00000001 Actor Limit Fix 00000009) loaded correctly (handle 3)',
        'plugin Old.dll (00000001 Old 00000001) disabled, incompatible with current runtime version 00000000 (handle 0)'
    ].join('\r\n');

    it('reads SKSE\'s version, the runtime, the plugin folder, and what became of each plugin', () => {
        const read = parseSkseLog(log);
        expect(read).toMatchObject({ skse: '2.2.6', runtime: R1170, pluginDir: 'G:\\LoreRim\\Stock Game\\Data\\SKSE\\Plugins\\' });
        expect(read!.plugins.get('actorlimitfix.dll')).toEqual({ loaded: true, said: 'loaded correctly' });
        expect(read!.plugins.get('po3_dualcastingfix.dll')).toEqual({ loaded: false, said: 'no version data' });
        expect(read!.plugins.get('old.dll')).toEqual({ loaded: false, said: 'disabled, incompatible with current runtime version' });
    });

    it('reads no log that is not SKSE\'s', () => {
        expect(parseSkseLog('something else\r\n')).toBeUndefined();
    });
});
