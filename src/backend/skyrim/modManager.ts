/**
 * The seam between the server and the program that keeps the user's mods (docs/adr/0007): Mod
 * Organizer 2, on Windows or under Proton, or Amethyst on Linux. Chosen by configuration, never by
 * the operating system.
 *
 * Every mod manager here keeps the same shape — an instance with a game folder, mod folders, an
 * overwrite folder and profiles of MO2-style text files — so the tools work the same against each.
 * What differs is where the settings are, what the profile files mean in detail, and how the manager
 * learns that something changed.
 */

export type ModManagerName = 'mo2';

export type GameRelease = 'SkyrimSE' | 'SkyrimSEGog';

/**
 * A setting the instance gets wrong, or a file it lacks. Not latched as permanent: it is checked
 * again on every call, so fixing it in the mod manager takes effect without a restart.
 */
export class InstanceConfigError extends Error { }

/** One mod manager's setup for Skyrim, read from its own files. */
export interface Instance {
    /** The instance's own folder: MO2's, with ModOrganizer.ini in it. */
    instanceDir: string;
    /** The game folder — `SkyrimSE.exe` and `Data` are in it. */
    gameDir: string;
    /** The store edition: Steam, GOG, Epic Games… */
    edition: string;
    release: GameRelease;
    /** The profile the mod manager has selected — the server follows it. */
    profile: string;
    profileDir: string;
    modsDir: string;
    overwriteDir: string;
    downloadsDir: string;
}

/** One line of a profile's modlist.txt. */
export interface ModEntry {
    name: string;
    enabled: boolean;
    /** False for the DLC and Creation Club entries MO2 lists but does not manage (`*`). */
    managed: boolean;
}

export interface PluginEntry {
    name: string;
    active: boolean;
}

/** What deploy changed in the selected profile. */
export interface ProfileChange {
    modEnabled: boolean;
    pluginActive: boolean;
    addedToLoadOrder: boolean;
}

/** What the mod manager was told after a deploy. */
export interface ModManagerNotice {
    manager: ModManagerName;
    /**
     * `notRunning`: nothing to tell. `refreshed`: Mod Organizer re-read its profile.
     * `otherInstanceRunning`: another instance's Mod Organizer runs; this one reads the profile when it starts.
     */
    status: 'notRunning' | 'refreshed' | 'otherInstanceRunning';
}

export interface ModManager {
    readonly name: ModManagerName;
    /** Where the instance is: for messages, and to tell one binding from another. */
    readonly location: string;
    /** "the Mod Organizer instance at …" — what the server says it is bound to. */
    describe(): string;
    /** The instance as its files say now. Throws InstanceConfigError with what to fix. */
    readInstance(): Instance;
    /** The selected profile's mods, highest priority first. */
    readModList(instance: Instance): ModEntry[];
    /** The plugins the game loads, in load order. */
    readLoadOrder(instance: Instance): PluginEntry[];
    /** Where each plugin file really is, the way the game will see it. Keys are lower-case file names. */
    resolvePluginFiles(instance: Instance, mods: readonly ModEntry[]): Map<string, string>;
    /** Changes whenever the active load order may have: another profile, a mod or a plugin toggled. */
    fingerprint(): string;
    /**
     * Copies of a mod's plugin that the game would load instead of the mod's own — Mod Organizer's
     * overwrite folder. Highest first; they need not exist.
     */
    shadowingCopies(instance: Instance, plugin: string): string[];
    /** Enables the mod and activates its plugin in the selected profile. */
    enable(instance: Instance, mod: string, plugin: string): ProfileChange;
    /** Tells the mod manager what a deploy changed. */
    afterDeploy(instance: Instance): Promise<ModManagerNotice>;
}
