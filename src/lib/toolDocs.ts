import { createHandlers } from '../handlers/index.js';
import type { AppBackend } from '../backend/index.js';
import type { ToolDefinition, ToolProperty } from '../types/tools.js';

/**
 * The tool reference, rendered from the tool definitions themselves.
 *
 * A hand-written reference restates names, arguments and descriptions that
 * already exist in `getTools()` — two copies of the same facts, and AGENTS.md
 * asks that a contradiction between a doc and the code be treated as a bug,
 * which only works if someone notices. Deriving the document removes the second
 * copy instead of policing it.
 *
 * `toolDocs.test.ts` re-renders and compares against the committed file, so a
 * tool changed without running `npm run docs:tools` fails the build rather than
 * shipping a reference that quietly lies.
 */

export interface ToolFamily {
    /** Handler class name, e.g. 'NotesHandlers'. */
    handler: string;
    /** Display name, e.g. 'Notes'. */
    label: string;
    tools: ToolDefinition[];
}

/**
 * Names that de-camelising alone gets wrong or leaves unhelpful.
 * Anything not listed falls back to the split-and-capitalise below.
 */
const LABELS: Record<string, string> = {
    DocsHandlers: "This server's own guides",
    SkillsHandlers: 'Bundled skills',
    RecordsHandlers: 'Records in the load order',
    ProjectsHandlers: 'Projects: authoring and patching',
    NexusHandlers: 'Nexus Mods',
    ModsHandlers: 'Installing mods'
};

function labelFor(handler: string): string {
    if (LABELS[handler]) return LABELS[handler];
    const base = handler.replace(/Handlers$/, '');
    const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every handler's tools, from the same `createHandlers()` the server serves —
 * so the reference documents exactly what can be listed, no more and no less.
 * `getTools()` never touches the backend, so none is needed to read it.
 */
export function collectToolFamilies(): ToolFamily[] {
    return createHandlers(undefined as unknown as AppBackend)
        .map(handler => ({
            handler: handler.constructor.name,
            label: labelFor(handler.constructor.name),
            tools: handler.getTools()
        }))
        .filter(family => family.tools.length > 0)
        .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** One line of markdown table, with the pipes that would break it escaped. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/**
 * One argument, in a single clause.
 *
 * Deliberately without the argument's own description: a client that can call the
 * tool already has the full `inputSchema`, descriptions included, so repeating
 * them here costs tokens twice and tells nobody anything new. What this document
 * adds is the name, the shape, and what the tool is *for*.
 */
function describeProperty(name: string, property: ToolProperty, required: boolean): string {
    const bits: string[] = [property.type ?? 'any'];
    if (property.enum?.length) bits.push(`one of ${property.enum.join('/')}`);
    if (property.default !== undefined) bits.push(`default \`${property.default}\``);
    return `\`${name}\`${required ? '**\\***' : ''} ${bits.join(', ')}`;
}

/**
 * The tool's annotations in one clause: what a client is being told before it
 * decides whether to ask a human.
 *
 * Only the flags that *matter* are printed. A reader wants to see which tools
 * write and which of those bite; "not destructive, idempotent" under every
 * read-only tool would bury exactly that.
 */
function describeAnnotations(tool: ToolDefinition): string | undefined {
    const a = tool.annotations;
    if (!a) return undefined;

    const bits = a.readOnlyHint
        ? ['read-only']
        : ['writes',
           ...(a.destructiveHint ? ['destructive'] : []),
           ...(a.idempotentHint ? ['idempotent'] : [])];

    if (a.openWorldHint) bits.push('reaches outside this backend');

    return `_${bits.join(' · ')}_`;
}

function renderTool(tool: ToolDefinition): string {
    const required = new Set(tool.inputSchema.required ?? []);
    const properties = Object.entries(tool.inputSchema.properties ?? {});
    const args = properties.length
        ? properties.map(([name, p]) => describeProperty(name, p, required.has(name))).join(' · ')
        : '_no arguments_';

    const hints = describeAnnotations(tool);
    const gated = tool.needsFeature
        ? `Needs the backend feature \`${tool.needsFeature}\`; withheld where it is missing.`
        : undefined;

    return [
        `**\`${tool.name}\`** — ${cell(tool.description)}`,
        '',
        ...(hints ? [hints, ''] : []),
        ...(gated ? [gated, ''] : []),
        args,
        ''
    ].join('\n');
}

export const TOOL_REFERENCE_FILE = 'docs/Tool-Reference.md';

/**
 * Renders the whole reference. Deterministic — families and tools keep a stable
 * order — so the drift test compares cleanly and diffs stay readable.
 */
export function renderToolReference(families: ToolFamily[] = collectToolFamilies()): string {
    const total = families.reduce((n, f) => n + f.tools.length, 0);

    const head = [
        '# Tool reference',
        '',
        '<!-- GENERATED FILE - do not edit by hand.',
        '     Run `npm run build && npm run docs:tools` after changing any getTools(). -->',
        '',
        `Every tool this server can expose: **${total} tools across ${families.length} families**, ` +
        'rendered from the tool definitions themselves so it cannot drift from the code. `healthcheck` ' +
        'is not listed here: the server defines it outside every handler and lists it in every profile.',
        '',
        '**How many you can actually call is smaller.** The active `MCP_PROFILE` decides what is',
        'listed, and the server withholds anything the connected backend does not support.',
        '`tools/list` is always the truth; `healthcheck` reports the profile and what was withheld.',
        '',
        'Looking for the tool that does a particular job? Start with',
        '[`Tool-Router.md`](./Tool-Router.md), which maps intent to tool. For workflows and the error',
        'model, see [`MCP-Tools.md`](./MCP-Tools.md).',
        '',
        'An argument marked **\\*** is required. Argument *descriptions* are not repeated here: they',
        'reach you in the `inputSchema` of every tool you can call.',
        '',
        'The italic line under each tool is its MCP **annotations**, sent to clients in `tools/list`:',
        'whether it only reads, whether it *writes*, whether the write is *destructive* (it overwrites',
        'or removes something that was there) or *idempotent* (repeating it changes nothing further),',
        'and whether it reaches past the backend this server is bound to. They are hints for deciding',
        'what needs a human, not a permission system: nothing here is enforced.',
        '',
        '## Families',
        '',
        ...families.map(f => `- [${f.label}](#${f.label.toLowerCase()
            .replace(/[^a-z0-9 -]/g, '').replace(/ +/g, '-')}) — ${f.tools.length} tool${f.tools.length === 1 ? '' : 's'}`),
        '',
        '---',
        ''
    ].join('\n');

    const body = families.map(family => [
        `## ${family.label}`,
        '',
        `From \`src/handlers/${family.handler}.ts\`.`,
        '',
        ...family.tools.map(renderTool)
    ].join('\n')).join('\n');

    return `${head}\n${body}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
