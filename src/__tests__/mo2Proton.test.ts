import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Mo2Manager } from '../backend/skyrim/mo2Manager';
import { InstanceConfigError } from '../backend/skyrim/modManager';
import { linuxPlatform } from '../backend/skyrim/platform';

/**
 * Mod Organizer 2 under Proton on Linux (docs/adr/0007): its ModOrganizer.ini holds Windows paths,
 * whose drive letters are links in the Wine prefix's `dosdevices` folder.
 *
 * Windows forbids `:` in a file name, so a prefix cannot be laid out here as Wine lays it out. These
 * tests give the Linux platform a drive lookup instead — drive `x` of a prefix is its `drive_x`
 * folder, as `c:` is `drive_c` in a real one — and the real lookup is tested where it can run.
 */

const roots: string[] = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function write(file: string, text = ''): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

const qt = (value: string) => value.replace(/\\/g, '\\\\');

/** Drive `x` of a prefix is its `drive_x` folder; without a prefix there are no drives. */
const prefixFolders = (prefix: string | undefined, letter: string) => prefix && path.join(prefix, `drive_${letter}`);

/**
 * An MO2-LINT-style setup: the instance in the home folder, the game in a Steam library with its Proton
 * prefix. The home folder is on the prefix's Z:, the root, so the instance is `Z:\home\u\…` to Wine.
 */
function makeProtonSetup(ini: { gamePath: string; settings?: string[] }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-mo2-proton-'));
    roots.push(root);
    const prefix = path.join(root, 'library', 'steamapps', 'compatdata', '489830', 'pfx');
    const home = path.join(prefix, 'drive_z', 'home', 'u');
    const instanceDir = path.join(home, 'Games', 'mo2-lint', 'mo2-skyrim_se-steam');
    const procRoot = path.join(root, 'proc');
    write(path.join(instanceDir, 'ModOrganizer.ini'), [
        '[General]',
        'gameName=Skyrim Special Edition',
        `gamePath=${ini.gamePath}`,
        'selected_profile=@ByteArray(Default)',
        '[Settings]',
        ...(ini.settings ?? []),
        ''
    ].join('\r\n'));
    write(path.join(instanceDir, 'profiles', 'Default', 'modlist.txt'));
    return { root, home, instanceDir, prefix, procRoot, platform: linuxPlatform(procRoot, prefixFolders) };
}

/** MO2-LINT's list of the instances it installed, as its state_file.py writes it. */
function writeLintState(home: string, instances: { instance_path: string; game_path: string }[]): void {
    write(path.join(home, '.config', 'mo2-lint', 'state.json'), JSON.stringify({
        nexus_api: null,
        instances: instances.map((instance, index) => ({
            index, game: 'skyrim_se', display_name: null, nexus_slug: 'skyrimspecialedition', pin: false,
            launcher: 'steam', launcher_ids: { steam: 489830, gog: 1711230643, epic: 'ac82db5035584c7f8a2c548d98c86b2c' },
            game_executable: 'SkyrimSE.exe', proton_wrapper: null, script_extender: null, script_extender_files: null, plugins: [],
            ...instance
        }))
    }));
}

const gameInD = `@ByteArray(${qt('D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition')})`;
const gameUnder = (prefix: string) => path.join(prefix, 'drive_d', 'SteamLibrary', 'steamapps', 'common', 'Skyrim Special Edition');

describe('Mod Organizer under Proton', () => {
    it('reads the ini\'s Windows paths through the drives of the prefix SKYRIM_WINE_PREFIX names', () => {
        const setup = makeProtonSetup({
            gamePath: `@ByteArray(${qt('D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition')})`,
            settings: ['download_directory=D:/Downloads']
        });
        const game = path.join(setup.prefix, 'drive_d', 'SteamLibrary', 'steamapps', 'common', 'Skyrim Special Edition');
        write(path.join(game, 'SkyrimSE.exe'));

        const manager = new Mo2Manager(setup.instanceDir, setup.platform, { winePrefix: setup.prefix, home: setup.home });
        const instance = manager.readInstance();

        expect(instance.gameDir).toBe(game);
        expect(instance.downloadsDir).toBe(path.join(setup.prefix, 'drive_d', 'Downloads'));
        expect(instance.modsDir).toBe(path.join(setup.instanceDir, 'mods'));
    });

    it('finds an MO2-LINT instance\'s prefix by itself: the game\'s own, beside it in its Steam library', () => {
        const setup = makeProtonSetup({ gamePath: gameInD });
        write(path.join(gameUnder(setup.prefix), 'SkyrimSE.exe'));
        writeLintState(setup.home, [
            { instance_path: path.join(setup.home, 'Games', 'mo2-lint', 'mo2-skyrim_se-gog'), game_path: path.join(setup.root, 'elsewhere') },
            { instance_path: setup.instanceDir, game_path: path.join(setup.root, 'library', 'steamapps', 'common', 'Skyrim Special Edition') }
        ]);

        const instance = new Mo2Manager(setup.instanceDir, setup.platform, { home: setup.home }).readInstance();
        expect(instance.gameDir).toBe(gameUnder(setup.prefix));
    });

    it('takes the prefix SKYRIM_WINE_PREFIX names over MO2-LINT\'s', () => {
        const setup = makeProtonSetup({ gamePath: gameInD });
        writeLintState(setup.home, [{ instance_path: setup.instanceDir, game_path: path.join(setup.root, 'library', 'steamapps', 'common', 'Skyrim Special Edition') }]);
        fs.mkdirSync(setup.prefix, { recursive: true });
        const own = path.join(setup.root, 'own-prefix');
        write(path.join(gameUnder(own), 'SkyrimSE.exe'));

        const instance = new Mo2Manager(setup.instanceDir, setup.platform, { winePrefix: own, home: setup.home }).readInstance();
        expect(instance.gameDir).toBe(gameUnder(own));
    });

    it('takes Proton\'s compatdata folder for the prefix in it', () => {
        const setup = makeProtonSetup({ gamePath: gameInD });
        write(path.join(gameUnder(setup.prefix), 'SkyrimSE.exe'));

        const compatdata = path.dirname(setup.prefix);
        const instance = new Mo2Manager(setup.instanceDir, setup.platform, { winePrefix: compatdata, home: setup.home }).readInstance();
        expect(instance.gameDir).toBe(gameUnder(setup.prefix));
    });

    it('asks for SKYRIM_WINE_PREFIX when the ini names a drive and no prefix is known', () => {
        const setup = makeProtonSetup({ gamePath: gameInD });
        const manager = new Mo2Manager(setup.instanceDir, setup.platform, { home: setup.home });
        expect(() => manager.readInstance()).toThrow(InstanceConfigError);
        expect(() => manager.readInstance()).toThrow(/D:\\SteamLibrary.*SKYRIM_WINE_PREFIX/);
    });

    it('never starts Mod Organizer\'s refresh: one of this instance found running is to be closed, or restarted', async () => {
        const setup = makeProtonSetup({ gamePath: gameInD });
        write(path.join(gameUnder(setup.prefix), 'SkyrimSE.exe'));
        const manager = new Mo2Manager(setup.instanceDir, setup.platform, { winePrefix: setup.prefix, home: setup.home });
        const instance = manager.readInstance();
        expect(await manager.writeRefusal(instance)).toBeUndefined();

        write(path.join(setup.procRoot, '77', 'cmdline'), 'Z:\\home\\u\\Games\\mo2-lint\\mo2-skyrim_se-steam\\ModOrganizer.exe\0');
        expect(await manager.writeRefusal(instance)).toMatch(/Close it, then try again/);
        // Started between that check and the end of the deploy: it may have read the profile before the deploy changed it.
        expect(await manager.afterDeploy(instance)).toMatchObject({ status: 'deployManually', nextStep: expect.stringMatching(/start it again/) });
    });

    it('says in healthcheck that it is unverified, and which prefix it reads the ini through', () => {
        const setup = makeProtonSetup({ gamePath: gameInD });
        write(path.join(gameUnder(setup.prefix), 'SkyrimSE.exe'));
        const withPrefix = new Mo2Manager(setup.instanceDir, setup.platform, { winePrefix: setup.prefix, home: setup.home });
        const notes = withPrefix.notes();
        expect(notes.join('\n')).toMatch(/under Proton.*unverified/i);
        expect(notes.join('\n')).toContain(setup.prefix);

        const withoutPrefix = new Mo2Manager(setup.instanceDir, setup.platform, { home: setup.home });
        expect(withoutPrefix.notes().join('\n')).toMatch(/No Wine prefix.*Z:.*SKYRIM_WINE_PREFIX/);
    });
});

describe('the drives of a Wine prefix', () => {
    // Windows forbids `:` in a file name; CI runs this on Linux.
    it.skipIf(process.platform === 'win32')('follows each drive\'s link in dosdevices, and knows only Z: without a prefix', () => {
        const prefix = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-wine-')), 'pfx');
        roots.push(path.dirname(prefix));
        fs.mkdirSync(path.join(prefix, 'drive_c'), { recursive: true });
        fs.mkdirSync(path.join(prefix, 'dosdevices'));
        fs.symlinkSync('../drive_c', path.join(prefix, 'dosdevices', 'c:'));
        fs.symlinkSync('/', path.join(prefix, 'dosdevices', 'z:'));

        const inPrefix = linuxPlatform().windowsPaths(prefix);
        expect(inPrefix('C:\\users\\steamuser\\Documents')).toBe(path.join(prefix, 'drive_c', 'users', 'steamuser', 'Documents'));
        expect(inPrefix('Z:\\home\\u\\Games/mo2')).toBe('/home/u/Games/mo2');
        expect(inPrefix('D:\\Downloads')).toBeUndefined();

        const noPrefix = linuxPlatform().windowsPaths(undefined);
        expect(noPrefix('Z:\\home\\u')).toBe('/home/u');
        expect(noPrefix('C:\\users')).toBeUndefined();
        expect(noPrefix('/home/u/mo2')).toBe('/home/u/mo2');
    });
});
