import path from 'node:path';
import { loadOrderFingerprint, readInstance, readLoadOrder, readModList, resolvePluginFiles } from './mo2.js';
import { activatePlugin, enableMod, refreshIfRunning } from './mo2Profile.js';
import type { Instance, ModEntry, ModManager, ModManagerNotice, PluginEntry, ProfileChange } from './modManager.js';
import type { Platform } from './platform.js';

/**
 * Mod Organizer 2 as the mod manager: an instance folder with its ModOrganizer.ini, read by mo2.ts
 * and changed by mo2Profile.ts. A running MO2 keeps the profile in memory, so a deploy is followed by
 * `ModOrganizer.exe refresh` when this instance's MO2 runs.
 */
export class Mo2Manager implements ModManager {
    readonly name = 'mo2' as const;

    /** @param location  The instance folder, with ModOrganizer.exe and ModOrganizer.ini in it. */
    constructor(readonly location: string, private readonly platform: Platform) { }

    describe(): string {
        return `the Mod Organizer instance at ${this.location}`;
    }

    readInstance(): Instance {
        return readInstance(this.location);
    }

    readModList(instance: Instance): ModEntry[] {
        return readModList(instance);
    }

    readLoadOrder(instance: Instance): PluginEntry[] {
        return readLoadOrder(instance);
    }

    resolvePluginFiles(instance: Instance, mods: readonly ModEntry[]): Map<string, string> {
        return resolvePluginFiles(instance, mods);
    }

    fingerprint(): string {
        return loadOrderFingerprint(this.location);
    }

    // A plugin the Creation Kit saves anew lands in overwrite, which outranks every mod.
    shadowingCopies(instance: Instance, plugin: string): string[] {
        return [path.join(instance.overwriteDir, plugin)];
    }

    enable(instance: Instance, mod: string, plugin: string): ProfileChange {
        const modEnabled = enableMod(instance, mod);
        return { modEnabled, ...activatePlugin(instance, plugin) };
    }

    async afterDeploy(instance: Instance): Promise<ModManagerNotice> {
        return { manager: this.name, status: await refreshIfRunning(instance, this.platform) };
    }
}
