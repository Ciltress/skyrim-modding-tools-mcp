import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';
import { checksumMatches, PAPYRUS_COMPILER } from '../setup/compiler';
import { envValue, setEnvValues } from '../setup/envFile';
import { skyrimInstances } from '../setup/mo2Instances';
import type { AppBackend } from '../backend';
import { createHandlers } from '../handlers';
import { discoverSkills, FAMILY_SKILLS } from '../lib/skills';
import {
    claudeCodeArgs, desktopConfigWithServer, OPENCLAW_AGENT, OPENCLAW_AGENT_TOOLS, openClawPatch, openClawWorkspaceFiles, SERVER_NAME, vsCodeArgs
} from '../setup/registration';
import { installCommand, windowsCommandLine } from '../setup/system';

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

describe('registering the server with OpenClaw', () => {
    const root = path.join('C:\\Tools', 'skyrim-modding-tools-mcp');
    const place = {
        entry: path.join(root, 'dist', 'index.js'),
        skillsDir: path.join(root, 'skills', 'Domain'),
        skills: ['skyrim-modding-basics', 'skyrim-modding-magic'],
        projectsDir: path.join(root, 'projects'),
        workspace: path.join('C:\\Users\\me', '.openclaw', 'workspace'),
        agentWorkspace: path.join('C:\\Users\\me', '.openclaw', 'workspace-skyrim')
    };
    type Patch = { mcp: unknown; skills: { load: { extraDirs: string[] } }; agents: { entries: Record<string, unknown> } };
    const patchFor = (current: Parameters<typeof openClawPatch>[0]) => openClawPatch(current, place) as Patch;

    it('adds the server, its skills folder, and an agent for modding with the skills, only the tools it needs, and a workspace of its own', () => {
        const patch = patchFor({ agents: { entries: { main: { workspace: 'D:\\claw' } } }, skills: { entries: { weather: { enabled: true } } } });
        expect(patch.mcp).toEqual({ servers: { skyrim: { command: 'node', args: [place.entry] } } });
        expect(patch.skills).toEqual({ load: { extraDirs: [place.skillsDir] } });
        expect(patch.agents.entries).toEqual({
            [OPENCLAW_AGENT]: {
                name: 'Skyrim Modding',
                workspace: place.agentWorkspace,
                cwd: place.projectsDir,
                skills: place.skills,
                thinkingDefault: 'max',
                tools: { allow: ['read', 'write', 'edit', 'apply_patch', 'ls', 'skills_read', 'skyrim__*'] }
            }
        });
    });

    it('keeps the skill folders OpenClaw already loads, and adds its own once', () => {
        expect(patchFor({ skills: { load: { extraDirs: ['~/my-skills'] } } }).skills.load.extraDirs).toEqual(['~/my-skills', place.skillsDir]);
        expect(patchFor({ skills: { load: { extraDirs: [place.skillsDir.toUpperCase(), '~/my-skills'] } } }).skills.load.extraDirs)
            .toEqual([place.skillsDir.toUpperCase(), '~/my-skills']);
    });

    it('leaves an agent of that name as the user has made it, and registers the server again', () => {
        const patch = patchFor({ agents: { entries: { main: { workspace: 'D:\\claw' }, skyrim: { tools: { allow: ['read', 'skyrim__*', 'web_search'] } } } } });
        expect(patch.agents.entries).toEqual({});
        expect(patch.mcp).toEqual({ servers: { skyrim: { command: 'node', args: [place.entry] } } });
    });

    it('keeps the one agent there was in its workspace, which a second agent would move into a subfolder', () => {
        expect(patchFor({ agents: { entries: { main: { name: 'Main' } } } }).agents.entries.main).toEqual({ workspace: place.workspace });
        expect(patchFor({ agents: { defaults: { workspace: 'D:\\claw' }, entries: { main: {} } } }).agents.entries.main).toEqual({ workspace: 'D:\\claw' });
        // No agent configured: OpenClaw's implicit one is `main`.
        expect(patchFor({}).agents.entries.main).toEqual({ workspace: place.workspace });
        expect(patchFor({ agents: { entries: { a: {}, b: {} } } }).agents.entries).not.toHaveProperty('a');
    });
});

describe('the modding agent\'s workspace files', () => {
    const files = openClawWorkspaceFiles('the Mod Organizer instance at G:\\Modding\\SkyrimSE-Test', '2026-10-18');
    const all = Object.values(files).join('\n');

    it('are the four OpenClaw puts into an agent\'s prompt, each short', () => {
        expect(Object.keys(files)).toEqual(['AGENTS.md', 'SOUL.md', 'USER.md', 'IDENTITY.md']);
        for (const text of Object.values(files)) expect(text.length).toBeLessThan(4000);
    });

    it('name only tools the agent has: the server\'s, under OpenClaw\'s prefix, and those setup allows it', () => {
        const served = new Set([...createHandlers(undefined as unknown as AppBackend).flatMap(h => h.getTools()).map(t => t.name), 'healthcheck']);
        const named = [...all.matchAll(/`skyrim__(\w+)`/g)].map(m => m[1]);
        expect(named.length).toBeGreaterThan(8);
        for (const name of named) expect(served, name).toContain(name);
        for (const [, name] of all.matchAll(/`(read|write|edit|ls|apply_patch|skills_read)`/g)) expect(OPENCLAW_AGENT_TOOLS).toContain(name);
    });

    it('name only skills there are, and the server\'s families of records', () => {
        const skills = new Set(discoverSkills().filter(s => s.collection === 'domain').map(s => s.name));
        for (const [name] of all.matchAll(/skyrim-modding-[a-z-]+/g)) expect(skills, name).toContain(name);
        for (const family of FAMILY_SKILLS) expect(files['AGENTS.md']).toContain(family.skill);
    });

    it('tell the agent the instance it works on, in OpenClaw\'s directive form, and do without one not configured yet', () => {
        expect(files['USER.md']).toContain('<!-- observed: 2026-10-18 | status: active -->\n\n- Always work on the instance the Skyrim server is bound to ' +
            '(the Mod Organizer instance at G:\\Modding\\SkyrimSE-Test)');
        expect(openClawWorkspaceFiles(undefined, '2026-10-18')['USER.md']).toContain('bound to; never change another instance');
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
