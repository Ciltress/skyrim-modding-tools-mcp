import path from 'node:path';
import { parseList } from '../lib/env.js';
import { PROJECT_ROOT, SERVER_INFO } from '../lib/serverInfo.js';
import { AmethystManager, findAmethyst } from './skyrim/amethyst.js';
import { SkyrimEngine } from './skyrim/engine.js';
import { HelperClient } from './skyrim/helperClient.js';
import { Mo2Manager } from './skyrim/mo2Manager.js';
import { NexusCatalogue } from './skyrim/nexus.js';
import type { ModManager, ModManagerName } from './skyrim/modManager.js';
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

/** SKYRIM_MOD_MANAGER: `mo2` unless set. Throws on a name this server does not know. */
export function modManagerName(env: NodeJS.ProcessEnv): ModManagerName {
    const name = String(env.SKYRIM_MOD_MANAGER || 'mo2').trim().toLowerCase();
    if (!(MOD_MANAGERS as readonly string[]).includes(name)) {
        throw new Error(`SKYRIM_MOD_MANAGER='${env.SKYRIM_MOD_MANAGER}' is not a mod manager this server knows: use ${MOD_MANAGERS.join(' or ')}.`);
    }
    return name as ModManagerName;
}

/** The variables this configuration lacks: the always-required ones, and what its mod manager needs. */
export function missingEnv(env: NodeJS.ProcessEnv): string[] {
    const missing = REQUIRED_ENV.filter(name => !env[name]);
    if (modManagerName(env) === 'mo2' && !env.SKYRIM_MO2_INSTANCE) missing.push('SKYRIM_MO2_INSTANCE');
    return missing;
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
}

/** The mod manager the configuration names (docs/adr/0007) — never inferred from the operating system. */
function createModManager(env: NodeJS.ProcessEnv, platform: Platform): ModManager {
    return modManagerName(env) === 'amethyst'
        ? new AmethystManager(findAmethyst(env))
        : new Mo2Manager(String(env.SKYRIM_MO2_INSTANCE ?? ''), platform, { env });
}

/** One engine per process — one helper, one load order — shared by every HTTP session. */
let sharedEngine: SkyrimEngine | undefined;

/** One Nexus catalogue per process too, so the key is checked once, not once per session. */
let sharedNexus: { apiKey: string | undefined; catalogue: NexusCatalogue } | undefined;

/** Builds the backend for one server: per process, or per session in HTTP mode. Starts nothing: the helper starts on connect(). */
export function createBackend(env: NodeJS.ProcessEnv = process.env, options: BackendOptions = {}): AppBackend {
    // The one place the server asks which operating system it runs on (docs/adr/0007).
    const platform = currentPlatform();
    const modManager = createModManager(env, platform);
    const projectsDir = path.resolve(PROJECT_ROOT, env.SKYRIM_PROJECTS_DIR || DEFAULT_PROJECTS_DIR);
    const current = sharedEngine?.modManager;
    if (current?.name !== modManager.name || current.location !== modManager.location || sharedEngine?.projectsDir !== projectsDir) {
        sharedEngine?.stop();
        sharedEngine = new SkyrimEngine(
            modManager,
            new HelperClient(env.SKYRIM_HELPER_PATH || defaultHelperPath(platform)),
            projectsDir,
            {
                platform,
                creationKitDir: env.SKYRIM_CK_DIR || undefined,
                papyrusCompiler: env.SKYRIM_PAPYRUS_COMPILER || undefined
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
