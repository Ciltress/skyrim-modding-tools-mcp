import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackend } from '../backend/index';
import { AMETHYST_FLATPAK_ID, findAmethyst } from '../backend/skyrim/amethyst';
import { currentPlatform, linuxPlatform, windowsPlatform } from '../backend/skyrim/platform';
import { PATH_SETTINGS, pathSetting, readPathSettings, type PathContext } from '../backend/skyrim/pathSettings';
import { PROJECT_ROOT } from '../lib/serverInfo';

/**
 * Every path setting, read as a user writes it — in `.env` or an MCP client's config, where no shell
 * stands between and nothing is expanded on the way — on both systems' sides of platform.ts. The
 * Linux side runs on Windows too, against a home folder that is only a name.
 *
 * The rules are a POSIX shell's for a word (Shell Command Language §2.6.1 tilde expansion, §2.6.2
 * parameter expansion), and `set -u`'s for a variable that is not set.
 */

const linux: PathContext = {
    platform: linuxPlatform(path.join(os.tmpdir(), 'skyrim-mcp-no-proc')),
    home: '/home/me',
    base: '/home/me/skyrim-modding-tools-mcp'
};
const windows: PathContext = {
    platform: windowsPlatform(),
    home: 'C:\\Users\\me',
    base: 'C:\\Tools\\skyrim-modding-tools-mcp'
};

/** A value as SKYRIM_CK_DIR — any path setting is read the same way. */
function read(context: PathContext, value: string, env: NodeJS.ProcessEnv = {}): string | undefined {
    return pathSetting({ ...env, SKYRIM_CK_DIR: value }, 'SKYRIM_CK_DIR', context);
}

describe('a path setting on Linux', () => {
    it.each([
        ['~', '/home/me'],
        ['~/', '/home/me'],
        // The brother's: Amethyst's Flatpak config, written into .env.
        ['~/.var/app/io.github.Amethyst.ModManager/config/AmethystModManager', '/home/me/.var/app/io.github.Amethyst.ModManager/config/AmethystModManager'],
        ['$HOME/tools/papyrus-compiler/papyrus-compiler', '/home/me/tools/papyrus-compiler/papyrus-compiler'],
        ['${HOME}/games', '/home/me/games'],
        ['${XDG_CONFIG_HOME:-$HOME/.config}/AmethystModManager', '/home/me/.config/AmethystModManager'],
        ['${STEAM_LIBRARY:-~/games/Games}/steamapps', '/home/me/games/Games/steamapps'],
        ['${A:-${B:-~/c}}', '/home/me/c'],
        ['/opt/papyrus/', '/opt/papyrus'],
        ['projects', '/home/me/skyrim-modding-tools-mcp/projects'],
        ['./projects/', '/home/me/skyrim-modding-tools-mcp/projects'],
        ['../mods', '/home/me/mods'],
        ['~/games/Games/steamapps/common/Skyrim Special Edition', '/home/me/games/Games/steamapps/common/Skyrim Special Edition'],
        ["~/Bob's Armory", "/home/me/Bob's Armory"],
        ['  ~/padded  ', '/home/me/padded'],
        // A $ that starts no name is a $; a backslash is a letter of a Linux file name.
        ['/srv/$5 mods/cost$', '/srv/$5 mods/cost$'],
        ['~/a\\b', '/home/me/a\\b']
    ])('%s is %s', (value, expected) => {
        expect(read(linux, value)).toBe(expected);
    });

    it('takes HOME, and every other variable, from the environment', () => {
        expect(read(linux, '~/x', { HOME: '/home/other' })).toBe('/home/other/x');
        expect(read(linux, '$HOME/x', { HOME: '/home/other' })).toBe('/home/other/x');
        expect(read(linux, '${XDG_CONFIG_HOME:-$HOME/.config}/AmethystModManager', { XDG_CONFIG_HOME: '/cfg' }))
            .toBe('/cfg/AmethystModManager');
    });

    it.each(['C:\\Games\\Skyrim', 'C:/Games/Skyrim', 'Z:\\home\\me\\Skyrim'])('refuses the Windows path %s, saying how Linux spells it', value => {
        expect(() => read(linux, value)).toThrow(/SKYRIM_CK_DIR=.*Windows path.*Z:\\home\\me is \/home\/me/);
    });
});

describe('a path setting on Windows', () => {
    it.each([
        ['C:\\Games\\Skyrim', 'C:\\Games\\Skyrim'],
        ['C:/Games/Skyrim', 'C:\\Games\\Skyrim'],
        ['G:\\Modding\\SkyrimSE-Test\\', 'G:\\Modding\\SkyrimSE-Test'],
        ['~', 'C:\\Users\\me'],
        ['~\\Documents\\Mods', 'C:\\Users\\me\\Documents\\Mods'],
        ['~/Documents/Mods', 'C:\\Users\\me\\Documents\\Mods'],
        // Windows sets no HOME: it is the home folder, as ~ is.
        ['$HOME\\Mods', 'C:\\Users\\me\\Mods'],
        ['projects', 'C:\\Tools\\skyrim-modding-tools-mcp\\projects'],
        ['..\\mods', 'C:\\Tools\\mods'],
        ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition'],
        ["D:\\Mods\\Bob's Armory", "D:\\Mods\\Bob's Armory"],
        ['\\\\nas\\skyrim\\mods', '\\\\nas\\skyrim\\mods']
    ])('%s is %s', (value, expected) => {
        expect(read(windows, value)).toBe(expected);
    });

    it('takes Windows\' own variables by POSIX names', () => {
        const env = { USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
        expect(read(windows, '${USERPROFILE}\\Mods', env)).toBe('C:\\Users\\me\\Mods');
        expect(read(windows, '$LOCALAPPDATA/Programs/papyrus', env)).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\papyrus');
    });

    it('refuses %NAME%, Windows\' way to name a variable, saying the POSIX way', () => {
        expect(() => read(windows, '%USERPROFILE%\\Mods')).toThrow(/%USERPROFILE%.*\$\{USERPROFILE\}/);
    });
});

describe.each([['Linux', linux], ['Windows', windows]])('on %s', (_name, context) => {
    it('is not set when it is empty, blank, or comes to nothing', () => {
        expect(read(context, '')).toBeUndefined();
        expect(read(context, '   ')).toBeUndefined();
        expect(read(context, '${NOPE-}')).toBeUndefined();
    });

    it('refuses a variable that is not set, naming it and the setting — as set -u does', () => {
        expect(() => read(context, '$NOPE/mods')).toThrow(/SKYRIM_CK_DIR='\$NOPE\/mods'.*\$NOPE.*not set/);
        expect(() => read(context, '${NOPE}/mods')).toThrow(/NOPE.*not set/);
    });

    it('expands a default only when it is used', () => {
        expect(() => read(context, '${HOME:-$NOPE}', { HOME: context.home })).not.toThrow();
    });

    it('says the message ${NAME:?message} carries', () => {
        expect(() => read(context, '${CK:?set CK to the Creation Kit folder}')).toThrow(/CK is not set.*set CK to the Creation Kit folder/);
    });

    it.each(['$(xdg-user-dir GAMES)/Skyrim', '`xdg-user-dir GAMES`/Skyrim'])('never runs the command in %s', value => {
        expect(() => read(context, value)).toThrow(/never runs/);
    });

    it.each(['${#HOME}', '${HOME%/me}', '${HOME/me/you}', '${}'])('refuses %s, which is no path, naming the forms it reads', value => {
        expect(() => read(context, value)).toThrow(/\$\{NAME\}.*\$\{NAME:-default\}/);
    });

    it('refuses a ${ that is never closed', () => {
        expect(() => read(context, '${HOME/mods')).toThrow(/no \}/);
    });

    it('refuses ~name, another user\'s home folder, which it does not look up', () => {
        expect(() => read(context, '~someone/mods')).toThrow(/~someone.*full path/);
    });
});

describe('the operators of POSIX parameter expansion', () => {
    // Shell Command Language §2.6.2's table, with `=` taken as `-`: a setting never changes the environment.
    const env = { SET: 'v', EMPTY: '' };
    it.each([
        //  expression       SET   EMPTY    UNSET
        ['${P:-w}', 'v', 'w', 'w'],
        ['${P-w}', 'v', '', 'w'],
        ['${P:=w}', 'v', 'w', 'w'],
        ['${P=w}', 'v', '', 'w'],
        ['${P:?w}', 'v', Error, Error],
        ['${P?w}', 'v', '', Error],
        ['${P:+w}', 'w', '', ''],
        ['${P+w}', 'w', 'w', '']
    ])('%s gives %s, %s, %s for a set, an empty, an unset P', (expression, set, empty, unset) => {
        const cases: Array<[string, string | ErrorConstructor]> = [['SET', set], ['EMPTY', empty], ['UNSET', unset]];
        for (const [name, expected] of cases) {
            const value = `/x/${expression.replace('P', name)}`;
            if (expected === Error) expect(() => read(linux, value, env)).toThrow(/not set|empty/);
            else expect(read(linux, value, env)).toBe(path.posix.resolve(`/x/${expected}`));
        }
    });
});

describe('every path setting goes through the one resolver', () => {
    it.each(PATH_SETTINGS)('%s is expanded and made absolute on both systems', name => {
        expect(readPathSettings({ [name]: '~/x' }, linux)[name]).toBe('/home/me/x');
        expect(readPathSettings({ [name]: 'x' }, windows)[name]).toBe('C:\\Tools\\skyrim-modding-tools-mcp\\x');
        expect(readPathSettings({}, linux)[name]).toBeUndefined();
    });

    /** Every environment variable src/ reads by a name in the code, as serverManifest.test.ts finds them. */
    function variablesReadBySource(): Map<string, string[]> {
        const found = new Map<string, string[]>();
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== '__tests__') walk(full);
                } else if (entry.name.endsWith('.ts')) {
                    for (const match of fs.readFileSync(full, 'utf8').matchAll(/\benv(?:\.|\[["'])([A-Z][A-Z_0-9]{2,})/g)) {
                        found.set(match[1], [...(found.get(match[1]) ?? []), path.relative(PROJECT_ROOT, full)]);
                    }
                }
            }
        };
        walk(path.join(PROJECT_ROOT, 'src'));
        return found;
    }

    /**
     * The variables read in src/ that hold no path this server resolves. A variable added later fails
     * the test below until it is put here or into PATH_SETTINGS — so a new path setting cannot skip the
     * resolver by accident.
     */
    const NOT_PATH_SETTINGS = [
        // Names, keys, numbers and switches.
        'SKYRIM_MOD_MANAGER', 'NEXUS_API_KEY', 'SKYRIM_ACCEPTED_TOKENS',
        'MCP_PROFILE', 'MCP_MAX_RESPONSE_BYTES', 'MCP_GATE', 'MCP_TRANSPORT',
        'MCP_HTTP_PORT', 'MCP_HTTP_HOST', 'MCP_HTTP_ALLOWED_ORIGINS', 'MCP_HTTP_ALLOWED_HOSTS', 'MCP_HTTP_RATE_LIMIT',
        // The system's and Amethyst's own, read exactly as Amethyst reads them, to find its files where it looks.
        'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'MOD_MANAGER_PROFILES_DIR',
        // The system's search path, a list of folders searched for a Papyrus compiler (Platform.papyrusCompilerCandidates).
        'PATH',
        // Windows' own folders, read by npm run setup to find Claude Desktop's and Mod Organizer's files.
        'APPDATA', 'LOCALAPPDATA'
    ];

    it('reads a path setting nowhere but in pathSettings.ts, and knows every other variable for one that is not', () => {
        const read = variablesReadBySource();
        const pathSettingsReadElsewhere = PATH_SETTINGS.filter(name => read.has(name)).map(name => `${name} in ${read.get(name)}`);
        const unclassified = [...read.keys()].filter(name => !NOT_PATH_SETTINGS.includes(name) && !(PATH_SETTINGS as readonly string[]).includes(name));
        expect({ pathSettingsReadElsewhere, unclassified }).toEqual({ pathSettingsReadElsewhere: [], unclassified: [] });
    });

    it('builds the backend from resolved paths: ~ is the home folder, a relative path the server\'s folder', () => {
        const flatpakDir = `~/.var/app/${AMETHYST_FLATPAK_ID}/config/AmethystModManager`;
        expect(createBackend({ SKYRIM_MOD_MANAGER: 'amethyst', SKYRIM_AMETHYST_DIR: flatpakDir }).describe())
            .toContain(path.join(os.homedir(), '.var', 'app', AMETHYST_FLATPAK_ID, 'config', 'AmethystModManager'));
        expect(createBackend({ SKYRIM_MO2_INSTANCE: '~/Games/mo2' }).describe())
            .toContain(path.join(os.homedir(), 'Games', 'mo2'));
        expect(createBackend({ SKYRIM_MO2_INSTANCE: 'test-instance' }).describe())
            .toContain(path.join(PROJECT_ROOT, 'test-instance'));
    });

    it('knows the Flatpak by the resolved folder, so its command line is run through flatpak', () => {
        const home = path.join(os.tmpdir(), 'someone');
        const configured = pathSetting({ SKYRIM_AMETHYST_DIR: `~/.var/app/${AMETHYST_FLATPAK_ID}/config/AmethystModManager` },
            'SKYRIM_AMETHYST_DIR', { platform: currentPlatform(), home, base: PROJECT_ROOT });
        expect(findAmethyst(configured, {}, home)).toEqual({
            configDir: path.join(home, '.var', 'app', AMETHYST_FLATPAK_ID, 'config', 'AmethystModManager'),
            flatpak: true
        });
    });
});
