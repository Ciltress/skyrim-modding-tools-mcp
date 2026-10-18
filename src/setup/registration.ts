/**
 * How each MCP client is told about the server: no settings in the registration — they live in the
 * server's `.env` — only the command that starts it. The same name everywhere, so a second run of
 * setup replaces its own entry and nothing else.
 */

import path from 'node:path';

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
}

/**
 * What setup writes into OpenClaw, as one `openclaw config patch`: the server; the modding skills,
 * which OpenClaw lists in its prompt — it reads none of a server's `instructions`; and an agent for
 * modding with those skills, thinking at its highest (OpenClaw sends a local model no thinking unless
 * told), and only the tools in OPENCLAW_AGENT_TOOLS. The server is registered again on every run; an
 * agent of that name is left as the user has made it. The one agent there was keeps its workspace: in
 * a fleet of two, OpenClaw moves an agent without one into a subfolder of it.
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
