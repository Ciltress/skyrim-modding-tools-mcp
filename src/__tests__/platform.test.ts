import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CompilerUnavailableError, papyrusCommand, type CompileOptions } from '../backend/skyrim/externalTools';
import type { Mo2Instance } from '../backend/skyrim/mo2';
import { findCaseInsensitive } from '../backend/skyrim/paths';
import { linuxPlatform, type Platform } from '../backend/skyrim/platform';

/**
 * What differs by operating system (docs/adr/0007), tested on whichever one runs the suite: the Linux
 * side reads a process table laid out in a temporary folder, and file names are matched by the
 * server itself, never by the file system.
 */

const roots: string[] = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-platform-'));
    roots.push(dir);
    return dir;
}

function write(file: string, text = ''): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

describe('finding files whatever their letter case', () => {
    it('finds a path spelled in another case, as it is spelled on disk', () => {
        const root = tempDir();
        write(path.join(root, 'Data', 'Scripts', 'Source', 'Actor.psc'));
        expect(findCaseInsensitive(root, 'data/scripts/source/actor.psc')).toBe(path.join(root, 'Data', 'Scripts', 'Source', 'Actor.psc'));
        expect(findCaseInsensitive(root, 'Data\\Scripts')).toBe(path.join(root, 'Data', 'Scripts'));
    });

    it('prefers the exact spelling, and says when there is none', () => {
        const root = tempDir();
        write(path.join(root, 'Data', 'a.txt'));
        expect(findCaseInsensitive(root, 'Data')).toBe(path.join(root, 'Data'));
        expect(findCaseInsensitive(root, 'Data/Source/Scripts')).toBeUndefined();
        expect(findCaseInsensitive(path.join(root, 'missing'), 'Data')).toBeUndefined();
    });
});

describe('the Linux platform', () => {
    it('finds a Windows program running under Wine by its Windows path', async () => {
        const proc = tempDir();
        write(path.join(proc, '1201', 'cmdline'), 'Z:\\home\\u\\Games\\mo2\\ModOrganizer.exe\0refresh\0');
        write(path.join(proc, '1202', 'cmdline'), '/usr/bin/python3\0-m\0run_qt\0');
        write(path.join(proc, 'self', 'cmdline'), 'ModOrganizer.exe\0');
        fs.mkdirSync(path.join(proc, '1203')); // a process that ended between listing and reading

        expect(await linuxPlatform(proc).findProcesses('modorganizer.exe')).toEqual([
            { pid: 1201, path: 'Z:\\home\\u\\Games\\mo2\\ModOrganizer.exe' }
        ]);
    });

    it('names its helper without .exe, and has no Creation Kit compiler', async () => {
        const linux = linuxPlatform(tempDir());
        expect(linux.helperFileName).toBe('SkyrimHelper');
        expect(linux.creationKitCompiler('/games/skyrim')).toBeUndefined();
        expect(await linux.creationKitCompilerProblem()).toMatch(/SKYRIM_PAPYRUS_COMPILER/);
    });
});

describe('the Papyrus command', () => {
    /** A game folder with the Creation Kit's sources, a mod with sources in lower case, and a project. */
    function setup() {
        const root = tempDir();
        const game = path.join(root, 'game');
        write(path.join(game, 'Data', 'Source', 'Scripts', 'Actor.psc'));
        write(path.join(game, 'Data', 'Source', 'Scripts', 'TESV_Papyrus_Flags.flg'));
        write(path.join(game, 'Papyrus Compiler', 'PapyrusCompiler.exe'));
        write(path.join(root, 'mods', 'SKSE', 'scripts', 'source', 'SKSE.psc'));
        write(path.join(root, 'tools', 'papyrus-compiler'));
        const instance = { modsDir: path.join(root, 'mods') } as Mo2Instance;
        const options = (platform: Platform, compiler?: string): CompileOptions => ({
            platform, compiler, creationKitDir: game,
            scriptsDir: path.join(root, 'project', 'scripts'),
            outputDir: path.join(root, 'project', 'build', 'Scripts'),
            instance,
            mods: [{ name: 'SKSE', enabled: true, managed: true }]
        });
        return { root, game, options };
    }

    const windowsLike: Platform = {
        name: 'windows',
        helperFileName: 'SkyrimHelper.exe',
        findProcesses: async () => [],
        creationKitCompiler: dir => path.join(dir, 'Papyrus Compiler', 'PapyrusCompiler.exe'),
        creationKitCompilerProblem: async () => undefined
    };

    it('speaks the Creation Kit compiler\'s command line, with imports found whatever their case', async () => {
        const { root, game, options } = setup();
        const { executable, args } = await papyrusCommand(options(windowsLike));
        const vanilla = path.join(game, 'Data', 'Source', 'Scripts');
        expect(executable).toBe(path.join(game, 'Papyrus Compiler', 'PapyrusCompiler.exe'));
        expect(args).toEqual([
            path.join(root, 'project', 'scripts'), '-all',
            `-f=${path.join(vanilla, 'TESV_Papyrus_Flags.flg')}`,
            `-i=${[path.join(root, 'project', 'scripts'), path.join(root, 'mods', 'SKSE', 'scripts', 'source'), vanilla].join(';')}`,
            `-o=${path.join(root, 'project', 'build', 'Scripts')}`, '-quiet'
        ]);
    });

    it('speaks russo-2025\'s command line when SKYRIM_PAPYRUS_COMPILER names it', async () => {
        const { root, game, options } = setup();
        const compiler = path.join(root, 'tools', 'papyrus-compiler');
        const { executable, args } = await papyrusCommand(options(linuxPlatform(tempDir()), compiler));
        expect(executable).toBe(compiler);
        expect(args).toEqual([
            'compile', '-nocache',
            '-i', path.join(root, 'project', 'scripts'),
            '-o', path.join(root, 'project', 'build', 'Scripts'),
            '-h', path.join(root, 'mods', 'SKSE', 'scripts', 'source'),
            '-h', path.join(game, 'Data', 'Source', 'Scripts')
        ]);
    });

    it('says what to install on Linux when no compiler is named', async () => {
        const { options } = setup();
        const error = await papyrusCommand(options(linuxPlatform(tempDir()))).catch(e => e);
        expect(error).toBeInstanceOf(CompilerUnavailableError);
        expect(error.message).toMatch(/SKYRIM_PAPYRUS_COMPILER/);
    });

    it('refuses the Creation Kit compiler where it cannot run', async () => {
        const { game, options } = setup();
        const ck = path.join(game, 'Papyrus Compiler', 'PapyrusCompiler.exe');
        await expect(papyrusCommand(options(linuxPlatform(tempDir()), ck))).rejects.toThrow(/Windows program/);
        const noDotNet = { ...windowsLike, creationKitCompilerProblem: async () => 'needs .NET Framework 3.5' };
        await expect(papyrusCommand(options(noDotNet))).rejects.toThrow(/\.NET Framework 3\.5/);
    });
});
