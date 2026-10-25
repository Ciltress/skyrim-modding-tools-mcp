import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';
import { checksumMatches, PAPYRUS_COMPILER } from '../setup/compiler';
import { envValue, setEnvValues } from '../setup/envFile';
import { skyrimInstances } from '../setup/mo2Instances';
import { claudeCodeArgs, desktopConfigWithServer, openClawAdvice, SERVER_NAME, vsCodeArgs } from '../setup/registration';
import { helperHolders, installCommand, windowsCommandLine } from '../setup/system';

/**
 * `npm run setup`'s parts that decide something: what it writes into `.env` and Claude Desktop's config,
 * the commands it runs to register the server and install what is missing, the instances it offers.
 * The steps that run programs are run once against this machine instead (AGENTS.md).
 */

const roots: string[] = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-setup-'));
    roots.push(dir);
    return dir;
}
function write(file: string, text = ''): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

describe('.env', () => {
    const example = [
        '# The mod manager: mo2 or amethyst.',
        '#SKYRIM_MOD_MANAGER=amethyst',
        '',
        '# With mo2, required: the instance folder.',
        'SKYRIM_MO2_INSTANCE=G:\\Modding\\SkyrimSE-Test',
        '',
        '#NEXUS_API_KEY=',
        ''
    ].join('\n');

    it('replaces a value, fills a commented-out line, and keeps every other line', () => {
        const text = setEnvValues(example, { SKYRIM_MO2_INSTANCE: 'D:\\MO2\\Skyrim', NEXUS_API_KEY: 'abc123' });
        expect(text).toBe(example
            .replace('SKYRIM_MO2_INSTANCE=G:\\Modding\\SkyrimSE-Test', 'SKYRIM_MO2_INSTANCE=D:\\MO2\\Skyrim')
            .replace('#NEXUS_API_KEY=', 'NEXUS_API_KEY=abc123'));
        expect(parse(text)).toEqual({ SKYRIM_MO2_INSTANCE: 'D:\\MO2\\Skyrim', NEXUS_API_KEY: 'abc123' });
    });

    it('adds a variable it has no line for at the end', () => {
        expect(setEnvValues('A=1', { SKYRIM_CK_DIR: '/games/ck' })).toBe('A=1\nSKYRIM_CK_DIR=/games/ck\n');
        expect(setEnvValues('', { A: '1' })).toBe('A=1\n');
    });

    it('writes a value so dotenv reads it back as given: Windows paths, apostrophes, spaces, a #', () => {
        for (const value of ['G:\\Modding\\Skyrim SE', "C:\\Mods\\Bob's Armory", '/home/me/Mods #1', ' padded ', 'say "hi"']) {
            expect(parse(`X=${envValue(value)}`).X).toBe(value);
        }
        expect(envValue('G:\\Modding\\SkyrimSE-Test')).toBe('G:\\Modding\\SkyrimSE-Test');
    });
});

describe('registering the server', () => {
    const entry = path.join('C:\\Tools', 'skyrim-modding-tools-mcp', 'dist', 'index.js');

    it('registers with Claude Code for every folder, under one name', () => {
        expect(SERVER_NAME).toBe('skyrim');
        expect(claudeCodeArgs(entry)).toEqual(['mcp', 'add', '--scope', 'user', 'skyrim', '--', 'node', entry]);
    });

    it('registers with VS Code through its own --add-mcp', () => {
        const [flag, json] = vsCodeArgs(entry);
        expect(flag).toBe('--add-mcp');
        expect(JSON.parse(json)).toEqual({ name: 'skyrim', command: 'node', args: [entry] });
    });

    it('adds the server to Claude Desktop\'s config, keeping everything else, and replaces only its own entry', () => {
        const before = JSON.stringify({ mcpServers: { other: { command: 'npx', args: ['x'] }, skyrim: { command: 'old' } }, theme: 'dark' });
        const after = JSON.parse(desktopConfigWithServer(before, entry));
        expect(after).toEqual({
            mcpServers: { other: { command: 'npx', args: ['x'] }, skyrim: { command: 'node', args: [entry] } },
            theme: 'dark'
        });
        expect(JSON.parse(desktopConfigWithServer(undefined, entry))).toEqual({ mcpServers: { skyrim: { command: 'node', args: [entry] } } });
        expect(JSON.parse(desktopConfigWithServer('', entry)).mcpServers.skyrim.command).toBe('node');
    });

    it('leaves a Claude Desktop config it cannot read alone, saying so', () => {
        expect(() => desktopConfigWithServer('{ "mcpServers": ', entry)).toThrow(/cannot be read as JSON.*left as it is/);
        expect(() => desktopConfigWithServer('[1, 2]', entry)).toThrow(/left as it is/);
    });
});

describe('OpenClaw', () => {
    const envFile = path.join('C:\\Tools', 'skyrim-modding-tools-mcp', '.env');

    it('is pointed to the OpenClaw plugin, which can share this server\'s .env', () => {
        // The user, 2026-10-25: OpenClaw uses the plugin only; it carries the instructions, the skills and the tools
        // under their own names, which OpenClaw drops, loads apart and prefixes for an MCP server.
        const advice = openClawAdvice(envFile, false);
        expect(advice).toHaveLength(1);
        expect(advice[0]).toContain('https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin');
        expect(advice[0]).toContain(envFile);
    });

    it('is told to remove this server where an earlier setup registered it, as every tool would be listed twice', () => {
        expect(openClawAdvice(envFile, true)[1]).toContain('openclaw config unset mcp.servers.skyrim');
    });
});

describe('a helper in use', () => {
    const dir = path.join('C:\\Tools', 'skyrim-modding-tools-mcp', 'helper', 'bin');
    const program = (pid: number, parentPid: number, name: string, commandLine: string) => ({ pid, parentPid, name, commandLine });

    it('names what started each server whose helper runs from the folder, once each, and a helper whose server is gone', () => {
        const programs = [
            program(1, 0, 'explorer.exe', 'C:\\Windows\\Explorer.EXE'),
            program(10, 1, 'claude.exe', 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\claude.exe'),
            program(11, 10, 'node.exe', 'node C:\\Tools\\skyrim-modding-tools-mcp\\dist\\index.js'),
            program(12, 11, 'SkyrimHelper.exe', `"${path.join(dir, 'SkyrimHelper.exe')}"`),
            program(13, 10, 'node.exe', 'node C:\\Tools\\skyrim-modding-tools-mcp\\dist\\index.js'),
            program(14, 13, 'SkyrimHelper.exe', path.join(dir, 'SkyrimHelper.exe').toUpperCase()),
            program(20, 99, 'SkyrimHelper.exe', path.join(dir, 'SkyrimHelper.exe')),
            program(30, 1, 'SkyrimHelper.exe', 'D:\\elsewhere\\helper\\bin\\SkyrimHelper.exe')
        ];
        expect(helperHolders(programs, dir).map(p => p.pid)).toEqual([10, 20]);
        expect(helperHolders(programs.filter(p => p.name !== 'SkyrimHelper.exe'), dir)).toEqual([]);
    });
});

describe('Mod Organizer\'s instances', () => {
    it('offers the global instances that manage Skyrim Special Edition, and no others', () => {
        const root = tempDir();
        write(path.join(root, 'Skyrim SE', 'ModOrganizer.ini'), '[General]\ngameName=Skyrim Special Edition\n');
        write(path.join(root, 'Fallout', 'ModOrganizer.ini'), '[General]\ngameName=Fallout 4\n');
        write(path.join(root, 'Broken', 'notes.txt'), 'no ini');
        write(path.join(root, 'LoreRim', 'ModOrganizer.ini'), '[General]\r\ngameName=Skyrim Special Edition\r\n');
        expect(skyrimInstances(root)).toEqual([path.join(root, 'LoreRim'), path.join(root, 'Skyrim SE')]);
        expect(skyrimInstances(path.join(root, 'nowhere'))).toEqual([]);
    });
});

describe('installing what is missing', () => {
    it('names the packages for each system\'s package manager', () => {
        expect(installCommand('pacman', ['dotnet'])).toEqual(['sudo', 'pacman', '-S', '--needed', '--noconfirm', 'dotnet-sdk']);
        expect(installCommand('apt-get', ['dotnet'])).toEqual(['sudo', 'apt-get', 'install', '-y', 'dotnet-sdk-10.0']);
        expect(installCommand('dnf', ['dotnet'])).toEqual(['sudo', 'dnf', 'install', '-y', 'dotnet-sdk-10.0']);
        expect(installCommand('winget', ['dotnet'])).toEqual(
            ['winget', 'install', '--exact', '--id', 'Microsoft.DotNet.SDK.10', '--accept-package-agreements', '--accept-source-agreements']);
    });

    it('starts a program the Windows way, quoting what cmd.exe and the program would split', () => {
        expect(windowsCommandLine('code', ['--add-mcp', '{"name":"skyrim","args":["C:\\Users\\Some One\\x.js"]}']))
            .toBe('code --add-mcp "{\\"name\\":\\"skyrim\\",\\"args\\":[\\"C:\\Users\\Some One\\x.js\\"]}"');
        expect(windowsCommandLine('claude', ['mcp', 'add', '--', 'node', 'C:\\Program Files\\x\\'])).toBe('claude mcp add -- node "C:\\Program Files\\x\\\\"');
    });
});

describe('the Papyrus compiler download', () => {
    it('pins one release of russo-2025\'s compiler, and takes the file only when its checksum matches', () => {
        expect(PAPYRUS_COMPILER.url).toMatch(/^https:\/\/github\.com\/russo-2025\/papyrus-compiler\/releases\/download\/[\d.]+\/papyrus-compiler-ubuntu\.tar\.gz$/);
        expect(PAPYRUS_COMPILER.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(PAPYRUS_COMPILER.executable).toBe(path.join('papyrus-compiler', 'papyrus'));
        const bytes = Buffer.from('a tarball');
        const sum = crypto.createHash('sha256').update(bytes).digest('hex');
        expect(checksumMatches(bytes, sum)).toBe(true);
        expect(checksumMatches(Buffer.from('something else'), sum)).toBe(false);
    });
});
