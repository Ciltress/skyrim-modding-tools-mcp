import fs from 'node:fs';
import path from 'node:path';
import type { HelperTransport } from './helperClient.js';
import type { Instance, ModManager } from './modManager.js';
import { createLogger } from '../../lib/logger.js';
import { currentPlatform, type Platform } from './platform.js';

/** The helper protocol this server speaks; a helper announcing another one is a stale build. */
const HELPER_PROTOCOL = 1;

export interface EngineOptions {
    /** The operating system's side; currentPlatform() unless a test passes another. */
    platform?: Platform;
    /** Where the Creation Kit is; undefined means the instance's game folder, where Steam installs it. */
    creationKitDir?: string;
    /** SKYRIM_PAPYRUS_COMPILER. */
    papyrusCompiler?: string;
    /** Where a compiler is looked for when SKYRIM_PAPYRUS_COMPILER names none (Platform.papyrusCompilerCandidates). */
    papyrusCompilerCandidates?: readonly string[];
}

/**
 * One instance and the helper process that reads its plugins — shared by every backend in the
 * process, because each HTTP session gets its own backend, and a helper per session would each
 * spend seconds indexing the same load order.
 *
 * It keeps the helper's load order in step with the mod manager: before each call it compares a
 * fingerprint of the instance's settings and the active profile's files, and hands the helper a
 * fresh load order when another profile was selected or a mod or plugin changed.
 */
export class SkyrimEngine {
    private readonly logger = createLogger('SkyrimEngine');
    private connecting?: Promise<void>;
    private fingerprint?: string;

    instance?: Instance;
    /** Why the last attempt to start failed — cleared by the next one that succeeds. */
    startError?: string;
    gameVersion?: string;
    helperVersion?: string;
    activePlugins = 0;
    /** Active plugins with no file in the game, any enabled mod, or overwrite. */
    missingPlugins: string[] = [];

    readonly platform: Platform;
    /** The Papyrus compiler SKYRIM_PAPYRUS_COMPILER names; undefined means the platform's default. */
    readonly papyrusCompiler?: string;
    readonly papyrusCompilerCandidates: readonly string[];
    private readonly creationKitOverride?: string;

    /**
     * @param modManager   The mod manager that keeps the instance.
     * @param projectsDir  Where projects live.
     */
    constructor(
        readonly modManager: ModManager,
        readonly helper: HelperTransport,
        readonly projectsDir: string,
        options: EngineOptions = {}
    ) {
        this.platform = options.platform ?? currentPlatform();
        this.papyrusCompiler = options.papyrusCompiler;
        this.papyrusCompilerCandidates = options.papyrusCompilerCandidates ?? [];
        this.creationKitOverride = options.creationKitDir;
    }

    get creationKitDir(): string {
        return this.creationKitOverride || this.modManager.readInstance().gameDir;
    }

    get ready(): boolean {
        return this.helper.running && this.fingerprint !== undefined;
    }

    /** Starts the helper and hands it the load order. Concurrent callers share one attempt. */
    connect(): Promise<void> {
        this.connecting ??= this.doConnect()
            .then(() => { this.startError = undefined; }, error => {
                this.startError = (error as Error).message;
                throw error;
            })
            .finally(() => { this.connecting = undefined; });
        return this.connecting;
    }

    private async doConnect(): Promise<void> {
        this.instance = this.modManager.readInstance();
        if (!this.helper.running) {
            this.fingerprint = undefined;
            await this.helper.start();
            const hello = await this.helper.call<{ helper: string; protocol: number }>('hello');
            if (hello.protocol !== HELPER_PROTOCOL) {
                throw new Error(
                    `The plugin helper speaks protocol ${hello.protocol}, this server ${HELPER_PROTOCOL}: rebuild it ` +
                    `with 'npm run build:helper'.`);
            }
            this.helperVersion = hello.helper;
            // Null when the exe carries no version: the header then follows the newest game (headerVersion).
            this.gameVersion = (await this.helper.call<{ version: string | null }>('gameVersion', {
                exePath: path.join(this.instance.gameDir, 'SkyrimSE.exe')
            })).version ?? undefined;
        }
        await this.syncLoadOrder();
    }

    /**
     * Starts connecting without waiting, so the helper indexes the load order while the agent is
     * still reading. A failure is only logged here: the first call that needs the engine connects
     * again and reports it with its real cause.
     */
    warmUp(): void {
        this.connect().catch(error => this.logger.warn('could not start on warm-up; the first tool call will retry', {
            error: (error as Error).message
        }));
    }

    /**
     * Called before every call that reads plugins: (re)starts the helper when it is not running —
     * after a crash, or a warm-up that failed — and re-reads the load order when MO2's changed.
     */
    async ensureFresh(): Promise<void> {
        if (!this.helper.running || this.fingerprint === undefined) await this.connect();
        else if (this.currentFingerprint() !== this.fingerprint) await this.syncLoadOrder();
    }

    /** Plugin files the helper read into memory: when one changes on disk, its copy is stale. */
    private editablePlugins: string[] = [];

    /**
     * The profile's files, plus the size and time of every editable plugin — so a plugin saved in the
     * Creation Kit or xEdit, or replaced by a deploy, is read again before the next answer.
     */
    private currentFingerprint(): string {
        const stamps = this.editablePlugins.map(file => {
            try {
                const stat = fs.statSync(file);
                return `${stat.size}:${stat.mtimeMs}`;
            } catch {
                return '-';
            }
        });
        return `${this.modManager.fingerprint()}|${stamps.join(',')}`;
    }

    private async syncLoadOrder(): Promise<void> {
        const instance = this.modManager.readInstance();
        const files = this.modManager.resolvePluginFiles(instance, this.modManager.readModList(instance));
        const active = this.modManager.readLoadOrder(instance).filter(plugin => plugin.active);
        // The game's own folders: Data, and Data_Core where Amethyst moves the game's files while deployed.
        const gameFolders = ['Data', 'Data_Core'].map(folder => path.join(instance.gameDir, folder).toLowerCase() + path.sep);

        const plugins = active.map(plugin => {
            const file = files.get(plugin.name.toLowerCase());
            // Plugins outside the game's own folders are the editable ones: the helper keeps no handle on them.
            const own = !!file && gameFolders.some(folder => file.toLowerCase().startsWith(folder));
            return { name: plugin.name, path: file, inMemory: !!file && !own };
        });
        this.editablePlugins = plugins.filter(p => p.inMemory).map(p => p.path!);
        const fingerprint = this.currentFingerprint();
        const answer = await this.helper.call<{ plugins: number; missing: string[] }>('setLoadOrder', {
            release: instance.release,
            plugins
        });

        this.instance = instance;
        this.activePlugins = answer.plugins;
        this.missingPlugins = answer.missing;
        this.fingerprint = fingerprint;
        this.logger.info('load order handed to the helper', {
            profile: instance.profile, plugins: answer.plugins, missing: answer.missing.length
        });
    }

    /** Header version a new plugin needs for this game: 1.71 from 1.6.1130 on, 1.70 before. */
    get headerVersion(): number {
        const [major = 0, minor = 0, build = 0] = (this.gameVersion ?? '1.7.0').split('.').map(Number);
        const atLeast1130 = major > 1 || (major === 1 && (minor > 6 || (minor === 6 && build >= 1130)));
        return atLeast1130 ? 1.71 : 1.7;
    }

    stop(): void {
        this.helper.stop();
        this.fingerprint = undefined;
    }
}
