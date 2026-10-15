import fs from 'node:fs';
import path from 'node:path';
import type { HelperTransport } from './helperClient.js';
import {
    loadOrderFingerprint, readInstance, readLoadOrder, readModList, resolvePluginFiles,
    type Mo2Instance
} from './mo2.js';
import { createLogger } from '../../lib/logger.js';

/** The helper protocol this server speaks; a helper announcing another one is a stale build. */
const HELPER_PROTOCOL = 1;

/**
 * One MO2 instance and the helper process that reads its plugins — shared by every backend in the
 * process, because each HTTP session gets its own backend, and a helper per session would each
 * spend seconds indexing the same load order.
 *
 * It keeps the helper's load order in step with Mod Organizer: before each call it compares a
 * fingerprint of the instance's settings and the active profile's files, and hands the helper a
 * fresh load order when another profile was selected or a mod or plugin changed.
 */
export class SkyrimEngine {
    private readonly logger = createLogger('SkyrimEngine');
    private connecting?: Promise<void>;
    private fingerprint?: string;

    instance?: Mo2Instance;
    gameVersion?: string;
    helperVersion?: string;
    activePlugins = 0;
    /** Active plugins with no file in the game, any enabled mod, or overwrite. */
    missingPlugins: string[] = [];

    /**
     * @param projectsDir     Where projects live.
     * @param creationKitDir  Where the Creation Kit and its Papyrus compiler are; undefined means the
     *                        instance's game folder, which is where Steam installs it.
     */
    constructor(
        readonly instanceDir: string,
        readonly helper: HelperTransport,
        readonly projectsDir: string,
        private readonly creationKitOverride?: string
    ) { }

    get creationKitDir(): string {
        return this.creationKitOverride || readInstance(this.instanceDir).gameDir;
    }

    get ready(): boolean {
        return this.helper.running && this.fingerprint !== undefined;
    }

    /** Starts the helper and hands it the load order. Concurrent callers share one attempt. */
    connect(): Promise<void> {
        this.connecting ??= this.doConnect().finally(() => { this.connecting = undefined; });
        return this.connecting;
    }

    private async doConnect(): Promise<void> {
        this.instance = readInstance(this.instanceDir);
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
            this.gameVersion = (await this.helper.call<{ version: string }>('gameVersion', {
                exePath: path.join(this.instance.gameDir, 'SkyrimSE.exe')
            })).version;
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
        return `${loadOrderFingerprint(this.instanceDir)}|${stamps.join(',')}`;
    }

    private async syncLoadOrder(): Promise<void> {
        const instance = readInstance(this.instanceDir);
        const files = resolvePluginFiles(instance, readModList(instance));
        const active = readLoadOrder(instance).filter(plugin => plugin.active);
        const gameData = path.join(instance.gameDir, 'Data').toLowerCase() + path.sep;

        const plugins = active.map(plugin => {
            const file = files.get(plugin.name.toLowerCase());
            // Plugins outside the game's Data folder are the editable ones: the helper keeps no handle on them.
            return { name: plugin.name, path: file, inMemory: !!file && !file.toLowerCase().startsWith(gameData) };
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
