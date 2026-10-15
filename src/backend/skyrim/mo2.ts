import fs from 'node:fs';
import path from 'node:path';
import { InstanceConfigError, type Instance, type ModEntry, type PluginEntry } from './modManager.js';

/**
 * What a Mod Organizer 2 instance says about itself, read from its own files. Nothing here writes.
 *
 * This server runs outside Mod Organizer, so it does not see the virtual `Data` folder a game
 * started through MO2 sees. It rebuilds the part it needs — which file each active plugin really
 * is — from the instance's settings, the active profile's mod order and load order, and the mods'
 * folders.
 */

/** The base game's own masters, always active and always first. */
const BASE_MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];

const PLUGIN_EXTENSIONS = new Set(['.esm', '.esp', '.esl']);

// ---------------------------------------------------------------- ini

/** Sections of a Qt-style ini, each a map of raw keys to decoded values. */
export function parseIni(text: string): Map<string, Map<string, string>> {
    const sections = new Map<string, Map<string, string>>();
    let current = new Map<string, string>();
    sections.set('', current);
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const section = /^\[(.+)\]$/.exec(line);
        if (section) {
            current = sections.get(section[1]) ?? new Map();
            sections.set(section[1], current);
            continue;
        }
        const eq = line.indexOf('=');
        if (eq > 0) current.set(line.slice(0, eq).trim(), decodeQtValue(line.slice(eq + 1).trim()));
    }
    return sections;
}

/**
 * A value as Qt writes it: optionally quoted, optionally wrapped in `@ByteArray(...)`, with
 * backslashes and quotes escaped — `@ByteArray(G:\\Steam\\Skyrim)` is `G:\Steam\Skyrim`.
 */
export function decodeQtValue(raw: string): string {
    let value = raw;
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    const byteArray = /^@ByteArray\((.*)\)$/.exec(value);
    if (byteArray) value = byteArray[1];
    return value.replace(/\\(["\\])/g, '$1');
}

// ---------------------------------------------------------------- instance

/** Turns a path as Mod Organizer wrote it into one this system opens; undefined when it cannot. */
export type IniPaths = (windowsPath: string) => string | undefined;

/**
 * The Wine prefix Mod Organizer runs in, under Proton: SKYRIM_WINE_PREFIX, else the one MO2-LINT set
 * this instance up in. Undefined when none is known — then only paths on Z:, the root, can be read.
 */
export function winePrefix(instanceDir: string, env: NodeJS.ProcessEnv, home: string): string | undefined {
    if (!env.SKYRIM_WINE_PREFIX) return mo2LintPrefix(instanceDir, home);
    // Proton keeps the prefix in a `pfx` folder inside the game's compatdata folder; either may be named.
    const named = path.resolve(env.SKYRIM_WINE_PREFIX);
    return fs.existsSync(path.join(named, 'pfx')) ? path.join(named, 'pfx') : named;
}

interface Mo2LintInstance {
    instance_path?: unknown;
    game_path?: unknown;
    launcher_ids?: { steam?: unknown };
}

/**
 * MO2-LINT lists the instances it installed in ~/.config/mo2-lint/state.json, each with its game's
 * folder and Steam app id, and sets Mod Organizer up in the game's own Proton prefix — which Steam
 * keeps in the game's library: `<library>/steamapps/common/<game>` → `<library>/steamapps/compatdata/<app id>/pfx`.
 * The file holds the user's Nexus API key too; nothing but `instances` is read.
 */
function mo2LintPrefix(instanceDir: string, home: string): string | undefined {
    let instances: Mo2LintInstance[];
    try {
        const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'mo2-lint', 'state.json'), 'utf8'));
        instances = Array.isArray(state?.instances) ? state.instances : [];
    } catch {
        return undefined;
    }
    const wanted = canonical(instanceDir);
    const entry = instances.find(instance => typeof instance?.instance_path === 'string' && canonical(instance.instance_path) === wanted);
    const appId = entry?.launcher_ids?.steam;
    if (typeof entry?.game_path !== 'string' || !appId) return undefined;
    const prefix = path.resolve(entry.game_path, '..', '..', 'compatdata', String(appId), 'pfx');
    return fs.existsSync(prefix) ? prefix : undefined;
}

/** A path by its real path where it exists — so a link to the instance is the instance. */
export function canonical(file: string): string {
    try {
        return fs.realpathSync(file);
    } catch {
        return path.resolve(file);
    }
}

/**
 * Reads the instance's ModOrganizer.ini. Throws InstanceConfigError with what to fix when the folder is
 * not an MO2 instance, manages another game, or points at a game folder that is not there.
 *
 * @param iniPaths  How the ini's paths are opened here: as they stand on Windows; under Proton, through
 *                  the Wine prefix's drives.
 */
export function readInstance(instanceDir: string, iniPaths: IniPaths = windowsPath => windowsPath): Instance {
    const iniPath = path.join(instanceDir, 'ModOrganizer.ini');
    if (!fs.existsSync(iniPath)) {
        throw new InstanceConfigError(
            `No ModOrganizer.ini in '${instanceDir}'. Set SKYRIM_MO2_INSTANCE to the folder that holds ` +
            `ModOrganizer.exe and ModOrganizer.ini.`);
    }
    const ini = parseIni(fs.readFileSync(iniPath, 'utf8'));
    const general = ini.get('General') ?? new Map<string, string>();
    const settings = ini.get('Settings') ?? new Map<string, string>();

    const gameName = general.get('gameName') ?? '';
    if (gameName !== 'Skyrim Special Edition') {
        throw new InstanceConfigError(
            `This MO2 instance manages '${gameName || 'no game'}', not Skyrim Special Edition. Point ` +
            `SKYRIM_MO2_INSTANCE at a Skyrim SE instance.`);
    }
    const native = (windowsPath: string): string => {
        const mapped = iniPaths(windowsPath);
        if (mapped === undefined) {
            throw new InstanceConfigError(
                `ModOrganizer.ini names '${windowsPath}', on a drive of the Wine prefix this server could not find. Set ` +
                `SKYRIM_WINE_PREFIX to the prefix Mod Organizer runs in — the folder with dosdevices in it.`);
        }
        return mapped;
    };
    const directorySetting = (key: string, base: string, fallback: string): string => {
        const value = settings.get(key);
        return value ? path.normalize(native(value).replace(/%BASE_DIR%/gi, base)) : fallback;
    };

    const gameDir = native(general.get('gamePath') ?? '');
    if (!gameDir || !fs.existsSync(path.join(gameDir, 'SkyrimSE.exe'))) {
        throw new InstanceConfigError(
            `The instance's game folder '${gameDir}' has no SkyrimSE.exe. Fix the game path in Mod ` +
            `Organizer (Settings > General) or in ModOrganizer.ini.`);
    }

    const edition = general.get('game_edition') ?? 'Steam';
    const baseDir = directorySetting('base_directory', instanceDir, instanceDir);
    const profilesDir = directorySetting('profiles_directory', baseDir, path.join(baseDir, 'profiles'));
    const profile = general.get('selected_profile') || 'Default';
    const profileDir = path.join(profilesDir, profile);
    if (!fs.existsSync(profileDir)) {
        throw new InstanceConfigError(
            `The selected profile '${profile}' has no folder at '${profileDir}'. Select an existing profile in Mod ` +
            `Organizer, or fix selected_profile in ModOrganizer.ini.`);
    }

    return {
        instanceDir,
        gameDir,
        edition,
        release: /gog/i.test(edition) ? 'SkyrimSEGog' : 'SkyrimSE',
        profile,
        profileDir,
        modsDir: directorySetting('mod_directory', baseDir, path.join(baseDir, 'mods')),
        overwriteDir: directorySetting('overwrite_directory', baseDir, path.join(baseDir, 'overwrite')),
        downloadsDir: directorySetting('download_directory', baseDir, path.join(baseDir, 'downloads'))
    };
}

// ---------------------------------------------------------------- mod order

/** modlist.txt, highest priority first — the order MO2 writes it in. */
export function parseModList(text: string): ModEntry[] {
    const mods: ModEntry[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const prefix = line[0];
        if (prefix !== '+' && prefix !== '-' && prefix !== '*') continue;
        mods.push({ name: line.slice(1), enabled: prefix !== '-', managed: prefix !== '*' });
    }
    return mods;
}

export function readModList(instance: Instance): ModEntry[] {
    const file = path.join(instance.profileDir, 'modlist.txt');
    return fs.existsSync(file) ? parseModList(fs.readFileSync(file, 'utf8')) : [];
}

// ---------------------------------------------------------------- load order

/**
 * The plugins the game loads, in load order, from the profile's loadorder.txt (MO2's complete order)
 * and plugins.txt (which ones are active). The base masters and the Creation Club plugins the game
 * activates itself are active whatever plugins.txt says, because the game never lists them there.
 */
export function readLoadOrder(instance: Instance): PluginEntry[] {
    const primary = primaryPlugins(instance.gameDir);
    const primarySet = new Set(primary.map(name => name.toLowerCase()));
    const active = activeInPluginsTxt(instance.profileDir);

    const loadOrderFile = path.join(instance.profileDir, 'loadorder.txt');
    const ordered = fs.existsSync(loadOrderFile)
        ? listLines(fs.readFileSync(loadOrderFile, 'utf8'))
        : [...primary, ...active.ordered];

    const seen = new Set<string>();
    const result: PluginEntry[] = [];
    for (const name of ordered) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ name, active: primarySet.has(key) || active.names.has(key) });
    }
    return result;
}

/** The base masters, then what the game's Skyrim.ccc lists, kept only where the file exists. */
export function primaryPlugins(gameDir: string): string[] {
    const ccc = path.join(gameDir, 'Skyrim.ccc');
    const creations = fs.existsSync(ccc) ? listLines(fs.readFileSync(ccc, 'utf8')) : [];
    // Skyrim.ccc and the files on disk need not agree on case (`ccBGSSSE001-Fish.esm`); the game does not care.
    let present: Set<string>;
    try {
        present = new Set(fs.readdirSync(path.join(gameDir, 'Data')).map(name => name.toLowerCase()));
    } catch {
        present = new Set();
    }
    return [...BASE_MASTERS, ...creations].filter(name => present.has(name.toLowerCase()));
}

function activeInPluginsTxt(profileDir: string): { names: Set<string>; ordered: string[] } {
    const file = path.join(profileDir, 'plugins.txt');
    // MO2 writes plugins.txt in the system codepage, not UTF-8; latin1 reads the Western one.
    const lines = fs.existsSync(file) ? listLines(fs.readFileSync(file, 'latin1')) : [];
    const ordered = lines.filter(line => line.startsWith('*')).map(line => line.slice(1));
    return { names: new Set(ordered.map(name => name.toLowerCase())), ordered };
}

function listLines(text: string): string[] {
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

// ---------------------------------------------------------------- the virtual Data folder

/**
 * Where each plugin file really is: the game's Data folder, overridden by enabled mods from lowest
 * to highest priority, overridden by the overwrite folder — the order Mod Organizer layers them in,
 * and Amethyst too. Keys are lower-case file names.
 *
 * @param dataDir  The game's own files: its Data folder, unless a mod manager moved them aside.
 */
export function resolvePluginFiles(
    instance: Instance, mods: readonly ModEntry[], dataDir = path.join(instance.gameDir, 'Data')
): Map<string, string> {
    const files = new Map<string, string>();
    const collect = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isFile() && PLUGIN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                files.set(entry.name.toLowerCase(), path.join(dir, entry.name));
            }
        }
    };

    collect(dataDir);
    for (const mod of [...mods].reverse()) {
        if (mod.enabled && mod.managed) collect(path.join(instance.modsDir, mod.name));
    }
    collect(instance.overwriteDir);
    return files;
}

/**
 * A cheap fingerprint of everything the active load order depends on. When it changes — another
 * profile selected, a mod enabled, plugins reordered — the load order has to be read again.
 */
export function loadOrderFingerprint(instanceDir: string, iniPaths?: IniPaths): string {
    const stamp = (file: string) => {
        try {
            return String(fs.statSync(file).mtimeMs);
        } catch {
            return '-';
        }
    };
    let profileDir = '';
    try {
        profileDir = readInstance(instanceDir, iniPaths).profileDir;
    } catch {
        // An unreadable instance gives a fingerprint of its own, and the next read reports why.
    }
    return [
        stamp(path.join(instanceDir, 'ModOrganizer.ini')),
        profileDir,
        ...['modlist.txt', 'loadorder.txt', 'plugins.txt'].map(name => stamp(path.join(profileDir, name)))
    ].join('|');
}
