import fs from 'node:fs';
import path from 'node:path';
import { MUDDY, muddyPrompt } from 'skyrim-modding-tools-core';

/**
 * Muddy, the modding agent, for the MCP clients: his soul and working rules are the core's, the same every product
 * installs; here they take the shape each client reads.
 */

/**
 * Muddy as a Claude Code agent, `~/.claude/agents/muddy.md`. VS Code reads that folder too and lists him among its
 * agents. No tools line: he has every tool, the server's included. JSON strings are YAML strings, so a colon in the
 * description stays text.
 */
export function claudeCodeAgent(): string {
    return [
        '---',
        `name: ${MUDDY.id}`,
        `description: ${JSON.stringify(`${MUDDY.description} Use him for Skyrim Special Edition modding.`)}`,
        'model: inherit',
        'color: orange',
        `initialPrompt: ${JSON.stringify(`Greet me as ${MUDDY.name}, then ask what I want to mod.`)}`,
        '---',
        '',
        muddyPrompt()
    ].join('\n');
}

/**
 * His instructions in one AGENTS.md, for the projects folder: Codex, the ChatGPT desktop app, VS Code and Cursor
 * read it there, and read nothing beside it, so his soul is in it too.
 */
export function folderAgentsFile(): string {
    return `# AGENTS.md - ${MUDDY.name}\n\n${muddyPrompt()}`;
}

/** CLAUDE.md beside it: Claude Code reads an AGENTS.md only where no CLAUDE.md is above the folder; this one imports it. */
export const FOLDER_CLAUDE_FILE = '@AGENTS.md\n';

/**
 * One of Muddy's files where it goes: missing, the same as his, or different — an older Muddy, or the user's own
 * file, which only the user can tell apart.
 */
export function muddyFileState(file: string, content: string): 'missing' | 'same' | 'differs' {
    if (!fs.existsSync(file)) return 'missing';
    return fs.readFileSync(file, 'utf8') === content ? 'same' : 'differs';
}

/** Writes one of his files, its folder made where it is missing. */
export function writeMuddyFile(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}
