/**
 * Whether an SKSE plugin fits the game it is installed for, from what the plugin itself declares —
 * SKSE's version data, which the helper reads out of the DLL without loading it — and from SKSE's own
 * log of the last game start. The rules are SKSE's and Address Library's as Amethyst Mod Manager reads
 * them (src/Utils/bethesda/skse_plugins.py at v2.5.4), written anew here; the research is in
 * docs/research/2026-10-15-linux-mo2-and-platform.md §1.7.
 *
 * Three verdicts, because a plugin flagged can still work (the user's word, 2026-10-17): what SKSE
 * refused at the last start is a fact; what it will refuse follows from rules it applies; and what may
 * not work is Amethyst's judgement of Address Library plugins from before 1.7.99's change.
 */

/** What the helper reads out of a DLL: its machine and build time, which SKSE exports it has, its version data. */
export interface SksePluginInfo {
    file: string;
    /** IMAGE_FILE_MACHINE: 0x8664 for 64-bit, 0x14C for 32-bit. */
    machine: number;
    /** When it was linked, in seconds since 1970 — the PE header's own stamp. */
    timestamp: number;
    /** SKSEPlugin_Query, SKSEPlugin_Load, SKSEPlugin_Version exported. */
    query: boolean;
    load: boolean;
    version: boolean;
    /** SKSEPlugin_Version's data, where it is there and readable. */
    data?: {
        dataVersion: number;
        pluginVersion: number;
        name: string;
        author: string;
        /** kVersionIndependent_*: 1 Address Library (after AE), 2 signatures, 4 structs after 1.6.629. */
        independence: number;
        /** kVersionIndependentEx_*: 1 no struct use, 2 Address Library v5 (1.7.99's). */
        independenceEx: number;
        compatibleVersions: number[];
        /** The oldest SKSE it runs on; 0 for any. */
        skseRequired: number;
    };
}

export type VerdictKind = 'refusedAtLastStart' | 'willNotLoad' | 'mayNotWork';

export interface Prediction {
    kind: Exclude<VerdictKind, 'refusedAtLastStart'>;
    reason: string;
    /** The runtimes the plugin names, where they are the point. */
    runtimes?: string[];
}

/** What else decides: Address Library's file for this runtime is there; the SKSE installed, packed, if known. */
export interface Surroundings {
    addressLibrary: boolean;
    skse?: number;
}

const ADDRESS_LIBRARY = 1;
const SIGNATURES = 2;
const STRUCTS_POST_629 = 4;
const NO_STRUCTS = 1;
const ADDRESS_LIBRARY_V5 = 2;
const AMD64 = 0x8664;
const I386 = 0x14C;

const R16 = packVersion('1.6.0.0');
const R629 = packVersion('1.6.629.0');
const R1799 = packVersion('1.7.99.0');
/** Address Library plugins linked in this window, without the v5 flag, predate 1.7.99's database (Amethyst). */
const BEFORE_V5 = [520_128_000, 1_748_217_600] as const;

/** A version as SKSE packs one: major.minor.build.sub → major<<24 | minor<<16 | build<<4 | sub. 0 for none. */
export function packVersion(text: string): number {
    const parts = text.trim().split('.').map(Number);
    if (parts.length === 3) parts.push(0);
    const limits = [255, 255, 4095, 15];
    if (parts.length !== 4 || parts.some((part, i) => !Number.isInteger(part) || part < 0 || part > limits[i])) return 0;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 4) | parts[3]) >>> 0;
}

/** major.minor.build: the last digit tells the stores apart, not the game. */
export function versionText(packed: number): string {
    return `${packed >>> 24}.${(packed >>> 16) & 255}.${(packed >>> 4) & 4095}`;
}

/** Address Library's database for a runtime, in Data/SKSE/Plugins. */
export function addressLibraryFile(runtime: number): string {
    const [major, minor, build] = versionText(runtime).split('.');
    return `${runtime >= R16 ? 'versionlib' : 'version'}-${major}-${minor}-${build}-0.bin`;
}

/** Why a plugin will not load or may not work on `runtime`; undefined when it fits, or when it says nothing this can judge. */
export function predict(plugin: SksePluginInfo, runtime: number, around: Surroundings): Prediction | undefined {
    const game = versionText(runtime);
    if (plugin.machine === I386) {
        return { kind: 'willNotLoad', reason: 'a 32-bit DLL, made for Skyrim LE: SKSE64 cannot load it' };
    }
    if (plugin.machine !== AMD64) return undefined;
    if (runtime < R16) {
        // SKSE for 1.5.97 asks SKSEPlugin_Query; it does not read the version data.
        return plugin.query ? undefined
            : { kind: 'willNotLoad', reason: `built for 1.6 or later (the Anniversary update): SKSE for ${game} needs SKSEPlugin_Query, which it does not have` };
    }
    if (!plugin.version) {
        return plugin.query
            ? { kind: 'willNotLoad', reason: `made for 1.5.97: it has no version data, which SKSE for 1.6 and later needs` }
            : undefined;
    }
    const data = plugin.data;
    if (!data) return undefined;
    const flags = data.independence;
    const extended = data.independenceEx;
    if (flags & ~7 || extended & ~3) return undefined;

    const usesLibrary = Boolean(flags & ADDRESS_LIBRARY);
    let independent = Boolean(flags & (ADDRESS_LIBRARY | SIGNATURES));
    const beforeV5 = runtime >= R1799 && usesLibrary && !(extended & ADDRESS_LIBRARY_V5)
        && plugin.timestamp >= BEFORE_V5[0] && plugin.timestamp < BEFORE_V5[1];
    if (beforeV5) independent = false;
    if (independent && runtime >= R629 && !(flags & STRUCTS_POST_629 || extended & NO_STRUCTS)) {
        return { kind: 'willNotLoad', reason: `built before 1.6.629, whose game structs changed: SKSE for ${game} does not load it` };
    }
    if (independent && runtime < R629 && flags & STRUCTS_POST_629 && !(extended & NO_STRUCTS)) {
        return { kind: 'willNotLoad', reason: `built for 1.6.629 or later, whose game structs it uses: it does not fit ${game}` };
    }
    const listed = data.compatibleVersions.some(version => (version & ~15) === (runtime & ~15));
    if (!independent && !listed) {
        const runtimes = [...new Set(data.compatibleVersions.map(versionText))];
        if (beforeV5) {
            return {
                kind: 'mayNotWork', ...(runtimes.length > 0 ? { runtimes } : {}),
                reason: `an Address Library plugin built before 2025-05-26, without the flag for 1.7.99's Address Library: ` +
                    `SKSE loads it on ${game}, and it may look its game addresses up wrong — try it in the game`
            };
        }
        return {
            kind: 'willNotLoad', runtimes,
            reason: runtimes.length > 0 ? `built for ${runtimes.join(', ')} only, not ${game}` : `it names no runtime it fits, and is bound to none`
        };
    }
    if (usesLibrary && !around.addressLibrary) {
        return { kind: 'willNotLoad', reason: `it needs Address Library, and its file for ${game}, ${addressLibraryFile(runtime)}, is not installed` };
    }
    if (around.skse && data.skseRequired > around.skse) {
        return { kind: 'willNotLoad', reason: `it needs SKSE ${versionText(data.skseRequired)} or newer; ${versionText(around.skse)} is installed` };
    }
    return undefined;
}

// ---------------------------------------------------------------- a whole game

/** One DLL as the game loads it: its file name, the mod it comes from, what the helper read of it. */
export interface GamePlugin {
    dll: string;
    mod: string;
    info: SksePluginInfo | { file: string; plugin: false } | { file: string; error: string };
    /** When the file last changed, in ms — to tell whether SKSE's log saw this copy. */
    modified: number;
    nexus?: { modId: number; version?: string };
}

export interface GameInput {
    runtime: number;
    /** SKSE in the game folder: its loader's version, if it has one, and the runtimes its skse64_*.dll are for. */
    skse: { version?: number; runtimes: string[] };
    addressLibrary: boolean;
    plugins: GamePlugin[];
    /** Disabled mods that carry SKSE plugins: not checked, only counted. */
    disabledWithSkse: number;
    /** SKSE's log, where one was found; `thisGame` when its plugin folder is this game's. */
    log?: { file: string; modified: number; parsed?: SkseLog; thisGame: boolean };
}

export interface GameProblem {
    verdict: VerdictKind;
    reason: string;
    runtimes?: string[];
    plugins: Array<{ dll: string; mod: string; nexusModId?: number; version?: string }>;
}

export interface GameVersionCheck {
    game: { runtime: string };
    skse: { installed: boolean; version?: string; forThisRuntime?: boolean; note?: string };
    addressLibrary: { file: string; installed: boolean };
    log: { file: string; date: string; used: boolean; why?: string } | { found: false };
    plugins: { checked: number; fit: number; notSksePlugins?: number; unreadable?: number; inDisabledMods: number };
    /** The plugins that do not fit, one entry per verdict and reason: SKSE's log first, then the rules, then what may not work. */
    problems: GameProblem[];
    nextStep?: string;
}

const VERDICT_ORDER: VerdictKind[] = ['refusedAtLastStart', 'willNotLoad', 'mayNotWork'];

/**
 * The game's SKSE plugins judged together. SKSE's log decides what it says, for the plugins it saw —
 * when the log is this game's, of this runtime, and no younger than the plugin's file — and the rules
 * the rest; a plugin SKSE loaded keeps a "may not work", since loading is not working.
 */
export function judgeGame(input: GameInput): GameVersionCheck {
    const game = versionText(input.runtime);
    const log = input.log;
    const logOfRuntime = log?.parsed && (log.parsed.runtime & ~15) === (input.runtime & ~15);
    const logUsed = Boolean(log?.parsed && log.thisGame && logOfRuntime);

    const groups = new Map<string, GameProblem & { loaded: string[] }>();
    let checked = 0, fit = 0, notSksePlugins = 0, unreadable = 0;
    for (const plugin of input.plugins) {
        if ('error' in plugin.info) { unreadable++; continue; }
        if ('plugin' in plugin.info) { notSksePlugins++; continue; }
        checked++;
        const said = logUsed && plugin.modified <= log!.modified ? log!.parsed!.plugins.get(plugin.dll.toLowerCase()) : undefined;
        const predicted = predict(plugin.info, input.runtime, { addressLibrary: input.addressLibrary, skse: input.skse.version });
        let verdict: VerdictKind;
        let reason: string;
        if (said && !said.loaded) {
            verdict = 'refusedAtLastStart';
            reason = `SKSE said: ${said.said}${predicted ? ` — ${predicted.reason}` : ''}`;
        } else if (predicted && (!said || predicted.kind === 'mayNotWork')) {
            verdict = predicted.kind;
            reason = predicted.reason;
        } else {
            fit++;
            continue;
        }
        const key = `${verdict}\n${reason}`;
        const group = groups.get(key) ?? {
            verdict, reason, ...(predicted?.runtimes && verdict !== 'refusedAtLastStart' ? { runtimes: predicted.runtimes } : {}),
            plugins: [], loaded: []
        };
        group.plugins.push({ dll: plugin.dll, mod: plugin.mod, ...(plugin.nexus ? { nexusModId: plugin.nexus.modId } : {}),
            ...(plugin.nexus?.version ? { version: plugin.nexus.version } : {}) });
        if (said?.loaded) group.loaded.push(plugin.dll);
        groups.set(key, group);
    }
    const problems = [...groups.values()]
        .map(({ loaded, ...group }) => ({
            ...group,
            plugins: group.plugins.sort((a, b) => a.mod.localeCompare(b.mod)),
            ...(loaded.length > 0 ? { reason: `${group.reason}. SKSE loaded ${loaded.join(', ')} at the last start — loading is not working` } : {})
        }))
        .sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.plugins[0].mod.localeCompare(b.plugins[0].mod));

    return {
        game: { runtime: game },
        skse: skseState(input, game),
        addressLibrary: { file: addressLibraryFile(input.runtime), installed: input.addressLibrary },
        log: !log ? { found: false } : {
            file: log.file, date: new Date(log.modified).toISOString(), used: logUsed,
            ...(logUsed ? {} : {
                why: !log.parsed ? 'it is no log SKSE wrote'
                    : !log.thisGame ? `it is from another game folder: SKSE loaded plugins from ${log.parsed.pluginDir}`
                    : `it is from a start of ${versionText(log.parsed.runtime)}; the game is now ${game}`
            })
        },
        plugins: {
            checked, fit,
            ...(notSksePlugins > 0 ? { notSksePlugins } : {}),
            ...(unreadable > 0 ? { unreadable } : {}),
            inDisabledMods: input.disabledWithSkse
        },
        problems,
        ...(problems.length > 0 ? {
            nextStep: `Read the skill game-versions first (readSkill). For each mod named: readNexusMod with its nexusModId, for a ` +
                `file built for ${game} or for Address Library after 1.7.99's change; install it with installMod, replace: true and ` +
                `the mod's name, then checkGameVersion again. Where there is none, ask the user whether to disable the mod, and ` +
                `disableMod it only on their yes — for "mayNotWork", after trying the game: it often still works.`
        } : {})
    };
}

function skseState(input: GameInput, game: string): GameVersionCheck['skse'] {
    const version = input.skse.version ? versionText(input.skse.version) : undefined;
    if (!version && input.skse.runtimes.length === 0) {
        return {
            installed: false,
            note: `SKSE is not in the game folder (no skse64_loader.exe), and no SKSE plugin loads without it: install SKSE for ${game} ` +
                `(skse.silverlock.org, or Nexus mod 30379) into the game folder, and start the game with skse64_loader.exe.`
        };
    }
    const forThisRuntime = input.skse.runtimes.includes(game);
    return {
        installed: true, ...(version ? { version } : {}), forThisRuntime,
        ...(forThisRuntime ? {} : {
            note: `The SKSE in the game folder${version ? `, ${version},` : ''} is for ${input.skse.runtimes.join(', ') || 'another runtime'}, ` +
                `not ${game}: install SKSE built for ${game} (skse.silverlock.org, or Nexus mod 30379).`
        })
    };
}

// ---------------------------------------------------------------- SKSE's log

export interface SkseLog {
    /** SKSE's own version, e.g. 2.2.6. */
    skse: string;
    /** The runtime SKSE started on, packed. */
    runtime: number;
    /** The folder it loaded plugins from, as it wrote it. */
    pluginDir: string;
    /** By the DLL's file name, lower case: whether SKSE loaded it, and what it said. */
    plugins: Map<string, { loaded: boolean; said: string }>;
}

/**
 * skse64.log, rewritten at every game start: `plugin X.dll (00000001 Name 01000000) loaded correctly
 * (handle 3)` for a plugin it loaded, and its reason — `no version data`, `disabled, incompatible with
 * current runtime version` — for one it refused. Undefined for a file that is not SKSE's log.
 */
export function parseSkseLog(text: string): SkseLog | undefined {
    const lines = text.split(/\r?\n/);
    const start = /^SKSE64 runtime: initialize \(version = ([\d.]+) ([0-9A-Fa-f]{8})/.exec(lines[0] ?? '');
    if (!start) return undefined;
    const plugins = new Map<string, { loaded: boolean; said: string }>();
    let pluginDir = '';
    for (const line of lines) {
        const dir = /^plugin directory = (.*)$/.exec(line);
        if (dir) {
            pluginDir = dir[1].trim();
            continue;
        }
        const entry = /^plugin (.+?\.dll) \((.*)\) (.+?)(?: [0-9A-Fa-f]{8}| \d+)? \(handle -?\d+\)\s*$/i.exec(line);
        if (!entry) continue;
        const said = entry[3].trim();
        plugins.set(entry[1].toLowerCase(), { loaded: said === 'loaded correctly', said });
    }
    return { skse: start[1], runtime: parseInt(start[2], 16) >>> 0, pluginDir, plugins };
}
