import os from 'node:os';
import path from 'node:path';
import { loadOrderFingerprint, readInstance, readLoadOrder, readModList, resolveDataFiles, resolvePluginFiles, winePrefix, type IniPaths } from './mo2.js';
import { activatePlugins, enableMod, refreshIfRunning, runningMo2 } from './mo2Profile.js';
import type { Instance, ModEnabled, ModEntry, ModManager, ModManagerNotice, PluginEntry } from './modManager.js';
import type { Platform } from './platform.js';

/**
 * Mod Organizer 2 as the mod manager: an instance folder with its ModOrganizer.ini, read by mo2.ts
 * and changed by mo2Profile.ts. A running MO2 keeps the profile in memory, so a deploy is followed by
 * `ModOrganizer.exe refresh` when this instance's MO2 runs.
 *
 * Under Proton on Linux, the ini's paths are Windows paths into the Wine prefix MO2 runs in.
 */
export interface Mo2Options {
    /** SKYRIM_WINE_PREFIX, resolved (pathSettings.ts). */
    winePrefix?: string;
    home?: string;
}

export class Mo2Manager implements ModManager {
    readonly name = 'mo2' as const;
    private readonly namedPrefix?: string;
    private readonly home: string;

    /** @param location  The instance folder, with ModOrganizer.exe and ModOrganizer.ini in it. */
    constructor(readonly location: string, private readonly platform: Platform, options: Mo2Options = {}) {
        this.namedPrefix = options.winePrefix;
        this.home = options.home ?? os.homedir();
    }

    describe(): string {
        return `the Mod Organizer instance at ${this.location}`;
    }

    private iniPaths(): IniPaths {
        return this.platform.windowsPaths(winePrefix(this.location, this.namedPrefix, this.home));
    }

    readInstance(): Instance {
        return readInstance(this.location, this.iniPaths());
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

    resolveDataFiles(instance: Instance, mods: readonly ModEntry[], folder: string, extensions: ReadonlySet<string>): Map<string, string> {
        return resolveDataFiles(instance, mods, folder, extensions);
    }

    // Mod Organizer and the game it starts share the prefix.
    winePrefix(): string | undefined {
        return this.platform.runsWindowsPrograms ? undefined : winePrefix(this.location, this.namedPrefix, this.home);
    }

    fingerprint(): string {
        return loadOrderFingerprint(this.location, this.iniPaths());
    }

    // A plugin the Creation Kit saves anew lands in overwrite, which outranks every mod.
    shadowingCopies(instance: Instance, _mod: string, plugin: string): string[] {
        return [path.join(instance.overwriteDir, plugin)];
    }

    // Mod Organizer is a Windows program: on a system that runs none, it runs under Wine — Proton.
    notes(): string[] {
        if (this.platform.runsWindowsPrograms) return [];
        const prefix = winePrefix(this.location, this.namedPrefix, this.home);
        return [
            'Mod Organizer under Proton is experimental and unverified on a real setup. A deploy is refused while this ' +
            'instance\'s Mod Organizer runs, because it cannot be told to re-read its profile.',
            prefix
                ? `ModOrganizer.ini's Windows paths are read through the Wine prefix ${prefix}.`
                : 'No Wine prefix is known, so only ModOrganizer.ini paths on Z: (the root) can be read. If Mod Organizer ' +
                  'uses other drives, set SKYRIM_WINE_PREFIX to the prefix it runs in.'
        ];
    }

    // Mod Organizer writes the profile it holds back when it exits. Where it cannot be told to re-read
    // the files — under Proton — a deploy or an install into a running instance would be undone.
    async writeRefusal(instance: Instance): Promise<string | undefined> {
        if (this.platform.runsWindowsPrograms) return undefined;
        if (await runningMo2(instance, this.platform, this.iniPaths()) !== 'this') return undefined;
        return `Mod Organizer is running for this instance, and under Proton the server cannot tell it to re-read its ` +
            `profile: it would write its own over this change when it exits. Close it, then try again.`;
    }

    enable(instance: Instance, mod: string, plugins: readonly string[]): ModEnabled {
        const modEnabled = enableMod(instance, mod);
        return { modEnabled, ...activatePlugins(instance, plugins) };
    }

    async afterDeploy(instance: Instance): Promise<ModManagerNotice> {
        if (this.platform.runsWindowsPrograms) {
            return { manager: this.name, status: await refreshIfRunning(instance, this.platform, this.iniPaths()) };
        }
        // writeRefusal found none of this instance running a moment ago; one found now started during the deploy.
        const running = await runningMo2(instance, this.platform, this.iniPaths());
        if (running === 'this') {
            return {
                manager: this.name, status: 'deployManually',
                nextStep: 'Mod Organizer started during the deploy and may have read the profile before it changed: close it and start it again.'
            };
        }
        return { manager: this.name, status: running === 'none' ? 'notRunning' : 'otherInstanceRunning' };
    }
}
