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
