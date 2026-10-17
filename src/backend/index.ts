import os from 'node:os';
import path from 'node:path';
import { parseList } from '../lib/env.js';
import { PROJECT_ROOT, SERVER_INFO } from '../lib/serverInfo.js';
import { AmethystManager, amethystHasSkyrim, findAmethyst } from './skyrim/amethyst.js';
import { SkyrimEngine } from './skyrim/engine.js';
import { HelperClient } from './skyrim/helperClient.js';
import { Mo2Manager } from './skyrim/mo2Manager.js';
import { NexusCatalogue } from './skyrim/nexus.js';
import type { ModManager, ModManagerName } from './skyrim/modManager.js';
import { readPathSettings, settingGiven, type PathSettings } from './skyrim/pathSettings.js';
import { SkyrimInstanceBackend } from './skyrim/SkyrimInstanceBackend.js';
import { currentPlatform, type Platform } from './skyrim/platform.js';
import type { SkyrimBackend } from './skyrim/SkyrimBackend.js';

export type { Backend, HealthReport } from './Backend.js';
export { PermanentBackendError, SessionExpiredError, isPermanent } from './Backend.js';
export type * from './skyrim/SkyrimBackend.js';

/** The backend every handler is written against. */
export type AppBackend = SkyrimBackend;

/**
 * The environment variables this server refuses to start without, whatever the mod manager. server.json
 * marks exactly these `isRequired`, and serverManifest.test.ts holds the two together. What a mod
 * manager needs on top — SKYRIM_MO2_INSTANCE for Mod Organizer — missingEnv() checks.
 */
export const REQUIRED_ENV: readonly string[] = [];

const MOD_MANAGERS: readonly ModManagerName[] = ['mo2', 'amethyst'];

export interface ModManagerChoice {
    name: ModManagerName;
    /** Why, when SKYRIM_MOD_MANAGER did not name it. */
    because?: string;
}

/**
 * The mod manager (docs/adr/0007): SKYRIM_MOD_MANAGER when set; else what is configured — Mod Organizer
 * when an instance is named, Amethyst when its folder is named or it has Skyrim set up — and else Mod
 * Organizer, whose missing instance missingEnv() names. Never inferred from the operating system: a
 * modder should not have to type what the machine already says. Throws on a name this server does not know.
 */
export function chooseModManager(env: NodeJS.ProcessEnv, home = os.homedir()): ModManagerChoice {
    if (env.SKYRIM_MOD_MANAGER?.trim()) {
        const name = env.SKYRIM_MOD_MANAGER.trim().toLowerCase();
        if (!(MOD_MANAGERS as readonly string[]).includes(name)) {
            throw new Error(`SKYRIM_MOD_MANAGER='${env.SKYRIM_MOD_MANAGER}' is not a mod manager this server knows: use ${MOD_MANAGERS.join(' or ')}.`);
        }
        return { name: name as ModManagerName };
    }
    if (settingGiven(env, 'SKYRIM_MO2_INSTANCE')) return { name: 'mo2', because: 'SKYRIM_MO2_INSTANCE names its instance' };
    if (settingGiven(env, 'SKYRIM_AMETHYST_DIR')) return { name: 'amethyst', because: 'SKYRIM_AMETHYST_DIR names its config folder' };
    if (amethystHasSkyrim(env, home)) return { name: 'amethyst', because: 'its config has Skyrim Special Edition set up' };
    return { name: 'mo2' };
}

export function modManagerName(env: NodeJS.ProcessEnv, home = os.homedir()): ModManagerName {
    return chooseModManager(env, home).name;
}

/** The variables this configuration lacks: the always-required ones, and what its mod manager needs. */
export function missingEnv(env: NodeJS.ProcessEnv, home = os.homedir()): string[] {
    const missing = REQUIRED_ENV.filter(name => !env[name]);
    if (modManagerName(env, home) === 'mo2' && !settingGiven(env, 'SKYRIM_MO2_INSTANCE')) missing.push('SKYRIM_MO2_INSTANCE');
    return missing;
}

/** What each missing variable is to hold — said at startup, after their names. */
export function explainMissingEnv(missing: readonly string[]): string {
    return missing.map(name => name === 'SKYRIM_MO2_INSTANCE'
        ? 'Set SKYRIM_MO2_INSTANCE to the Mod Organizer instance folder, the one with ModOrganizer.ini in it — or, ' +
          'with Amethyst, set Skyrim Special Edition up in Amethyst, and the server finds it'
        : `Set ${name}`).join('; ') + '.';
}

/** Where `npm run build:helper` puts the helper on this system. */
export function defaultHelperPath(platform: Platform): string {
    return path.join(PROJECT_ROOT, 'helper', 'bin', platform.helperFileName);
}

/** Where projects live unless SKYRIM_PROJECTS_DIR says otherwise. */
export const DEFAULT_PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');

export interface BackendOptions {
    /**
     * The caller's own bearer token, in HTTP mode. Undefined in stdio mode, where the process belongs
     * to whoever started it.
     */
    bearerToken?: string;
    /** The home folder: os.homedir() unless a test lays one out. */
    home?: string;
}

/** The mod manager chooseModManager() picks. */
function createModManager(env: NodeJS.ProcessEnv, paths: PathSettings, platform: Platform, home: string): ModManager {
    const choice = chooseModManager(env, home);
    return choice.name === 'amethyst'
        ? new AmethystManager(findAmethyst(paths.SKYRIM_AMETHYST_DIR, env, home),
            { env, home, chosenBecause: choice.because })
        : new Mo2Manager(paths.SKYRIM_MO2_INSTANCE ?? '', platform, { winePrefix: paths.SKYRIM_WINE_PREFIX, home });
}

/** One engine per process — one helper, one load order — shared by every HTTP session. */
let sharedEngine: SkyrimEngine | undefined;

/** One Nexus catalogue per process too, so the key is checked once, not once per session. */
let sharedNexus: { apiKey: string | undefined; catalogue: NexusCatalogue } | undefined;

/** What a configuration comes to: the system, every path setting resolved, the mod manager chosen. */
export interface Configuration {
    platform: Platform;
    home: string;
    paths: PathSettings;
    modManager: ModManager;
    /** Where a Papyrus compiler is looked for without SKYRIM_PAPYRUS_COMPILER: none on Windows. */
    papyrusCompilerCandidates: string[];
}

/**
 * Reads a configuration as the server does — also for `npm run setup`, which finds what the server
 * will find. Throws on a path setting that cannot be read or a mod manager this server does not know.
 */
export function readConfiguration(env: NodeJS.ProcessEnv, options: { home?: string } = {}): Configuration {
    // The one place the server asks which operating system it runs on (docs/adr/0007).
    const platform = currentPlatform();
    const home = options.home ?? os.homedir();
    // Relative paths are the server's folder's, where .env is — not whichever folder a client started it in.
    const paths = readPathSettings(env, { platform, home, base: PROJECT_ROOT });
    return {
        platform, home, paths,
        modManager: createModManager(env, paths, platform, home),
        papyrusCompilerCandidates: platform.papyrusCompilerCandidates(env.PATH, home, PROJECT_ROOT)
    };
}

/** Builds the backend for one server: per process, or per session in HTTP mode. Starts nothing: the helper starts on connect(). */
export function createBackend(env: NodeJS.ProcessEnv = process.env, options: BackendOptions = {}): AppBackend {
    const { platform, paths, modManager, papyrusCompilerCandidates } = readConfiguration(env, options);
    const projectsDir = paths.SKYRIM_PROJECTS_DIR ?? DEFAULT_PROJECTS_DIR;
    const current = sharedEngine?.modManager;
    if (current?.name !== modManager.name || current.location !== modManager.location || sharedEngine?.projectsDir !== projectsDir) {
        sharedEngine?.stop();
        sharedEngine = new SkyrimEngine(
            modManager,
            new HelperClient(paths.SKYRIM_HELPER_PATH ?? defaultHelperPath(platform)),
            projectsDir,
            {
                platform,
                creationKitDir: paths.SKYRIM_CK_DIR,
                papyrusCompiler: paths.SKYRIM_PAPYRUS_COMPILER,
                papyrusCompilerCandidates
            }
        );
    }
    const apiKey = env.NEXUS_API_KEY?.trim() || undefined;
    if (!sharedNexus || sharedNexus.apiKey !== apiKey) {
        sharedNexus = { apiKey, catalogue: new NexusCatalogue({ appVersion: SERVER_INFO.version, apiKey }) };
    }
    return new SkyrimInstanceBackend({
        engine: sharedEngine!,
        nexus: sharedNexus.catalogue,
        credential: options.bearerToken,
        // Only HTTP sessions present a credential, so only they are checked.
        acceptedCredentials: options.bearerToken !== undefined
            ? parseList(env.SKYRIM_ACCEPTED_TOKENS)
            : undefined
    });
}
