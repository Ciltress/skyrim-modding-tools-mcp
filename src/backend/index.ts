import path from 'node:path';
import { parseList } from '../lib/env.js';
import { PROJECT_ROOT } from '../lib/serverInfo.js';
import { SkyrimEngine } from './skyrim/engine.js';
import { HelperClient } from './skyrim/helperClient.js';
import { Mo2SkyrimBackend } from './skyrim/Mo2SkyrimBackend.js';
import type { SkyrimBackend } from './skyrim/SkyrimBackend.js';

export type { Backend, HealthReport } from './Backend.js';
export { PermanentBackendError, SessionExpiredError, isPermanent } from './Backend.js';
export type * from './skyrim/SkyrimBackend.js';

/** The backend every handler is written against. */
export type AppBackend = SkyrimBackend;

/**
 * The environment variables this server refuses to start without. server.json marks exactly these
 * `isRequired`, and serverManifest.test.ts holds the two together.
 */
export const REQUIRED_ENV: readonly string[] = ['SKYRIM_MO2_INSTANCE'];

/** Where `npm run build:helper` puts the helper. */
export const DEFAULT_HELPER_PATH = path.join(PROJECT_ROOT, 'helper', 'bin', 'SkyrimHelper.exe');

/** Where projects live unless SKYRIM_PROJECTS_DIR says otherwise. */
export const DEFAULT_PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');

export interface BackendOptions {
    /**
     * The caller's own bearer token, in HTTP mode. Undefined in stdio mode, where the process belongs
     * to whoever started it.
     */
    bearerToken?: string;
}

/** One engine per process — one helper, one load order — shared by every HTTP session. */
let sharedEngine: SkyrimEngine | undefined;

/** Builds the backend for one server: per process, or per session in HTTP mode. Starts nothing: the helper starts on connect(). */
export function createBackend(env: NodeJS.ProcessEnv = process.env, options: BackendOptions = {}): AppBackend {
    const instanceDir = String(env.SKYRIM_MO2_INSTANCE ?? '');
    const projectsDir = path.resolve(PROJECT_ROOT, env.SKYRIM_PROJECTS_DIR || DEFAULT_PROJECTS_DIR);
    if (sharedEngine?.instanceDir !== instanceDir || sharedEngine.projectsDir !== projectsDir) {
        sharedEngine?.stop();
        sharedEngine = new SkyrimEngine(
            instanceDir,
            new HelperClient(env.SKYRIM_HELPER_PATH || DEFAULT_HELPER_PATH),
            projectsDir,
            env.SKYRIM_CK_DIR || undefined
        );
    }
    return new Mo2SkyrimBackend({
        engine: sharedEngine,
        credential: options.bearerToken,
        // Only HTTP sessions present a credential, so only they are checked.
        acceptedCredentials: options.bearerToken !== undefined
            ? parseList(env.SKYRIM_ACCEPTED_TOKENS)
            : undefined
    });
}
