import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi, type MockInstance } from 'vitest';
import { AMETHYST_FLATPAK_ID, AmethystManager, findAmethyst, type AmethystOptions } from '../backend/skyrim/amethyst';
import { SkyrimEngine } from '../backend/skyrim/engine';
import type { HelperTransport } from '../backend/skyrim/helperClient';
import { InstanceConfigError } from '../backend/skyrim/modManager';
import { linuxPlatform } from '../backend/skyrim/platform';
import { SkyrimInstanceBackend } from '../backend/skyrim/SkyrimInstanceBackend';
import { chooseModManager, explainMissingEnv, missingEnv, modManagerName } from '../backend/index';

/**
 * Amethyst as the mod manager, against a setup laid out the way Amethyst 2.5.4 lays out the user's
 * real one (docs/research/2026-10-15-linux-mo2-and-platform.md §1): the Flatpak's config, a custom
 * staging folder beside the Steam library, a hardlink deploy with the game's files in Data_Core. The
 * profile files are excerpts of a real profile. Only the plugin helper and Amethyst's own command
 * line are stand-ins.
 */

let consoleError: MockInstance;
beforeAll(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => { }); });
afterAll(() => { consoleError.mockRestore(); });

const roots: string[] = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function write(file: string, text = ''): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

const VANILLA = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'ccBGSSSE001-Fish.esm', '_ResourcePack.esl'];

/** A home folder with Amethyst's Flatpak config, a Steam library and a staging folder, deployed. */
function makeSetup(options: { deployed?: boolean; profile?: string } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-amethyst-'));
    roots.push(home);
    const config = path.join(home, '.var', 'app', AMETHYST_FLATPAK_ID, 'config', 'AmethystModManager');
    const gameConfig = path.join(config, 'games', 'Skyrim Special Edition');
    const library = path.join(home, 'games', 'Games', 'steamapps');
    const game = path.join(library, 'common', 'Skyrim Special Edition');
    const staging = path.join(home, 'games', 'Games', 'Amethyst', 'Skyrim Special Edition');
    const profile = path.join(staging, 'profiles', options.profile ?? 'default');

    write(path.join(gameConfig, 'paths.json'), JSON.stringify({
        game_path: game,
        prefix_path: path.join(library, 'compatdata', '489830', 'pfx'),
        deploy_mode: 'hardlink',
        staging_path: staging
    }, null, 2));
    write(path.join(gameConfig, 'deploy_state.json'), JSON.stringify({
        last_active_profile: options.profile ?? 'default', last_deployed: 'default', deploy_active: options.deployed ?? true
    }, null, 2));

    write(path.join(game, 'SkyrimSE.exe'));
    write(path.join(game, 'Skyrim.ccc'), 'ccBGSSSE001-Fish.esm\r\n_ResourcePack.esl\r\n');
    for (const file of VANILLA) {
        write(path.join(game, 'Data', file));
        if (options.deployed ?? true) write(path.join(game, 'Data_Core', file));
    }

    // Excerpts of a real Amethyst profile: only `+` mods, `*` plugins, LF, no header.
    write(path.join(profile, 'modlist.txt'), [
        '+UIExtensions v1', '+Serana Dialogue Expansion - ESL', '-Weapons_separator', '+Immersive Weapons',
        '*SkyUI', '-Old Mod', '+Unofficial Skyrim Special Edition Patch', '+Address Library All in One (1.7.104.0) v13', ''
    ].join('\n'));
    write(path.join(profile, 'plugins.txt'), [
        '*unofficial skyrim special edition patch.esp', '*SkyUI_SE.esp', '*Immersive Weapons.esp', '*UIExtensions.esp',
        '*SeranaDialogueExpansion.esp', ''
    ].join('\n'));
    write(path.join(profile, 'loadorder.txt'), [
        'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'ccbgssse001-fish.esm',
        '_ResourcePack.esl', 'unofficial skyrim special edition patch.esp', 'SkyUI_SE.esp', 'Immersive Weapons.esp',
        'UIExtensions.esp', 'SeranaDialogueExpansion.esp', ''
    ].join('\n'));
    const mods = path.join(staging, 'mods');
    write(path.join(mods, 'Unofficial Skyrim Special Edition Patch', 'unofficial skyrim special edition patch.esp'), 'ussep');
    write(path.join(mods, 'SkyUI', 'SkyUI_SE.esp'), 'skyui');
    write(path.join(mods, 'Immersive Weapons', 'Immersive Weapons.esp'), 'iw');
    write(path.join(mods, 'UIExtensions v1', 'UIExtensions.esp'), 'uie');
    write(path.join(mods, 'Serana Dialogue Expansion - ESL', 'SeranaDialogueExpansion.esp'), 'sde');
    write(path.join(mods, 'Old Mod', 'Old.esp'), 'old');
    fs.mkdirSync(path.join(staging, 'overwrite'), { recursive: true });
    // Left in Data by the last deploy, from a mod disabled since.
    if (options.deployed ?? true) write(path.join(game, 'Data', 'Old.esp'), 'stale link');

    return { home, config, gameConfig, game, staging, profile, mods };
}

/** A home folder with no mod manager's settings in it. */
function emptyHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-no-amethyst-'));
    roots.push(home);
    return home;
}

function manager(setup: ReturnType<typeof makeSetup>, options: AmethystOptions = {}) {
    return new AmethystManager({ configDir: setup.config, flatpak: true }, { home: setup.home, env: {}, ...options });
}

describe('finding Amethyst', () => {
    it('finds the Flatpak\'s config before a native one, by where Skyrim is set up', () => {
        const setup = makeSetup();
        expect(findAmethyst(undefined, {}, setup.home)).toEqual({ configDir: setup.config, flatpak: true });

        const native = path.join(setup.home, '.config', 'AmethystModManager');
        fs.rmSync(path.join(setup.home, '.var'), { recursive: true });
        write(path.join(native, 'games', 'Skyrim Special Edition', 'paths.json'), '{}');
        expect(findAmethyst(undefined, {}, setup.home)).toEqual({ configDir: native, flatpak: false });
    });

    it('takes SKYRIM_AMETHYST_DIR as given, and knows a Flatpak path when it sees one', () => {
        const home = path.join(os.tmpdir(), 'someone');
        expect(findAmethyst(path.resolve('/opt/amethyst-config'), {}, home).flatpak).toBe(false);
        const flatpak = path.join(home, '.var', 'app', AMETHYST_FLATPAK_ID, 'config', 'AmethystModManager');
        expect(findAmethyst(flatpak, {}, home)).toEqual({ configDir: flatpak, flatpak: true });
    });

    it('chooses the mod manager SKYRIM_MOD_MANAGER names, and refuses one it does not know', () => {
        const setup = makeSetup();
        expect(modManagerName({ SKYRIM_MOD_MANAGER: 'Amethyst' }, emptyHome())).toBe('amethyst');
        expect(modManagerName({ SKYRIM_MOD_MANAGER: 'mo2' }, setup.home)).toBe('mo2');
        expect(() => modManagerName({ SKYRIM_MOD_MANAGER: 'vortex' }, setup.home)).toThrow(/mo2 or amethyst/);
    });

    it('without SKYRIM_MOD_MANAGER, takes what is configured: an MO2 instance, Amethyst\'s folder, Amethyst set up for Skyrim', () => {
        const setup = makeSetup();
        expect(chooseModManager({}, setup.home)).toEqual({ name: 'amethyst', because: expect.stringMatching(/config has Skyrim/) });
        expect(chooseModManager({ SKYRIM_MO2_INSTANCE: 'G:\\Modding\\SkyrimSE-Test' }, setup.home).name).toBe('mo2');
        expect(chooseModManager({ SKYRIM_AMETHYST_DIR: '~/amethyst-config' }, emptyHome()))
            .toEqual({ name: 'amethyst', because: expect.stringMatching(/SKYRIM_AMETHYST_DIR/) });

        // A native install's config counts as the Flatpak's does; a config folder with no Skyrim in it does not.
        const native = emptyHome();
        write(path.join(native, '.config', 'AmethystModManager', 'games', 'Skyrim Special Edition', 'paths.json'), '{}');
        expect(modManagerName({}, native)).toBe('amethyst');
        const noSkyrim = emptyHome();
        fs.mkdirSync(path.join(noSkyrim, '.var', 'app', AMETHYST_FLATPAK_ID, 'config', 'AmethystModManager', 'games'), { recursive: true });
        expect(modManagerName({}, noSkyrim)).toBe('mo2');
        expect(modManagerName({}, emptyHome())).toBe('mo2');
    });

    it('needs the MO2 instance only when nothing else is configured, and says how to give one', () => {
        expect(missingEnv({}, emptyHome())).toEqual(['SKYRIM_MO2_INSTANCE']);
        expect(missingEnv({}, makeSetup().home)).toEqual([]);
        expect(missingEnv({ SKYRIM_MOD_MANAGER: 'amethyst' }, emptyHome())).toEqual([]);
        expect(explainMissingEnv(['SKYRIM_MO2_INSTANCE'])).toMatch(/SKYRIM_MO2_INSTANCE.*ModOrganizer\.ini.*Amethyst/);
    });

    it('says in healthcheck\'s notes that Amethyst was chosen by itself, and how to choose another', async () => {
        const setup = makeSetup({ deployed: false });
        const chosen = new AmethystManager({ configDir: setup.config, flatpak: true },
            { home: setup.home, env: {}, chosenBecause: 'its config has Skyrim set up' });
        expect(chosen.notes(chosen.readInstance())).toEqual([expect.stringMatching(/Amethyst.*its config has Skyrim set up.*SKYRIM_MOD_MANAGER=mo2/)]);
        expect(manager(setup).notes(manager(setup).readInstance())).toEqual([]);
    });
});

describe('reading an Amethyst instance', () => {
    it('finds the game, the active profile and the staging folders', () => {
        const setup = makeSetup();
        const instance = manager(setup).readInstance();
        expect(instance).toEqual(expect.objectContaining({
            instanceDir: setup.staging, gameDir: setup.game, profile: 'default', profileDir: setup.profile,
            modsDir: setup.mods, overwriteDir: path.join(setup.staging, 'overwrite'), release: 'SkyrimSE'
        }));
    });

    it('stages a game without its own staging path under Amethyst\'s Profiles folder', () => {
        const setup = makeSetup();
        const settings = JSON.parse(fs.readFileSync(path.join(setup.gameConfig, 'paths.json'), 'utf8'));
        fs.writeFileSync(path.join(setup.gameConfig, 'paths.json'), JSON.stringify({ ...settings, staging_path: '' }));
        const root = path.join(setup.home, 'Games', 'Amethyst', 'Profiles', 'Skyrim Special Edition');
        fs.cpSync(setup.staging, root, { recursive: true });
        expect(manager(setup).readInstance().modsDir).toBe(path.join(root, 'mods'));
    });

    it('keeps a profile\'s own mods and game folder when the profile says so', () => {
        const setup = makeSetup({ profile: 'Survival' });
        write(path.join(setup.profile, 'profile_state.json'), JSON.stringify({ profile_settings: { profile_specific_mods: true } }));
        const instance = manager(setup).readInstance();
        expect(instance.modsDir).toBe(path.join(setup.profile, 'mods'));
        expect(instance.overwriteDir).toBe(path.join(setup.profile, 'overwrite'));
    });

    it('says what to fix when Skyrim is not set up', () => {
        const setup = makeSetup();
        fs.rmSync(path.join(setup.gameConfig, 'paths.json'));
        expect(() => manager(setup).readInstance()).toThrow(InstanceConfigError);
        expect(() => manager(setup).readInstance()).toThrow(/SKYRIM_AMETHYST_DIR/);
    });

    it('reads `*` as a locked mod that is there, and skips separators', () => {
        const setup = makeSetup();
        const am = manager(setup);
        const mods = am.readModList(am.readInstance());
        expect(mods.find(m => m.name === 'SkyUI')).toEqual({ name: 'SkyUI', enabled: true, managed: true });
        expect(mods.find(m => m.name === 'Old Mod')).toEqual({ name: 'Old Mod', enabled: false, managed: true });
        expect(mods.some(m => m.name.endsWith('_separator'))).toBe(false);
    });

    it('takes the game\'s own plugins from Data_Core while deployed, not what was left in Data', () => {
        const setup = makeSetup();
        const am = manager(setup);
        const instance = am.readInstance();
        const files = am.resolvePluginFiles(instance, am.readModList(instance));
        expect(files.get('skyrim.esm')).toBe(path.join(setup.game, 'Data_Core', 'Skyrim.esm'));
        expect(files.get('skyui_se.esp')).toBe(path.join(setup.mods, 'SkyUI', 'SkyUI_SE.esp'));
        expect(files.has('old.esp')).toBe(false);

        const order = am.readLoadOrder(instance);
        expect(order.filter(p => p.active).map(p => p.name)).toEqual([
            'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'ccbgssse001-fish.esm',
            '_ResourcePack.esl', 'unofficial skyrim special edition patch.esp', 'SkyUI_SE.esp', 'Immersive Weapons.esp',
            'UIExtensions.esp', 'SeranaDialogueExpansion.esp'
        ]);
    });

    it('says when the game runs another profile than the selected one', () => {
        const setup = makeSetup({ profile: 'Survival' });
        const am = manager(setup);
        expect(am.notes(am.readInstance())).toEqual([expect.stringMatching(/'default' deployed, not the selected 'Survival'/)]);
        expect(manager(makeSetup()).notes(manager(makeSetup()).readInstance())).toEqual([]);
    });
});

describe('changing an Amethyst profile', () => {
    it('adds the mod on top and the plugin at the end, LF, leaving every other line as it was', () => {
        const setup = makeSetup();
        const am = manager(setup);
        const instance = am.readInstance();
        const before = fs.readFileSync(path.join(setup.profile, 'modlist.txt'), 'utf8');
        expect(am.enable(instance, 'MyPatch', ['MyPatch.esp'])).toEqual({ modEnabled: true, activated: ['MyPatch.esp'], addedToLoadOrder: ['MyPatch.esp'] });

        expect(fs.readFileSync(path.join(setup.profile, 'modlist.txt'), 'utf8')).toBe(`+MyPatch\n${before}`);
        expect(fs.readFileSync(path.join(setup.profile, 'plugins.txt'), 'utf8')).toMatch(/\*SeranaDialogueExpansion\.esp\n\*MyPatch\.esp\n$/);
        expect(fs.readFileSync(path.join(setup.profile, 'loadorder.txt'), 'utf8')).toMatch(/SeranaDialogueExpansion\.esp\nMyPatch\.esp\n$/);
        expect(fs.readdirSync(setup.profile).some(f => f.endsWith('.tmp'))).toBe(false);

        // Once there, nothing changes: Amethyst keeps lines it has not seen, and these are now its own.
        expect(am.enable(instance, 'MyPatch', ['MyPatch.esp'])).toEqual({ modEnabled: false, activated: [], addedToLoadOrder: [] });
    });

    it('adds a mod\'s plugins in the order given, and a mod without plugins to the mod list only', () => {
        const setup = makeSetup();
        const am = manager(setup);
        const instance = am.readInstance();
        const plugins = fs.readFileSync(path.join(setup.profile, 'plugins.txt'), 'utf8');
        expect(am.enable(instance, 'Textures', [])).toEqual({ modEnabled: true, activated: [], addedToLoadOrder: [] });
        expect(fs.readFileSync(path.join(setup.profile, 'plugins.txt'), 'utf8')).toBe(plugins);

        expect(am.enable(instance, 'Big Mod', ['BigMod.esm', 'BigMod - Patch.esp']).addedToLoadOrder).toEqual(['BigMod.esm', 'BigMod - Patch.esp']);
        expect(fs.readFileSync(path.join(setup.profile, 'loadorder.txt'), 'utf8')).toMatch(/\nBigMod\.esm\nBigMod - Patch\.esp\n$/);
    });

    it('has Amethyst deploy when its window is closed, and asks the user when it is open', async () => {
        const setup = makeSetup();
        const runs: string[][] = [];
        const closed = manager(setup, { isRunning: async () => false, runCommand: async (exe, args) => { runs.push([exe, ...args]); } });
        expect(await closed.afterDeploy(closed.readInstance())).toEqual({ manager: 'amethyst', status: 'deployed' });
        expect(runs).toEqual([['flatpak', 'run', '--command=amethyst-mod-manager-cli', AMETHYST_FLATPAK_ID, 'deploy', '489830', 'default']]);

        const open = manager(setup, { isRunning: async () => true, runCommand: async () => { throw new Error('must not run'); } });
        expect(await open.afterDeploy(open.readInstance())).toEqual(expect.objectContaining({
            status: 'deployManually', nextStep: expect.stringMatching(/press Refresh, then Deploy/)
        }));

        const failing = manager(setup, { isRunning: async () => false, runCommand: async () => { throw new Error('flatpak: not found'); } });
        expect((await failing.afterDeploy(failing.readInstance())).nextStep).toMatch(/flatpak: not found.*press Deploy/);
    });
});

// ---------------------------------------------------------------- through the backend

function scriptedHelper() {
    let running = false;
    let builds = 0;
    const helper: HelperTransport = {
        get running() { return running; },
        async start() { running = true; },
        stop() { running = false; },
        async call(method: string, params: any = {}): Promise<any> {
            switch (method) {
                case 'hello': return { helper: 'test', protocol: 1 };
                case 'gameVersion': return { version: '1.7.104.0' };
                case 'setLoadOrder': return { plugins: params.plugins.length, missing: [] };
                case 'build':
                    write(params.outputPath, `build ${++builds}`);
                    return { records: 1, masters: ['Skyrim.esm'], headerVersion: params.headerVersion, resolvedLinks: [] };
                case 'serialize':
                    write(path.join(params.outputDir, 'RecordData.yaml'), 'ModKey: MyPatch.esp\nGameRelease: SkyrimSE\n');
                    write(path.join(params.outputDir, 'Weapons', 'Sword - 000800_MyPatch.esp.yaml'), 'FormKey: 000800:MyPatch.esp\nEditorID: Sword\n');
                    return { files: 2 };
                // Every downloaded file holds one plain mod in a wrapper folder.
                case 'checkRecords': return { records: 1 };
                case 'readArchive': return { files: ['Plain Mod/PlainMod.esp', 'Plain Mod/textures/a.dds'] };
                case 'extractArchive':
                    for (const { from, to } of params.files) write(path.join(params.targetDir, to), from);
                    return { written: params.files.length, missing: [] };
                case 'pluginHeaders':
                    return { plugins: params.paths.map((file: string) => ({ path: file, masters: ['Skyrim.esm'], master: false, light: false })) };
                default: throw new Error(`unexpected helper call ${method}`);
            }
        }
    };
    return helper;
}

/** Moves the clock of a folder's files and folders back, so a build made now is newer than the sources. */
function age(dir: string): void {
    const past = new Date(Date.now() - 60_000);
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            fs.utimesSync(full, past, past);
        }
    };
    walk(dir);
}

describe('deploying into Amethyst', () => {
    function makeBackend() {
        const setup = makeSetup();
        const runs: string[][] = [];
        const am = manager(setup, { isRunning: async () => false, runCommand: async (exe, args) => { runs.push([exe, ...args]); } });
        const quiet = linuxPlatform(path.join(setup.home, 'no-proc'));
        const projects = path.join(setup.home, 'projects');
        const backend = new SkyrimInstanceBackend({ engine: new SkyrimEngine(am, scriptedHelper(), projects, { platform: quiet }) });
        return { setup, backend, runs, project: path.join(projects, 'MyPatch') };
    }

    it('deploys a project, has Amethyst link it in, and keeps a deployed hard link current', async () => {
        const { setup, backend, runs, project } = makeBackend();
        await backend.newProject({ project: 'MyPatch' });
        write(path.join(project, 'plugin', 'Weapons', 'Sword - 000800_MyPatch.esp.yaml'), 'FormKey: 000800:MyPatch.esp\nEditorID: Sword\n');
        age(project);
        await backend.buildProject('MyPatch');
        const deployed = await backend.deployProject('MyPatch');
        expect(deployed.modManager).toEqual({ manager: 'amethyst', status: 'deployed' });
        expect(runs).toHaveLength(1);
        expect(fs.readFileSync(path.join(setup.profile, 'modlist.txt'), 'utf8')).toMatch(/^\+MyPatch\n/);

        // What Amethyst's deploy does: the plugin in Data is a hard link to the staged one.
        const staged = path.join(setup.mods, 'MyPatch', 'MyPatch.esp');
        const inData = path.join(setup.game, 'Data', 'MyPatch.esp');
        fs.linkSync(staged, inData);

        // A new build, deployed: written in place, so the link in Data sees it without a redeploy.
        write(path.join(project, 'plugin', 'Weapons', 'Sword.yaml'), 'EditorID: Sword\n');
        age(project);
        await backend.buildProject('MyPatch');
        await backend.deployProject('MyPatch');
        expect(fs.readFileSync(inData, 'utf8')).toBe('build 2');
    });

    it('guards a plugin the Creation Kit saved over the link in Data, pulls it, and clears it on deploy', async () => {
        const { setup, backend, project } = makeBackend();
        await backend.newProject({ project: 'MyPatch' });
        write(path.join(project, 'plugin', 'Weapons', 'Sword - 000800_MyPatch.esp.yaml'), 'FormKey: 000800:MyPatch.esp\nEditorID: Sword\n');
        age(project);
        await backend.buildProject('MyPatch');
        await backend.deployProject('MyPatch');

        // Saved anew by the Creation Kit, running in the prefix: Data now holds a file of its own. Linux stamps
        // files from a coarse clock, so it may carry the very time of the deploy's own write: pinned here.
        const inData = path.join(setup.game, 'Data', 'MyPatch.esp');
        write(inData, 'saved in the Creation Kit');
        const instant = new Date();
        for (const file of [inData, path.join(setup.mods, 'MyPatch', 'MyPatch.esp')]) fs.utimesSync(file, instant, instant);
        await expect(backend.deployProject('MyPatch')).rejects.toThrow(/pullProject/);

        const pulled = await backend.pullProject('MyPatch');
        expect(pulled.source).toBe(inData);
        age(project);
        await backend.buildProject('MyPatch');
        const deployed = await backend.deployProject('MyPatch');
        expect(deployed.removedCopies).toEqual([inData]);
        expect(fs.existsSync(inData)).toBe(false);
    });

    it('installs a downloaded file into the staged mods, as lines Amethyst keeps, and has Amethyst deploy it', async () => {
        const { setup, backend, runs } = makeBackend();
        write(path.join(setup.config, 'download_cache', 'Plain Mod.zip'), 'archive bytes');
        const installed = await backend.installMod({ file: 'Plain Mod.zip' });
        expect(installed).toMatchObject({
            mod: 'Plain Mod', root: 'Plain Mod', plugins: ['PlainMod.esp'], modManager: { manager: 'amethyst', status: 'deployed' }
        });
        expect(fs.existsSync(path.join(setup.mods, 'Plain Mod', 'textures', 'a.dds'))).toBe(true);
        expect(fs.readFileSync(path.join(setup.profile, 'modlist.txt'), 'utf8')).toMatch(/^\+Plain Mod\n\+UIExtensions v1\n/);
        expect(fs.readFileSync(path.join(setup.profile, 'plugins.txt'), 'utf8')).toMatch(/\n\*PlainMod\.esp\n$/);
        expect(runs).toEqual([expect.arrayContaining(['deploy', '489830', 'default'])]);
    });

    it('names Amethyst in healthcheck', async () => {
        const { backend, setup } = makeBackend();
        const health = await backend.health();
        expect(health).toEqual(expect.objectContaining({ modManager: 'amethyst', instance: setup.config, profile: 'default' }));
        expect(backend.describe()).toMatch(/Amethyst/);
    });
});
