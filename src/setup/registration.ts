/**
 * How each MCP client is told about the server: no settings in the registration — they live in the
 * server's `.env` — only the command that starts it. The same name everywhere, so a second run of
 * setup replaces its own entry and nothing else.
 */

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

/** The OpenClaw plugin, which serves OpenClaw the same tools from skyrim-modding-tools-core. */
export const OPENCLAW_PLUGIN_URL = 'https://github.com/Ciltress/skyrim-modding-tools-openclaw-plugin';

/**
 * What setup leaves an OpenClaw user to do. OpenClaw drops an MCP server's instructions, prefixes its tools and
 * hides them behind its Tool Search, so OpenClaw gets the tools from the plugin, which carries the instructions,
 * the skills and the tools under their own names (the user's call, 2026-10-25); the plugin can read this server's
 * `.env`. This server registered by an earlier setup would list every tool a second time.
 */
export function openClawAdvice(envFile: string, registered: boolean): string[] {
    return [
        `For OpenClaw, install the OpenClaw plugin, not this server: ${OPENCLAW_PLUGIN_URL} — its README says how; ` +
        `its envFile can be this server's ${envFile}.`,
        ...(registered
            ? [`OpenClaw still has this server from an earlier setup, which the plugin replaces: openclaw config unset mcp.servers.${SERVER_NAME}`]
            : [])
    ];
}
