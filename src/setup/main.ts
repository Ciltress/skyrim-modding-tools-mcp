#!/usr/bin/env node

/**
 * `npm run setup`: everything after `git clone`, for a modder who is not a developer, and the same
 * command after each `git pull`. package.json has already run `npm ci` — exactly what the lockfile
 * says, which it never changes, so a later `git pull` meets no local edit — and `npm run build` (Node is
 * all those need); this does the rest, asking only what it cannot find:
 *
 *   1. the .NET 10 SDK, installed after a yes;
 *   2. the plugin helper, built and started once;
 *   3. the settings — the Mod Organizer instance where none is found, the optional Nexus key — written
 *      into `.env`, keeping what is there;
 *   4. on Linux, a Papyrus compiler, downloaded after a yes;
 *   5. the vanilla script sources, unpacked after a yes where that is safe;
 *   6. the server registered with Claude Code, VS Code and Claude Desktop, each after a yes; OpenClaw
 *      pointed to the OpenClaw plugin, which serves it the same tools;
 *   7. Muddy, the modding agent, after a yes: a Claude Code agent, which VS Code lists too, and his
 *      instructions in the projects folder, for the clients that read a folder's AGENTS.md;
 *   8. a healthcheck through the built server, as a client starts it.
 *
 * Run where no one can answer — an agent running it for the user — it asks nothing, skips what needs a
 * yes, and ends with the list of what is left. `--instance <folder>` names the Mod Organizer instance.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parse } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
    chooseModManager, CORE_ROOT, currentPlatform, findCaseInsensitive, InstanceConfigError, pathSetting, readConfiguration,
    skyrimInstances, SOURCE_FOLDERS
} from 'skyrim-modding-tools-core';
import { PROJECT_ROOT, SERVER_INFO } from '../lib/serverInfo.js';
import { downloadCompiler } from './compiler.js';
import { setEnvValues } from './envFile.js';
import { claudeCodeAgent, folderAgentsFile, FOLDER_CLAUDE_FILE, muddyFileState, writeMuddyFile } from './muddy.js';
import { claudeCodeArgs, desktopConfigWithServer, openClawAdvice, SERVER_NAME, vsCodeArgs } from './registration.js';
import { helperHolders, installCommand, setupSystem, type RunningProgram, type SetupSystem } from './system.js';

const ENTRY = path.join(PROJECT_ROOT, 'dist', 'index.js');
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

// ---------------------------------------------------------------- asking

interface Ui {
    readonly interactive: boolean;
    say(text: string): void;
    step(title: string): void;
    /** Yes on Enter; never yes where no one can answer. */
    yes(question: string): Promise<boolean>;
    /** A line typed; empty where no one can answer. */
    text(question: string, hidden?: boolean): Promise<string>;
    close(): void;
}

function terminalUi(): Ui {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const muted = rl as unknown as { _writeToOutput: (s: string) => void };
    return {
        interactive: true,
        say: text => console.log(text),
        step: title => console.log(`\n== ${title}`),
        yes: async question => /^(|y|yes|j|ja)$/i.test((await rl.question(`${question} [Y/n] `)).trim()),
        async text(question, hidden = false) {
            if (!hidden) return (await rl.question(`${question} `)).trim();
            // A key typed is not shown, so it stays off the screen and out of a screenshot.
            process.stdout.write(`${question} `);
            const write = muted._writeToOutput;
            muted._writeToOutput = () => { };
            try {
                return (await rl.question('')).trim();
            } finally {
                muted._writeToOutput = write;
                process.stdout.write('\n');
            }
        },
        close: () => rl.close()
    };
}

function unattendedUi(): Ui {
    return {
        interactive: false,
        say: text => console.log(text),
        step: title => console.log(`\n== ${title}`),
        yes: async () => false,
        text: async () => '',
        close: () => { }
    };
}

// ---------------------------------------------------------------- the steps

interface Run {
    ui: Ui;
    system: SetupSystem;
    /** What is left to do, said at the end. */
    left: string[];
    instanceArg?: string;
}

const display = (command: readonly string[]) => command.map(a => /\s/.test(a) ? `"${a}"` : a).join(' ');

/**
 * 1. The .NET 10 SDK, which builds the helper — the one prerequisite setup installs. Git LFS is not one:
 * the projects folder's `.gitattributes` sends meshes and textures to it where it is installed, and git
 * keeps them as ordinary files where it is not.
 */
async function prerequisites(run: Run): Promise<boolean> {
    const { ui, system, left } = run;
    const dotnet = async () => /^10\./m.test((await system.run('dotnet', ['--list-sdks'], { capture: true })).stdout);
    if (await dotnet()) {
        ui.say('The .NET 10 SDK is installed.');
        return true;
    }
    const manager = await system.packageManager();
    if (!manager) {
        left.push('Install the .NET 10 SDK (https://dotnet.microsoft.com/download), then run npm run setup again.');
        return false;
    }
    const command = installCommand(manager, ['dotnet']);
    if (!await ui.yes(`The .NET 10 SDK is missing. Install now? This runs: ${display(command)}`)) {
        left.push(`Install the .NET 10 SDK: ${display(command)} — then run npm run setup again.`);
        return false;
    }
    await system.run(command[0], command.slice(1));
    if (!await dotnet()) {
        // winget changes PATH for terminals opened after it, not for this one.
        left.push('The .NET SDK is not found yet: open a new terminal and run npm run setup again.');
        return false;
    }
    return true;
}

/**
 * 2. The plugin helper: built, then started once to see it answers. A helper that a running server uses
 * cannot be replaced; then the programs that started those servers are named, to be closed first.
 */
async function helper(run: Run): Promise<void> {
    const { ui, system, left } = run;
    const built = await system.run('npm', ['run', 'build:helper'], { cwd: CORE_ROOT });
    const holders = built.code === 0 ? [] : helperHolders(await system.processes(), path.join(CORE_ROOT, 'helper', 'bin'));
    if (holders.length > 0) {
        left.push(`The plugin helper could not be replaced while a running Skyrim server uses it. Close what started ` +
            `${holders.length === 1 ? 'it' : 'them'}, then run npm run setup again: ${holders.map(describeProgram).join('; ')}.`);
        return;
    }
    const checked = built.code === 0 && (await system.run('npm', ['run', 'check:helper'], { cwd: CORE_ROOT })).code === 0;
    if (checked) ui.say('The plugin helper is built and answers.');
    else left.push('The plugin helper did not build or start: see the output above, then run npm run setup again.');
}

/** A program as a person finds it among their windows: its name, its PID, how it was started — OpenClaw's gateway by the command that stops it. */
function describeProgram(program: RunningProgram): string {
    if (/openclaw/i.test(program.commandLine)) return `OpenClaw's gateway (${program.name}, PID ${program.pid}): openclaw gateway stop`;
    const started = program.commandLine.trim();
    return `${program.name} (PID ${program.pid}${started ? `: ${started.length > 120 ? `${started.slice(0, 120)}…` : started}` : ''})`;
}

/** The settings as the server will read them: its process's environment over `.env`. */
function currentEnv(): NodeJS.ProcessEnv {
    const file = fs.existsSync(ENV_FILE) ? parse(fs.readFileSync(ENV_FILE, 'utf8')) : {};
    return { ...file, ...process.env };
}

/** 3. What `.env` needs: the Mod Organizer instance where nothing is configured, and the optional Nexus key. */
async function settings(run: Run): Promise<void> {
    const { ui, left } = run;
    const env = currentEnv();
    const values: Record<string, string> = {};
    const choice = chooseModManager(env);
    const configured = readConfiguration(env, { root: PROJECT_ROOT });
    if (choice.name === 'amethyst') {
        ui.say(`Amethyst: ${configured.modManager.describe()}.`);
    } else if (configured.paths.SKYRIM_MO2_INSTANCE && !run.instanceArg) {
        ui.say(`Mod Organizer: ${configured.modManager.describe()}.`);
    } else {
        const instance = await askInstance(run, env);
        if (instance) values.SKYRIM_MO2_INSTANCE = instance;
        else left.push('Name your Mod Organizer instance: npm run setup -- --instance "<the folder with ModOrganizer.ini>" — or, ' +
            'with Amethyst, set Skyrim Special Edition up in Amethyst and run npm run setup again.');
    }

    if (!env.NEXUS_API_KEY?.trim()) {
        const key = ui.interactive
            ? await ui.text('Your Nexus Mods API key, to download through Nexus with a premium account (https://www.nexusmods.com/settings/api-keys) — Enter skips:', true)
            : '';
        if (key) values.NEXUS_API_KEY = key;
        else if (!ui.interactive) left.push('Optional: put a premium account\'s Nexus Mods API key into .env as NEXUS_API_KEY=… to download through Nexus.');
    }

    if (Object.keys(values).length > 0 || !fs.existsSync(ENV_FILE)) {
        const base = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : fs.readFileSync(path.join(PROJECT_ROOT, '.env.example'), 'utf8');
        fs.writeFileSync(ENV_FILE, setEnvValues(base, values));
        ui.say(`Written to ${ENV_FILE}: ${Object.keys(values).join(', ') || 'the settings file'}.`);
    }
}

/** A Mod Organizer instance: --instance, or one of the global ones found, or a folder pasted — each checked as the server reads it. */
async function askInstance(run: Run, env: NodeJS.ProcessEnv): Promise<string | undefined> {
    const { ui, system } = run;
    const check = (typed: string): string | undefined => {
        const folder = typed.replace(/^\s*["']|["']\s*$/g, '').trim();
        if (!folder) return undefined;
        try {
            const resolved = pathSetting({ SKYRIM_MO2_INSTANCE: folder }, 'SKYRIM_MO2_INSTANCE',
                { platform: currentPlatform(), home: os.homedir(), base: PROJECT_ROOT })!;
            readConfiguration({ ...env, SKYRIM_MOD_MANAGER: 'mo2', SKYRIM_MO2_INSTANCE: resolved }, { root: PROJECT_ROOT }).modManager.readInstance();
            return resolved;
        } catch (error) {
            ui.say(error instanceof InstanceConfigError || error instanceof Error ? error.message : String(error));
            return undefined;
        }
    };
    if (run.instanceArg) return check(run.instanceArg);
    if (!ui.interactive) return undefined;
    const instancesDir = system.mo2InstancesDir(env);
    const found = instancesDir ? skyrimInstances(instancesDir) : [];
    for (; ;) {
        if (found.length > 0) {
            ui.say('Mod Organizer instances for Skyrim Special Edition found:');
            found.forEach((dir, i) => ui.say(`  ${i + 1}. ${dir}`));
        }
        const typed = await ui.text(found.length > 0
            ? 'Type a number, or paste the folder of another instance (the one with ModOrganizer.ini) — Enter skips:'
            : 'Paste your Mod Organizer instance folder (the one with ModOrganizer.ini) — Enter skips:');
        if (!typed) return undefined;
        const picked = /^\d+$/.test(typed) ? found[Number(typed) - 1] : typed;
        const instance = picked ? check(picked) : undefined;
        if (instance) return instance;
    }
}

/** 4. Linux has no Creation Kit compiler: russo-2025's, downloaded where the server looks first. */
async function compiler(run: Run): Promise<void> {
    const { ui, system, left } = run;
    const { paths, papyrusCompilerCandidates } = readConfiguration(currentEnv(), { root: PROJECT_ROOT });
    if (papyrusCompilerCandidates.length === 0) {
        ui.say('Scripts are compiled with the Creation Kit\'s own Papyrus compiler.');
        return;
    }
    const found = paths.SKYRIM_PAPYRUS_COMPILER ?? papyrusCompilerCandidates.find(file => fs.existsSync(file));
    if (found) {
        ui.say(`Papyrus compiler: ${found}.`);
        return;
    }
    if (!await ui.yes('No Papyrus compiler found. Download russo-2025\'s papyrus-compiler (about 1 MB, from GitHub) into the server\'s tools folder?')) {
        left.push('For projects with scripts: run npm run setup again and download the Papyrus compiler, or set SKYRIM_PAPYRUS_COMPILER in .env.');
        return;
    }
    try {
        ui.say(`Papyrus compiler: ${await downloadCompiler(path.join(PROJECT_ROOT, 'tools'), system)}.`);
    } catch (error) {
        left.push(`${(error as Error).message} Run npm run setup again later.`);
    }
}

/** 5. The vanilla script sources a script's imports need, unpacked from the Creation Kit's Scripts.zip. */
async function scriptSources(run: Run): Promise<void> {
    const { ui, system, left } = run;
    let configured;
    let gameDir;
    try {
        configured = readConfiguration(currentEnv(), { root: PROJECT_ROOT });
        gameDir = configured.modManager.readInstance().gameDir;
    } catch {
        return; // No instance yet: said in the settings step.
    }
    const ckDir = configured.paths.SKYRIM_CK_DIR ?? gameDir;
    if (SOURCE_FOLDERS.some(folder => findCaseInsensitive(ckDir, folder))) {
        ui.say('The vanilla script sources are unpacked.');
        return;
    }
    const zip = findCaseInsensitive(ckDir, 'Data/Scripts.zip');
    if (!zip) {
        left.push('For projects with scripts: install "Skyrim Special Edition: Creation Kit" in Steam (it brings Data/Scripts.zip), then run npm run setup again.');
        return;
    }
    // Amethyst counts files that appear in a deployed Data as the game's output, and moves them at its next restore.
    if (configured.modManager.name === 'amethyst') {
        left.push(`For projects with scripts: in Amethyst press Restore, unpack ${zip} into ${path.dirname(zip)} ` +
            `(cd "${path.dirname(zip)}" && unzip -n Scripts.zip), then press Deploy.`);
        return;
    }
    if (!await ui.yes(`Unpack the vanilla script sources from ${zip}, which projects with scripts need?`)) {
        left.push(`For projects with scripts: unpack ${zip} into ${path.dirname(zip)}.`);
        return;
    }
    if (await system.extractZip(zip, path.dirname(zip))) ui.say('The vanilla script sources are unpacked.');
    else left.push(`Unpacking ${zip} failed: unpack it into ${path.dirname(zip)} by hand.`);
}

/** 6. The clients: no settings in any registration, only the command that starts the server. */
async function register(run: Run): Promise<void> {
    const { ui, system, left } = run;
    const home = os.homedir();

    if (await system.has('claude')) {
        if (await ui.yes('Register the server with Claude Code, for every folder?')) {
            await system.run('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME], { capture: true });
            const added = await system.run('claude', claudeCodeArgs(ENTRY), { capture: true });
            if (added.code === 0) ui.say('Registered with Claude Code.');
            else left.push(`Registering with Claude Code failed: run claude ${display(claudeCodeArgs(ENTRY))}`);
        } else if (!ui.interactive) {
            left.push(`To register with Claude Code: claude ${display(claudeCodeArgs(ENTRY))}`);
        }
    }

    if (await system.has('code')) {
        if (await ui.yes('Register the server with VS Code?')) {
            const added = await system.run('code', vsCodeArgs(ENTRY), { capture: true });
            if (added.code === 0) ui.say('Registered with VS Code.');
            else left.push(`Registering with VS Code failed: add it in VS Code with "MCP: Add Server…", command node ${ENTRY}.`);
        } else if (!ui.interactive) {
            // Not as a command: PowerShell 5.1 drops the quotes inside an argument it hands a program.
            left.push(`To register with VS Code: run "MCP: Open User Configuration" in VS Code, and add under "servers": ` +
                `"${SERVER_NAME}": ${JSON.stringify({ type: 'stdio', command: 'node', args: [ENTRY] })}`);
        }
    }

    const desktop = system.claudeDesktopConfig(home, process.env);
    if (desktop) {
        if (await ui.yes(`Register the server with Claude Desktop (in ${desktop})?`)) {
            try {
                const before = fs.existsSync(desktop) ? fs.readFileSync(desktop, 'utf8') : undefined;
                const after = desktopConfigWithServer(before, ENTRY);
                if (before !== after) {
                    if (before !== undefined) fs.writeFileSync(`${desktop}.bak`, before);
                    fs.writeFileSync(desktop, after);
                }
                ui.say(`Registered with Claude Desktop${before !== undefined ? ` (the old file is kept as ${desktop}.bak)` : ''}.`);
            } catch (error) {
                left.push(`${(error as Error).message} Add the server in ${desktop} by hand: "${SERVER_NAME}": { "command": "node", "args": [${JSON.stringify(ENTRY)}] }.`);
            }
        } else if (!ui.interactive) {
            left.push(`To register with Claude Desktop: add "${SERVER_NAME}": { "command": "node", "args": [${JSON.stringify(ENTRY)}] } to mcpServers in ${desktop}.`);
        }
    }

    if (await system.has('openclaw')) {
        const registered = await system.run('openclaw', ['config', 'get', `mcp.servers.${SERVER_NAME}`, '--json'], { capture: true });
        left.push(...openClawAdvice(registered.code === 0));
    }
}

/**
 * 7. Muddy, the modding agent: a Claude Code agent file, which VS Code reads too, and his instructions as the
 * projects folder's AGENTS.md, with a CLAUDE.md that imports it. A file of his that differs — an older Muddy, or the
 * user's own — is replaced only after a yes.
 */
async function muddy(run: Run): Promise<void> {
    const { ui, left } = run;
    if (!await ui.yes('Set up Muddy 🦀, the modding agent, for your clients?')) {
        if (!ui.interactive) left.push('Optional: Muddy, the modding agent — run npm run setup in a terminal, or see docs/Muddy.md.');
        return;
    }
    const projects = readConfiguration(currentEnv(), { root: PROJECT_ROOT }).paths.SKYRIM_PROJECTS_DIR!;
    const agent = path.join(os.homedir(), '.claude', 'agents', 'muddy.md');
    const files: [string, string][] = [
        [agent, claudeCodeAgent()],
        [path.join(projects, 'AGENTS.md'), folderAgentsFile()],
        [path.join(projects, 'CLAUDE.md'), FOLDER_CLAUDE_FILE]
    ];
    for (const [file, content] of files) {
        const state = muddyFileState(file, content);
        if (state === 'same') continue;
        if (state === 'missing' || await ui.yes(`${file} differs from Muddy's. Replace it?`)) {
            writeMuddyFile(file, content);
            ui.say(`Written: ${file}`);
        } else {
            left.push(`${file} is kept as it is; Muddy's is in docs/Muddy.md.`);
        }
    }
    ui.say('Muddy is ready:');
    ui.say('  Claude Code: claude --agent muddy, or @agent-muddy in a chat');
    ui.say('  VS Code: pick Muddy in the agent list of the chat');
    ui.say(`  Codex, the ChatGPT desktop app, Cursor: open ${projects}`);
    ui.say(`  Claude Desktop: a project with ${path.join(projects, 'AGENTS.md')} as its instructions`);
    ui.say('  OpenClaw: openclaw skyrim setup, in the OpenClaw plugin');
}

/**
 * 8. The server started as a client starts it, made to read the load order with one search — the
 * helper starts with the first tool call — and asked what it found.
 */
async function healthcheck(run: Run): Promise<void> {
    const { ui, left } = run;
    const client = new Client({ name: 'skyrim-setup', version: SERVER_INFO.version });
    const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
        return JSON.parse((result.content as Array<{ text?: string }>).map(c => c.text ?? '').join(''));
    };
    try {
        await client.connect(new StdioClientTransport({
            command: process.execPath, args: [ENTRY], cwd: PROJECT_ROOT, stderr: 'ignore',
            env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
        }));
        await call('findRecords', { text: 'Iron Sword', limit: 1 }).catch(() => undefined);
        const answer = await call('healthcheck', {});
        const health = answer.health ?? answer;
        ui.say(health.summary ?? JSON.stringify(answer));
        if (health.instance) ui.say(`  ${health.modManager === 'amethyst' ? 'Amethyst' : 'Mod Organizer'}: ${health.instance}, profile '${health.profile}'.`);
        for (const note of health.notes ?? []) ui.say(`  ${note}`);
        if (health.nexus?.apiKey) ui.say(`  Nexus Mods: ${health.nexus.name ?? 'the key is set'}${health.nexus.premium ? ', premium' : ''}.`);
        if (health.ok === false) left.push('healthcheck found a problem: see above.');
    } catch (error) {
        left.push(`The server did not start: ${(error as Error).message.split('\n')[0]}`);
    } finally {
        await client.close().catch(() => { });
    }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const at = argv.indexOf('--instance');
    const ui = process.stdin.isTTY && process.stdout.isTTY ? terminalUi() : unattendedUi();
    const run: Run = { ui, system: setupSystem(currentPlatform().name), left: [], instanceArg: at >= 0 ? argv[at + 1] : undefined };
    try {
        ui.step('1. The .NET SDK');
        const dotnet = await prerequisites(run);
        ui.step('2. The plugin helper');
        if (dotnet) await helper(run);
        else ui.say('Skipped: it needs the .NET 10 SDK.');
        ui.step('3. Settings');
        await settings(run);
        ui.step('4. The Papyrus compiler');
        await compiler(run);
        ui.step('5. The vanilla script sources');
        await scriptSources(run);
        ui.step('6. Your MCP clients');
        await register(run);
        ui.step('7. Muddy, the modding agent');
        await muddy(run);
        ui.step('8. Healthcheck');
        await healthcheck(run);
    } finally {
        ui.close();
    }
    ui.say('');
    if (run.left.length === 0) {
        ui.say('Done. Restart your MCP client (or reconnect the server) so it starts the new build.');
    } else {
        ui.say('Done, with this left to do:');
        for (const item of run.left) ui.say(`- ${item}`);
        ui.say('Then restart your MCP client (or reconnect the server) so it starts the new build.');
    }
}

main().catch(error => {
    console.error(`Setup failed: ${error?.message ?? error}`);
    process.exit(1);
});

