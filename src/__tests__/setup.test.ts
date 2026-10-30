import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';
import { checksumMatches, PAPYRUS_COMPILER } from '../setup/compiler';
import { muddyPrompt } from 'skyrim-modding-tools-core';
import { envValue, setEnvValues } from '../setup/envFile';
import { claudeCodeAgent, folderAgentsFile, FOLDER_CLAUDE_FILE, muddyFileState, writeMuddyFile } from '../setup/muddy';
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
    it('is pointed to the OpenClaw plugin, whose own wizard sets it up, and Muddy', () => {
        // The user, 2026-10-25: OpenClaw uses the plugin only; it carries the instructions, the skills and the tools
        // under their own names, which OpenClaw drops, loads apart and prefixes for an MCP server. Its settings are
        // its OpenClaw config, which its wizard writes, not this server's .env.
        const advice = openClawAdvice(false);
        expect(advice).toHaveLength(1);
        expect(advice[0]).toContain('https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin');
        expect(advice[0]).toContain('openclaw skyrim setup');
        expect(advice[0]).not.toContain('.env');
    });

    it('is told to remove this server where an earlier setup registered it, as every tool would be listed twice', () => {
        expect(openClawAdvice(true)[1]).toContain('openclaw config unset mcp.servers.skyrim');
    });
});

describe('Muddy, the modding agent', () => {
    it('is a Claude Code agent with every tool, his description a YAML string, his body the core\'s prompt', () => {
        const [, frontmatter, body] = claudeCodeAgent().split(/^---$/m);
        const fields = Object.fromEntries(frontmatter!.trim().split('\n').map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
        expect(fields.name).toBe('muddy');
        expect(JSON.parse(fields.description!)).toMatch(/^Muddy, the mudcrab who mods Skyrim Special Edition: /);
        expect(fields.model).toBe('inherit');
        expect(fields.tools).toBeUndefined();
        expect(body!.trim()).toBe(muddyPrompt().trim());
    });

    it('is one AGENTS.md for a folder, soul and rules, with a CLAUDE.md that imports it', () => {
        expect(folderAgentsFile()).toMatch(/^# AGENTS\.md - Muddy\n\nYou are Muddy[\s\S]*## How you work/);
        expect(FOLDER_CLAUDE_FILE).toBe('@AGENTS.md\n');
    });

    it('tells a missing file, his own, and one that differs apart', () => {
        const file = path.join(tempDir(), 'agents', 'muddy.md');
        expect(muddyFileState(file, 'his')).toBe('missing');
        writeMuddyFile(file, 'his');
        expect(muddyFileState(file, 'his')).toBe('same');
        expect(muddyFileState(file, 'his, newer')).toBe('differs');
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
