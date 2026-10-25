/**
 * How each MCP client is told about the server: no settings in the registration — they live in the
 * server's `.env` — only the command that starts it. The same name everywhere, so a second run of
 * setup replaces its own entry and nothing else.
 */

import path from 'node:path';
import { FAMILY_SKILLS } from '../lib/skills.js';

export const SERVER_NAME = 'skyrim';

/** Claude Code's command line, for every folder (`--scope user`): registered for one, it is missing in all others. */
export function claudeCodeArgs(entry: string): string[] {
    return ['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', 'node', entry];
}

/** VS Code's own way to add a server to the user's configuration. */
export function vsCodeArgs(entry: string): string[] {
    return ['--add-mcp', JSON.stringify({ name: SERVER_NAME, command: 'node', args: [entry] })];
}

/**
 * Claude Desktop's config with the server in it, everything else kept. Desktop has no command for it,
 * so its file is written; one that cannot be read is left alone, not replaced.
 */
export function desktopConfigWithServer(text: string | undefined, entry: string): string {
    let config: unknown = {};
    if (text?.trim()) {
        try {
            config = JSON.parse(text);
        } catch {
            throw new Error('Claude Desktop\'s config cannot be read as JSON, so it is left as it is.');
        }
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        throw new Error('Claude Desktop\'s config is not the object it should be, so it is left as it is.');
    }
    const current = config as { mcpServers?: Record<string, unknown> };
    return JSON.stringify({ ...current, mcpServers: { ...current.mcpServers, [SERVER_NAME]: { command: 'node', args: [entry] } } }, null, 2) + '\n';
}

/** The OpenClaw agent setup adds for modding. */
export const OPENCLAW_AGENT = 'skyrim';

/**
 * The agent's tools: OpenClaw's file tools, its skill reader, and this server's. Each tool listed costs
 * prompt, and every one of OpenClaw's own a modding session does not use is a wrong turn a small model
 * can take.
 */
export const OPENCLAW_AGENT_TOOLS = ['read', 'write', 'edit', 'apply_patch', 'ls', 'skills_read', `${SERVER_NAME}__*`];

/** The sections of OpenClaw's configuration the registration depends on, as `openclaw config get` gives them. */
export interface OpenClawSections {
    agents?: { defaults?: { workspace?: string }; entries?: Record<string, { workspace?: string; [key: string]: unknown }> };
    skills?: { load?: { extraDirs?: string[] }; [key: string]: unknown };
}

export interface OpenClawPlace {
    /** The server's entry script. */
    entry: string;
    /** The folder the modding skills are in, loaded as OpenClaw skills. */
    skillsDir: string;
    /** Their names: the agent's skills. */
    skills: readonly string[];
    /** The server's projects folder: the agent's working folder. */
    projectsDir: string;
    /** OpenClaw's default workspace, where a sole agent without one of its own works. */
    workspace: string;
    /** The modding agent's own workspace, which holds its workspace files. */
    agentWorkspace: string;
}

/**
 * What setup writes into OpenClaw, as one `openclaw config patch`: the server; the modding skills,
 * which OpenClaw lists in its prompt — it reads none of a server's `instructions`; and an agent for
 * modding with those skills, thinking at its highest (OpenClaw sends a local model no thinking unless
 * told), only the tools in OPENCLAW_AGENT_TOOLS, and a workspace of its own for the files of
 * openClawWorkspaceFiles(). The server is registered again on every run; an agent of that name is left
 * as the user has made it. The one agent there was keeps its workspace: in a fleet of two, OpenClaw
 * moves an agent without one into a subfolder of it.
 */
export function openClawPatch(current: OpenClawSections, place: OpenClawPlace): Record<string, unknown> {
    const loaded = current.skills?.load?.extraDirs ?? [];
    const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const entries = current.agents?.entries ?? {};
    const ids = Object.keys(entries);
    const added: Record<string, unknown> = {};
    if (!entries[OPENCLAW_AGENT]) {
        added[OPENCLAW_AGENT] = {
            name: 'Skyrim Modding',
            workspace: place.agentWorkspace,
            cwd: place.projectsDir,
            skills: [...place.skills],
            thinkingDefault: 'max',
            tools: { allow: [...OPENCLAW_AGENT_TOOLS] }
        };
        // With no agent configured, OpenClaw's implicit one is `main`.
        const sole = ids.length === 0 ? 'main' : ids.length === 1 ? ids[0] : undefined;
        if (sole && !entries[sole]?.workspace) added[sole] = { workspace: current.agents?.defaults?.workspace ?? place.workspace };
    }
    return {
        mcp: { servers: { [SERVER_NAME]: { command: 'node', args: [place.entry] } } },
        skills: { load: { extraDirs: loaded.some(dir => same(dir, place.skillsDir)) ? loaded : [...loaded, place.skillsDir] } },
        agents: { entries: added }
    };
}

/**
 * The modding agent's workspace files, which OpenClaw puts into its prompt every turn, so they stay
 * short. AGENTS.md carries what the server's `instructions` say, in the agent's tool names; SOUL.md
 * and IDENTITY.md say who the agent is; USER.md holds what setup knows of the user, as directives in
 * OpenClaw's form. `boundTo` is the instance the server serves, where one is configured.
 */
export function openClawWorkspaceFiles(boundTo: string | undefined, today: string): Record<string, string> {
    const tool = (name: string) => `\`${SERVER_NAME}__${name}\``;
    const directive = (text: string) => `<!-- observed: ${today} | status: active -->\n\n- ${text}\n`;
    return {
        'AGENTS.md': [
            '# AGENTS.md - Skyrim Modding',
            '',
            `You mod Skyrim Special Edition for the user with the \`${SERVER_NAME}__*\` tools (the Skyrim MCP server).`,
            'Your working folder is the server\'s projects folder.',
            `Don't overthink: decide, then deliver the task. A mod is delivered when the ${tool('buildProject')} after your`,
            'last change answers `success`: after each edit or refusal, build again, and answer with what that build said.',
            '',
            '## Before you write a mod',
            '',
            '1. Read the skill `skyrim-modding-basics` once per chat: `skills_read` with `{"name": "skyrim-modding-basics"}`.',
            '2. Then the skill of the records you will write: ' +
            `${FAMILY_SKILLS.map(family => `\`${family.skill}\` (${family.covers})`).join(', ')}.`,
            '   Mods that break after a game update: `skyrim-modding-game-versions`.',
            '3. A skill\'s tables are in its REFERENCE.md, which `skills_read` does not read: ' +
            `${tool('readSkill')} with \`{"skill": "skyrim-modding-magic", "file": "REFERENCE.md"}\`.`,
            '',
            '## How a mod is made',
            '',
            `- A mod is a project. ${tool('newProject')} creates it and answers the full path where each record file`,
            '  goes: write the YAML files exactly there, with `write` and `edit`.',
            // Ollama drops an `edit` call whose `edits` list e4b leaves unclosed, as it did with whole files (eval round 58).
            '- A whole record, or a file changed in many places, you `write` anew; `edit` is for a few lines.',
            '- `edit` finds each `oldText` exactly as the file holds it: whole lines with their indentation, and',
            '  real line breaks — never `\\n` typed. `edit` refused: `read` the file, then edit what it holds now.',
            // Named nowhere here, editRecord was called by the name the server's answers give it, and OpenClaw answered
            // "Tool editRecord not found" seven times (eval round 62's npc+detailed #2).
            `- ${tool('editRecord')} changes a record file's fields by their paths, with no old text to match:`,
            '  `{"record": "Weapons/FlameBlade.yaml", "set": [{"path": "BasicStats.Damage", "value": 12}]}`.',
            `- A new record — a new sword, a new note — is a new file you write, following a vanilla record`,
            `  read with ${tool('readRecord')}: copy its values instead of guessing. Find records with ${tool('findRecords')}.`,
            `- ${tool('addPatch')} is only for changing an existing record: its copy changes that record everywhere`,
            `  in the game. Change the copy with ${tool('editRecord')}; never edit another mod's plugin.`,
            `- ${tool('buildProject')} checks and builds. A refusal names the line to write: fix it, build again.`,
            '  `built_with_warnings`: the plugin is built — fix what each warning says and build again, that is part',
            '  of the task. A warning stays only where the user asked for just what it names.',
            `- ${tool('deployProject')}, ${tool('installMod')} and ${tool('disableMod')} change the user's mod manager: only when asked.`,
            '',
            '## Other tools',
            '',
            `- You know the job but not the tool: ${tool('readServerGuide')} with \`{"guide": "router"}\`.`,
            `- Mods on Nexus, with a Nexus Mods API key: ${tool('searchNexus')}, ${tool('readNexusMod')}.`,
            '- An answer with `"status":"truncated"` was too large: narrow the request as its `nextStep` says.',
            ''
        ].join('\n'),
        'SOUL.md': [
            '# SOUL.md - Skyrim Modding',
            '',
            'You are a careful Skyrim SE modder working on the user\'s own game.',
            '',
            '- Check before you claim: a value is what `readRecord` shows; a mod is built when `buildProject` says so.',
            '- Follow vanilla records: copy their values and their shape, then change what the user asked for.',
            '- Answer short: what you made, where it is, what is left to do.',
            '- The user\'s game comes first: never deploy, install or disable a mod unless asked.',
            ''
        ].join('\n'),
        'USER.md': [
            '# USER.md - User Model',
            '',
            directive(`Always work on the instance the Skyrim server is bound to${boundTo ? ` (${boundTo})` : ''}; never change another instance.`),
            directive('Prefer answers that name each file you wrote by its full path.')
        ].join('\n'),
        'IDENTITY.md': '# IDENTITY.md\n\n- Name: Skyrim Modding\n- Emoji: 🐉\n'
    };
}
