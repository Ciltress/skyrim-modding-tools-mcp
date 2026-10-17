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

export type ModManagerName = 'mo2' | 'amethyst';

export type GameRelease = 'SkyrimSE' | 'SkyrimSEGog';

/**
 * A setting the instance gets wrong, or a file it lacks. Not latched as permanent: it is checked
 * again on every call, so fixing it in the mod manager takes effect without a restart.
 */
export class InstanceConfigError extends Error { }

/** One mod manager's setup for Skyrim, read from its own files. */
export interface Instance {
    /** The instance's own folder: MO2's, with ModOrganizer.ini in it; Amethyst's Skyrim staging folder. */
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
    /** False for the DLC and Creation Club entries MO2 lists but does not manage (MO2's `*`). */
    managed: boolean;
    /** Amethyst's `*`: a mod the user locked on, which cannot be disabled until it is unlocked. */
    locked?: boolean;
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

/** What enabling a mod changed in the selected profile. */
export interface ModEnabled {
    modEnabled: boolean;
    /** The plugins activated now; one active already is not listed. */
    activated: string[];
    /** The plugins new to the load order: at its end, or before a plugin that needs them. */
    addedToLoadOrder: string[];
}

/** What disabling a mod changed in the selected profile. */
export interface ModDisabled {
    modDisabled: boolean;
    /** The plugins the game loaded until now, taken out of the load order. */
    deactivated: string[];
}

/**
 * What a write does to the profile: `add` only adds — a new mod's line, new plugins; `change` changes
 * lines the mod manager already knows — a mod disabled.
 */
export type ProfileWrite = 'add' | 'change';

/** What the mod manager was told after a deploy, and what the user still has to do in it. */
export interface ModManagerNotice {
    manager: ModManagerName;
    /**
     * `notRunning`: nothing to tell. `refreshed`: Mod Organizer re-read its profile.
     * `otherInstanceRunning`: another instance's Mod Organizer runs; this one reads the profile when it starts.
     * `deployed`: Amethyst deployed the profile into the game. `deployManually`: the user has to finish it in
     * the mod manager — `nextStep` says how.
     */
    status: 'notRunning' | 'refreshed' | 'otherInstanceRunning' | 'deployed' | 'deployManually';
    nextStep?: string;
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
    /** The same for the files of one folder of Data with these extensions, `SKSE/Plugins` say. */
    resolveDataFiles(instance: Instance, mods: readonly ModEntry[], folder: string, extensions: ReadonlySet<string>): Map<string, string>;
    /** The Wine prefix the game runs in, under Proton — where its My Games folder is; undefined on Windows. */
    winePrefix(instance: Instance): string | undefined;
    /** Changes whenever the active load order may have: another profile, a mod or a plugin toggled. */
    fingerprint(): string;
    /**
     * Copies of a mod's plugin that the game would load instead of the mod's own — in the overwrite
     * folder, or a file saved over a deployed link in the game's Data. Highest first; they need not exist.
     */
    shadowingCopies(instance: Instance, mod: string, plugin: string): string[];
    /**
     * Why the profile must not be written now — a mod deployed, installed or disabled — with what the
     * user has to do first, or undefined when it may. Asked before anything is written.
     */
    writeRefusal(instance: Instance, write: ProfileWrite): Promise<string | undefined>;
    /**
     * Enables the mod and activates its plugins in the selected profile — a plugin new to the load order
     * at its end, in the order given, or before the plugin `before` names for it (by its lower-case name).
     */
    enable(instance: Instance, mod: string, plugins: readonly string[], before?: ReadonlyMap<string, string>): ModEnabled;
    /**
     * Disables the mod where it stands, and takes these plugins out of plugins.txt and loadorder.txt —
     * what the mod manager itself writes for a plugin no enabled mod has any more.
     */
    disable(instance: Instance, mod: string, plugins: readonly string[]): ModDisabled;
    /** Tells the mod manager what a deploy or an install changed, or says what the user has to do in it. */
    afterDeploy(instance: Instance): Promise<ModManagerNotice>;
    /** Remarks for healthcheck — something about the instance the user should know. */
    notes(instance: Instance): string[];
}
