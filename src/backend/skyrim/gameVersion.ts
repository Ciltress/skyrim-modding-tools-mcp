import fs from 'node:fs';
import path from 'node:path';
import type { HelperTransport } from './helperClient.js';
import { hasSksePlugins, nexusRecord, ownerOf } from './modList.js';
import type { Instance, ModEntry, ModManager } from './modManager.js';
import { findCaseInsensitive } from './paths.js';
import type { Platform } from './platform.js';
import { addressLibraryFile, judgeGame, packVersion, parseSkseLog, type GamePlugin, type GameVersionCheck } from './sksePlugins.js';

const SKSE_FILES = new Set(['.dll', '.bin']);

/** The SKSE folder in My Games of each store's game; Steam's is the plain one. */
const MY_GAMES: Record<string, string> = { gog: 'Skyrim Special Edition GOG', epic: 'Skyrim Special Edition EPIC' };

/**
 * Everything checkGameVersion judges, gathered from the instance: the copy of each SKSE plugin the game
 * loads — the game's Data, enabled mods by priority, overwrite — read by the helper; SKSE in the game
 * folder; Address Library's file for the runtime; and SKSE's log of the last start from My Games.
 */
export async function checkGameVersion(
    manager: ModManager, platform: Platform, helper: HelperTransport, instance: Instance, gameVersion: string | undefined
): Promise<GameVersionCheck> {
    const runtime = packVersion(gameVersion ?? '');
    if (!runtime) {
        throw new GameVersionUnknownError(`The game's version could not be read from ${path.join(instance.gameDir, 'SkyrimSE.exe')}, ` +
            'so its SKSE plugins cannot be judged: healthcheck says what the server found.');
    }
    const mods = manager.readModList(instance);
    const files = manager.resolveDataFiles(instance, mods, 'SKSE/Plugins', SKSE_FILES);
    const dlls = [...files.values()].filter(file => file.toLowerCase().endsWith('.dll'));
    const read = dlls.length > 0
        ? (await helper.call<{ plugins: GamePlugin['info'][] }>('sksePlugins', { files: dlls }, 300_000)).plugins
        : [];
    const plugins: GamePlugin[] = dlls.map((file, i) => {
        const mod = ownerOf(file, instance);
        const nexus = nexusRecord(path.join(instance.modsDir, mod));
        return {
            dll: path.basename(file), mod, info: read[i] ?? { file, error: 'the helper gave no answer for it' }, modified: modifiedAt(file),
            ...(nexus ? { nexus: { modId: nexus.modId, ...(nexus.version ? { version: nexus.version } : {}) } } : {})
        };
    });

    return judgeGame({
        runtime,
        skse: await skseInGame(instance, mods, helper),
        addressLibrary: files.has(addressLibraryFile(runtime).toLowerCase()),
        plugins,
        disabledWithSkse: mods.filter(mod => mod.managed && !mod.enabled && hasSksePlugins(path.join(instance.modsDir, mod.name))).length,
        log: await skseLog(manager, platform, instance)
    });
}

export class GameVersionUnknownError extends Error { }

/**
 * SKSE as the game is started with it: its loader's version (`0.2.3.1` is SKSE 2.3.1), and the runtimes its
 * skse64_*.dll are for — in the game folder, or in an enabled mod's Root folder, which Root Builder copies
 * into the game folder at launch (LoreRim installs SKSE so); the highest mod's loader wins.
 */
async function skseInGame(instance: Instance, mods: readonly ModEntry[], helper: HelperTransport): Promise<{ version?: number; runtimes: string[] }> {
    const roots = [instance.gameDir, ...[...mods].reverse()
        .filter(mod => mod.enabled && mod.managed)
        .map(mod => findCaseInsensitive(path.join(instance.modsDir, mod.name), 'Root'))
        .filter((dir): dir is string => dir !== undefined)];
    const runtimes = new Set<string>();
    let loader: string | undefined;
    for (const root of roots) {
        let names: string[] = [];
        try {
            names = fs.readdirSync(root);
        } catch {
            continue;
        }
        for (const name of names) {
            const match = /^skse64_(\d+)_(\d+)_(\d+)\.dll$/i.exec(name);
            if (match) runtimes.add(`${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`);
            if (name.toLowerCase() === 'skse64_loader.exe') loader = path.join(root, name);
        }
    }
    if (!loader) return { runtimes: [...runtimes] };
    try {
        const text = (await helper.call<{ version: string | null }>('gameVersion', { exePath: loader })).version ?? '';
        const version = packVersion(/^0\.\d+\.\d+\.\d+$/.test(text) ? text.slice(2) : text);
        return { ...(version ? { version } : {}), runtimes: [...runtimes] };
    } catch {
        return { runtimes: [...runtimes] };
    }
}

/** SKSE's log, where the game writes My Games — the user's Documents, or the Proton prefix's — and whether it is this game's. */
async function skseLog(manager: ModManager, platform: Platform, instance: Instance) {
    const prefix = manager.winePrefix(instance);
    const documents = await platform.documentsDir(prefix);
    if (!documents) return undefined;
    const store = Object.keys(MY_GAMES).find(key => instance.edition.toLowerCase().includes(key));
    const file = path.join(documents, 'My Games', store ? MY_GAMES[store] : 'Skyrim Special Edition', 'SKSE', 'skse64.log');
    if (!fs.existsSync(file)) return undefined;
    const parsed = parseSkseLog(fs.readFileSync(file, 'utf8'));
    const seen = parsed?.pluginDir ? platform.windowsPaths(prefix)(parsed.pluginDir) : undefined;
    const thisGame = !!seen && path.resolve(seen).toLowerCase() === path.resolve(instance.gameDir, 'Data', 'SKSE', 'Plugins').toLowerCase();
    return { file, modified: modifiedAt(file), ...(parsed ? { parsed } : {}), thisGame };
}

function modifiedAt(file: string): number {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
}
