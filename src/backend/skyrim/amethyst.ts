import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseIni, parseModList, primaryPlugins, readLoadOrder, resolvePluginFiles } from './mo2.js';
import {
    InstanceConfigError, type Instance, type ModEntry, type ModManager, type ModManagerNotice, type PluginEntry,
    type ModEnabled
} from './modManager.js';
import { findCaseInsensitive } from './paths.js';

const run = promisify(execFile);

/**
 * Amethyst Mod Manager as the mod manager: a native Linux program that works on the game's Proton
 * prefix directly (docs/research/2026-10-15-linux-mo2-and-platform.md §1, read at v2.5.4).
 *
 * It keeps MO2's layout — `mods/`, `overwrite/`, `profiles/<name>/{modlist,plugins,loadorder}.txt` —
 * under a staging folder, with its settings in `<config>/games/Skyrim Special Edition/`. It deploys by
 * linking the winning files into the game's real `Data` folder (vanilla moved aside to `Data_Core`),
 * as a step the user starts. It cannot be told to re-read its files, and when it saves the mod list
 * it overwrites outside changes to lines it already knows — so a deploy only ever adds what is new,
 * and then has Amethyst's own `deploy` command run, or asks the user to press Refresh and Deploy.
 */

export const AMETHYST_FLATPAK_ID = 'io.github.Amethyst.ModManager';
const GAME = 'Skyrim Special Edition';
const STEAM_APP_ID = '489830';

export interface AmethystSetup {
    /** Amethyst's config folder: `…/AmethystModManager`. */
    configDir: string;
    /** Installed as a Flatpak: its command line is reached through `flatpak run`. */
    flatpak: boolean;
}

/**
 * Where Amethyst keeps its settings: SKYRIM_AMETHYST_DIR, else the Flatpak's config, else the native
 * one — the first that has Skyrim configured, or the first that exists, so the error names it.
 *
 * @param configured  SKYRIM_AMETHYST_DIR, resolved (pathSettings.ts).
 */
export function findAmethyst(configured: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir()): AmethystSetup {
    const flatpakApp = path.join(home, '.var', 'app', AMETHYST_FLATPAK_ID);
    const flatpakDir = path.join(flatpakApp, 'config', 'AmethystModManager');
    if (configured) return { configDir: configured, flatpak: configured.startsWith(flatpakApp + path.sep) };
    const native = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'AmethystModManager');
    const candidates: AmethystSetup[] = [{ configDir: flatpakDir, flatpak: true }, { configDir: native, flatpak: false }];
    return candidates.find(c => fs.existsSync(path.join(c.configDir, 'games', GAME, 'paths.json')))
        ?? candidates.find(c => fs.existsSync(c.configDir))
        ?? candidates[0];
}

export interface AmethystOptions {
    /** Whether Amethyst's window is open. Replaced in tests; by default, a live connect to its socket. */
    isRunning?: () => Promise<boolean>;
    /** Runs Amethyst's command line. Replaced in tests. */
    runCommand?: (executable: string, args: string[]) => Promise<void>;
    home?: string;
    env?: NodeJS.ProcessEnv;
}

export class AmethystManager implements ModManager {
    readonly name = 'amethyst' as const;
    private readonly home: string;
    private readonly env: NodeJS.ProcessEnv;

    constructor(private readonly setup: AmethystSetup, private readonly options: AmethystOptions = {}) {
        this.home = options.home ?? os.homedir();
        this.env = options.env ?? process.env;
    }

    get location(): string {
        return this.setup.configDir;
    }

    describe(): string {
        return `Amethyst's Skyrim Special Edition, configured in ${this.setup.configDir}`;
    }

    private get gameConfigDir(): string {
        return path.join(this.setup.configDir, 'games', GAME);
    }

    readInstance(): Instance {
        const pathsFile = path.join(this.gameConfigDir, 'paths.json');
        const settings = readJson(pathsFile);
        if (!settings) {
            throw new InstanceConfigError(
                `Amethyst has no ${GAME} set up in '${this.setup.configDir}' (no ${pathsFile}). Add the game in ` +
                `Amethyst, or set SKYRIM_AMETHYST_DIR to its config folder — for the Flatpak, ` +
                `~/.var/app/${AMETHYST_FLATPAK_ID}/config/AmethystModManager.`);
        }
        const profile = String(readJson(path.join(this.gameConfigDir, 'deploy_state.json'))?.last_active_profile || 'default');
        const root = settings.staging_path ? String(settings.staging_path) : path.join(this.profilesDir(), GAME);
        const profileDir = path.join(root, 'profiles', profile);
        if (!fs.existsSync(profileDir)) {
            throw new InstanceConfigError(
                `Amethyst's profile '${profile}' has no folder at '${profileDir}'. Select an existing profile in Amethyst.`);
        }
        // A profile other than the default may point at another game folder, and keep its own mods.
        const profileSettings = readJson(path.join(profileDir, 'profile_state.json'))?.profile_settings ?? {};
        const gameDir = String((profile !== 'default' && profileSettings.game_path) || settings.game_path || '');
        if (!gameDir || !findCaseInsensitive(gameDir, 'SkyrimSE.exe')) {
            throw new InstanceConfigError(
                `Amethyst's game folder '${gameDir}' has no SkyrimSE.exe. Fix the game path in Amethyst (Reconfigure game).`);
        }
        const modsDir = profileSettings.profile_specific_mods ? path.join(profileDir, 'mods') : path.join(root, 'mods');
        const gog = safeList(gameDir).some(file => /^goggame-\d+\.info$/i.test(file));
        return {
            instanceDir: root,
            gameDir,
            edition: gog ? 'GOG' : 'Steam',
            release: gog ? 'SkyrimSEGog' : 'SkyrimSE',
            profile,
            profileDir,
            modsDir,
            overwriteDir: path.join(path.dirname(modsDir), 'overwrite'),
            downloadsDir: this.downloadsDir()
        };
    }

    /** Where default-staged games live (Amethyst's get_profiles_dir). */
    private profilesDir(): string {
        if (this.env.MOD_MANAGER_PROFILES_DIR) return this.env.MOD_MANAGER_PROFILES_DIR;
        const legacy = path.join(this.setup.configDir, 'Profiles');
        return fs.existsSync(legacy) ? legacy : path.join(this.home, 'Games', 'Amethyst', 'Profiles');
    }

    private downloadsDir(): string {
        const ini = path.join(this.setup.configDir, 'amethyst.ini');
        const configured = fs.existsSync(ini) ? parseIni(fs.readFileSync(ini, 'utf8')).get('paths')?.get('download_cache_path') : undefined;
        return configured || path.join(this.setup.configDir, 'download_cache');
    }

    /** modlist.txt as Amethyst writes it: `*` is a locked mod — enabled, and a real folder — and separators are not mods. */
    readModList(instance: Instance): ModEntry[] {
        const file = path.join(instance.profileDir, 'modlist.txt');
        if (!fs.existsSync(file)) return [];
        return parseModList(fs.readFileSync(file, 'utf8'))
            .filter(mod => !mod.name.endsWith('_separator'))
            .map(mod => ({ name: mod.name, enabled: mod.enabled, managed: true }));
    }

    readLoadOrder(instance: Instance): PluginEntry[] {
        return readLoadOrder(instance);
    }

    /** While a profile is deployed, the game's own files are in Data_Core and Data holds the links. */
    resolvePluginFiles(instance: Instance, mods: readonly ModEntry[]): Map<string, string> {
        const core = findCaseInsensitive(instance.gameDir, 'Data_Core');
        return resolvePluginFiles(instance, mods, core ?? path.join(instance.gameDir, 'Data'));
    }

    fingerprint(): string {
        let profileDir = '';
        try {
            profileDir = this.readInstance().profileDir;
        } catch {
            // An unreadable setup gives a fingerprint of its own, and the next read reports why.
        }
        return [
            stamp(path.join(this.gameConfigDir, 'paths.json')),
            stamp(path.join(this.gameConfigDir, 'deploy_state.json')),
            profileDir,
            ...['modlist.txt', 'loadorder.txt', 'plugins.txt', 'profile_state.json'].map(name => stamp(path.join(profileDir, name)))
        ].join('|');
    }

    /**
     * The game loads `Data/<plugin>` — while deployed, a link to the mod's file. When it is a file of its
     * own (the Creation Kit saved over the link), it outranks the mod; so does a copy in overwrite.
     */
    shadowingCopies(instance: Instance, mod: string, plugin: string): string[] {
        const copies: string[] = [];
        const inData = findCaseInsensitive(instance.gameDir, `Data/${plugin}`);
        const staged = path.join(instance.modsDir, mod, plugin);
        if (inData && !(fs.existsSync(staged) && sameFile(inData, staged))) copies.push(inData);
        copies.push(path.join(instance.overwriteDir, plugin));
        return copies;
    }

    /**
     * Adds only what is new, the way Amethyst keeps outside changes: a mod line it has not seen, the
     * plugins at the end of the load order. Files are written whole and renamed into place, as Amethyst
     * writes its own, with LF line ends.
     */
    enable(instance: Instance, mod: string, plugins: readonly string[]): ModEnabled {
        const modlist = path.join(instance.profileDir, 'modlist.txt');
        const mods = readTextLines(modlist, 'utf8');
        let modEnabled = false;
        const at = mods.findIndex(line => /^[+\-*]/.test(line) && line.slice(1) === mod);
        if (at < 0) {
            mods.unshift(`+${mod}`);
            modEnabled = true;
        } else if (mods[at].startsWith('-')) {
            mods[at] = `+${mod}`;
            modEnabled = true;
        }
        if (modEnabled) writeTextLines(modlist, mods, 'utf8');

        const same = (plugin: string) => (line: string) => line.replace(/^\*/, '').toLowerCase() === plugin.toLowerCase();
        const pluginsFile = path.join(instance.profileDir, 'plugins.txt');
        // Amethyst writes plugins.txt in cp1252 where it can; latin1 reads and writes the same bytes.
        const lines = readTextLines(pluginsFile, 'latin1');
        const activated: string[] = [];
        for (const plugin of plugins) {
            const listed = lines.findIndex(same(plugin));
            if (listed >= 0 && lines[listed].startsWith('*')) continue;
            if (listed < 0) lines.push(`*${plugin}`);
            else lines[listed] = `*${plugin}`;
            activated.push(plugin);
        }
        if (activated.length > 0) writeTextLines(pluginsFile, lines, 'latin1');

        const orderFile = path.join(instance.profileDir, 'loadorder.txt');
        const order = readTextLines(orderFile, 'utf8');
        const addedToLoadOrder = plugins.filter(plugin => !order.some(same(plugin)));
        if (addedToLoadOrder.length > 0) {
            // Amethyst's loadorder.txt lists the game's own plugins too; a missing file starts from them.
            if (order.length === 0) order.push(...primaryPlugins(instance.gameDir));
            order.push(...addedToLoadOrder);
            writeTextLines(orderFile, order, 'utf8');
        }
        return { modEnabled, activated, addedToLoadOrder };
    }

    // A deploy or an install adds only lines Amethyst has not seen, which it keeps, open or not.
    async writeRefusal(): Promise<string | undefined> {
        return undefined;
    }

    /**
     * With Amethyst's window closed, its own `deploy` command puts the profile into the game. With it
     * open, running that would race the window, so the user is asked to: Refresh re-reads what this
     * deploy wrote, Deploy links it into the game.
     */
    async afterDeploy(instance: Instance): Promise<ModManagerNotice> {
        const running = await (this.options.isRunning ?? (() => amethystRunning(this.home, this.env)))();
        if (running) {
            return {
                manager: this.name, status: 'deployManually',
                nextStep: `Amethyst is open: press Refresh, then Deploy, so the game gets this mod (profile '${instance.profile}').`
            };
        }
        const [executable, ...args] = this.setup.flatpak
            ? ['flatpak', 'run', '--command=amethyst-mod-manager-cli', AMETHYST_FLATPAK_ID]
            : ['amethyst-mod-manager-cli'];
        try {
            await (this.options.runCommand ?? defaultRun)(executable, [...args, 'deploy', STEAM_APP_ID, instance.profile]);
            return { manager: this.name, status: 'deployed' };
        } catch (error) {
            return {
                manager: this.name, status: 'deployManually',
                nextStep: `Amethyst's deploy command failed (${(error as Error).message.split('\n')[0]}). Open Amethyst ` +
                    `and press Deploy (profile '${instance.profile}').`
            };
        }
    }

    notes(instance: Instance): string[] {
        const state = readJson(path.join(this.gameConfigDir, 'deploy_state.json'));
        const deployed = state?.deploy_active ? String(state.last_deployed ?? '') : '';
        return deployed && deployed !== instance.profile
            ? [`Amethyst has the profile '${deployed}' deployed, not the selected '${instance.profile}': the game runs ` +
               `'${deployed}' until '${instance.profile}' is deployed.`]
            : [];
    }
}

// ---------------------------------------------------------------- the running window

/**
 * Whether Amethyst's window is open: it listens on one of these sockets while it runs
 * (src/Nexus/nxm_handler.py). A socket file left behind by a crash refuses the connection.
 */
export function amethystSockets(home: string, env: NodeJS.ProcessEnv, uid = process.getuid?.() ?? 0): string[] {
    const name = 'amethyst-mod-manager.sock';
    return [
        path.posix.join(`/run/user/${uid}`, 'app', AMETHYST_FLATPAK_ID, name),
        ...(env.XDG_RUNTIME_DIR ? [path.posix.join(env.XDG_RUNTIME_DIR, name)] : []),
        path.join(home, '.local', 'share', 'AmethystModManager', name),
        `/tmp/amethyst-mod-manager-${uid}.sock`
    ];
}

async function amethystRunning(home: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    for (const socket of amethystSockets(home, env)) {
        if (fs.existsSync(socket) && await connects(socket)) return true;
    }
    return false;
}

function connects(socketPath: string): Promise<boolean> {
    return new Promise(resolve => {
        const client = net.connect(socketPath);
        const done = (answer: boolean) => { client.destroy(); resolve(answer); };
        client.once('connect', () => done(true));
        client.once('error', () => done(false));
        client.setTimeout(2_000, () => done(false));
    });
}

async function defaultRun(executable: string, args: string[]): Promise<void> {
    await run(executable, args, { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
}

// ---------------------------------------------------------------- files

function readJson(file: string): any {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

function stamp(file: string): string {
    try {
        return String(fs.statSync(file).mtimeMs);
    } catch {
        return '-';
    }
}

function safeList(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

function sameFile(a: string, b: string): boolean {
    const first = fs.statSync(a);
    const second = fs.statSync(b);
    return first.ino === second.ino && first.dev === second.dev;
}

/** Every line as it is, comments included, without the empty one after the last line end. */
function readTextLines(file: string, encoding: BufferEncoding): string[] {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, encoding).split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
}

/** Whole, then renamed into place: Amethyst never reads half a file. */
function writeTextLines(file: string, lines: string[], encoding: BufferEncoding): void {
    const temporary = `${file}.skyrim-mcp.tmp`;
    fs.writeFileSync(temporary, `${lines.join('\n')}\n`, encoding);
    fs.renameSync(temporary, file);
}
