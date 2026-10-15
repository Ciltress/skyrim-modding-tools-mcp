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

/**
 * Reads the instance's ModOrganizer.ini. Throws InstanceConfigError with what to fix when the folder is
 * not an MO2 instance, manages another game, or points at a game folder that is not there.
 */
export function readInstance(instanceDir: string): Instance {
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
    const gameDir = general.get('gamePath') ?? '';
    if (!gameDir || !fs.existsSync(path.join(gameDir, 'SkyrimSE.exe'))) {
        throw new InstanceConfigError(
            `The instance's game folder '${gameDir}' has no SkyrimSE.exe. Fix the game path in Mod ` +
            `Organizer (Settings > General) or in ModOrganizer.ini.`);
    }

    const edition = general.get('game_edition') ?? 'Steam';
    const baseDir = directorySetting(settings, 'base_directory', instanceDir, instanceDir);
    const profilesDir = directorySetting(settings, 'profiles_directory', baseDir, path.join(baseDir, 'profiles'));
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
        modsDir: directorySetting(settings, 'mod_directory', baseDir, path.join(baseDir, 'mods')),
        overwriteDir: directorySetting(settings, 'overwrite_directory', baseDir, path.join(baseDir, 'overwrite')),
        downloadsDir: directorySetting(settings, 'download_directory', baseDir, path.join(baseDir, 'downloads'))
    };
}

function directorySetting(settings: Map<string, string>, key: string, baseDir: string, fallback: string): string {
    const value = settings.get(key);
    return value ? path.normalize(value.replace(/%BASE_DIR%/gi, baseDir)) : fallback;
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
    const dataDir = path.join(gameDir, 'Data');
    return [...BASE_MASTERS, ...creations].filter(name => fs.existsSync(path.join(dataDir, name)));
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
 * to highest priority, overridden by the overwrite folder — the order Mod Organizer layers them in.
 * Keys are lower-case file names.
 */
export function resolvePluginFiles(instance: Instance, mods: readonly ModEntry[]): Map<string, string> {
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

    collect(path.join(instance.gameDir, 'Data'));
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
export function loadOrderFingerprint(instanceDir: string): string {
    const stamp = (file: string) => {
        try {
            return String(fs.statSync(file).mtimeMs);
        } catch {
            return '-';
        }
    };
    let profileDir = '';
    try {
        profileDir = readInstance(instanceDir).profileDir;
    } catch {
        // An unreadable instance gives a fingerprint of its own, and the next read reports why.
    }
    return [
        stamp(path.join(instanceDir, 'ModOrganizer.ini')),
        profileDir,
        ...['modlist.txt', 'loadorder.txt', 'plugins.txt'].map(name => stamp(path.join(profileDir, name)))
    ].join('|');
}
