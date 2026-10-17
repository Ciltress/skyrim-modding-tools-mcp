import fs from 'node:fs';
import path from 'node:path';
import { parseIni, PLUGIN_EXTENSIONS } from './mo2.js';
import type { Instance, ModManager } from './modManager.js';
import { findCaseInsensitive } from './paths.js';
import type { ListedMod, ListedPlugin, ModList, ModListQuery } from './SkyrimBackend.js';

/**
 * The selected profile's mods as the user sees them in the mod manager: lowest priority first, a
 * separator's name on the mods under it, each mod's plugins marked by whether the game loads that copy,
 * and what the manager recorded when it installed the mod from Nexus Mods — both managers keep MO2's
 * meta.ini. Read from the files alone: no helper, no network.
 */
export function listedMods(manager: ModManager, instance: Instance, query: ModListQuery): ModList {
    // modlist.txt is written highest priority first; DLC and Creation Club entries (MO2's `*`) are no mods.
    const entries = manager.readModList(instance).filter(mod => mod.managed);
    const loadOrder = new Map(manager.readLoadOrder(instance).map(plugin => [plugin.name.toLowerCase(), plugin.active]));
    const loaded = manager.resolvePluginFiles(instance, entries);
    const isSeparator = (name: string) => /_separator$/i.test(name);

    const all: ListedMod[] = [];
    let section: string | undefined;
    [...entries].reverse().forEach((entry, priority) => {
        if (isSeparator(entry.name)) {
            section = entry.name.replace(/_separator$/i, '');
            return;
        }
        const dir = path.join(instance.modsDir, entry.name);
        const plugins = query.details ? pluginFiles(dir).map(name => plugin(name, entry.enabled, dir, loaded, loadOrder, instance)) : [];
        const nexus = nexusRecord(dir);
        all.push({
            name: entry.name, enabled: entry.enabled, priority,
            ...(section ? { section } : {}),
            ...(plugins.length > 0 ? { plugins } : {}),
            // The modId always — what readNexusMod takes; the rest is for the questions details answer.
            ...(nexus ? { nexus: query.details ? nexus : { modId: nexus.modId } } : {}),
            ...(hasSksePlugins(dir) ? { skse: true as const } : {})
        });
    });

    const text = query.text?.trim().toLowerCase();
    const matched = all.filter(mod => (!text || mod.name.toLowerCase().includes(text)) && (!query.enabledOnly || mod.enabled));
    // A list put together by Wabbajack has thousands of mods — LoreRim's ~4,000 came to 1.1 MB with details.
    const offset = query.offset ?? 0;
    const mods = matched.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
    const after = matched.length - offset - mods.length;
    return {
        modManager: manager.name,
        profile: instance.profile,
        order: 'Lowest priority first, as Mod Organizer shows them: of two mods with the same file, the one listed later wins.',
        total: matched.length,
        enabled: matched.filter(mod => mod.enabled).length,
        mods,
        ...(after > 0 ? { next: `${after} more: call again with offset: ${offset + mods.length}.` } : {}),
        ...(matched.length === 0 && all.length > 0
            ? { note: `No ${query.enabledOnly ? 'enabled ' : ''}mod's name holds '${query.text ?? ''}' — ${all.length} mods in all. ` +
                'Leave out text to list them.' }
            : {})
    };
}

function plugin(name: string, enabled: boolean, dir: string, loaded: Map<string, string>, loadOrder: Map<string, boolean>, instance: Instance): ListedPlugin {
    const winner = enabled ? loaded.get(name.toLowerCase()) : undefined;
    if (!winner) return { name, active: false };
    if (samePath(path.dirname(winner), dir)) return { name, active: loadOrder.get(name.toLowerCase()) ?? false };
    return { name, active: false, loadedFrom: ownerOf(winner, instance) };
}

/** Who provides a file the game loads: a mod by its name, overwrite, or the game itself. */
function ownerOf(file: string, instance: Instance): string {
    const dir = path.dirname(file);
    if (samePath(dir, instance.overwriteDir)) return 'overwrite';
    if (samePath(path.dirname(dir), instance.modsDir)) return path.basename(dir);
    return 'the game\'s Data folder';
}

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function pluginFiles(dir: string): string[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isFile() && PLUGIN_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

/** The mod's Nexus record from its meta.ini: the mod and file it was installed from, and their version. */
function nexusRecord(dir: string): ListedMod['nexus'] {
    const file = findCaseInsensitive(dir, 'meta.ini');
    if (!file) return undefined;
    let ini;
    try {
        ini = parseIni(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
    const general = ini.get('General');
    const modId = Number(general?.get('modid'));
    if (!Number.isInteger(modId) || modId <= 0) return undefined;
    const fileId = Number(ini.get('installedFiles')?.get('1\\fileid'));
    const version = general?.get('version')?.trim();
    const installed = general?.get('installationFile')?.split(/[\\/]/).pop()?.trim();
    return {
        modId,
        ...(Number.isInteger(fileId) && fileId > 0 ? { fileId } : {}),
        ...(version ? { version } : {}),
        ...(installed ? { file: installed } : {})
    };
}

function hasSksePlugins(dir: string): boolean {
    const plugins = findCaseInsensitive(dir, 'SKSE/Plugins');
    if (!plugins) return false;
    try {
        return fs.readdirSync(plugins).some(name => name.toLowerCase().endsWith('.dll'));
    } catch {
        return false;
    }
}
