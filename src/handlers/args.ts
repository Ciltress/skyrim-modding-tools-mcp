import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { HelperError } from '../backend/skyrim/helperClient.js';
import { InstallError } from '../backend/skyrim/installer.js';
import { NexusError } from '../backend/skyrim/nexus.js';
import { ProjectError } from '../backend/skyrim/projects.js';
import { ScriptCompileError } from '../backend/skyrim/externalTools.js';
import type { ToolDefinition, ToolProperty } from '../types/tools.js';

/**
 * The arguments, with each one a caller sent as text turned into the JSON type the tool's schema
 * declares for it — the list `'["IronSword"]'` into `["IronSword"]`.
 *
 * Small models and some clients send that shape, and the intent is not in doubt, so refusing would
 * only cost a turn the model may not recover from. Applied once, to every call, in BaseHandler — a
 * tool added tomorrow is covered without being told. Text that does not read as the declared type
 * is left alone, for the tool's own check to refuse with a message that names the argument.
 */
export function coerceArgs(schema: ToolDefinition['inputSchema'], args: any): any {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
    let coerced: Record<string, any> | undefined;
    for (const [name, property] of Object.entries(schema.properties)) {
        const value = args[name];
        if (typeof value !== 'string') continue;
        const typed = fromText(value, property);
        if (typed !== value) (coerced ??= { ...args })[name] = typed;
    }
    return coerced ?? args;
}

function fromText(value: string, property: ToolProperty): unknown {
    const text = value.trim();
    switch (property.type) {
        case 'array':
            if (text.startsWith('[')) {
                try {
                    const parsed = JSON.parse(text);
                    return Array.isArray(parsed) ? parsed : value;
                } catch {
                    return value;
                }
            }
            // One item where a list of them is declared: ["IronSword"] meant as "IronSword".
            return property.items?.type === 'string' && text ? [value] : value;
        case 'number':
            return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : value;
        case 'boolean':
            return /^(true|false)$/i.test(text) ? text.toLowerCase() === 'true' : value;
        default:
            return value;
    }
}

/**
 * Argument checks shared by the handler families. Each throws `InvalidParams` with a message that
 * says what to send instead — a model reads the message and acts on it.
 */

export function requireString(args: any, name: string, hint = ''): string {
    const value = args?.[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new McpError(ErrorCode.InvalidParams, `'${name}' is required.${hint ? ` ${hint}` : ''}`);
    }
    return value.trim();
}

export function optionalString(args: any, name: string): string | undefined {
    const value = args?.[name];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new McpError(ErrorCode.InvalidParams, `'${name}' must be a string.`);
    return value.trim() || undefined;
}

export function optionalStringList(args: any, name: string, example: string): string[] | undefined {
    const value = args?.[name];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new McpError(ErrorCode.InvalidParams, `'${name}' must be an array of strings, e.g. ${example}.`);
    }
    const items = value.map((item: string) => item.trim()).filter(Boolean);
    return items.length ? items : undefined;
}

export function optionalBoolean(args: any, name: string): boolean | undefined {
    const value = args?.[name];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') throw new McpError(ErrorCode.InvalidParams, `'${name}' must be true or false.`);
    return value;
}

export function requirePositiveInteger(args: any, name: string, hint = ''): number {
    const value = args?.[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new McpError(ErrorCode.InvalidParams, `'${name}' must be a whole number from 1 up.${hint ? ` ${hint}` : ''}`);
    }
    return value;
}

export function optionalChoice<T extends string>(args: any, name: string, choices: readonly T[]): T | undefined {
    const value = args?.[name];
    if (value === undefined || value === null || value === '') return undefined;
    const match = typeof value === 'string' ? choices.find(choice => choice === value.trim().toLowerCase()) : undefined;
    if (!match) throw new McpError(ErrorCode.InvalidParams, `'${name}' must be one of ${choices.join(', ')}.`);
    return match;
}

export function limitArg(args: any, fallback: number, max: number): number {
    const value = args?.limit;
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        throw new McpError(ErrorCode.InvalidParams, `'limit' must be a number from 1 to ${max}.`);
    }
    return Math.min(Math.floor(value), max);
}

/**
 * Failures that are about the request — a record or Nexus mod that does not exist, a malformed FormID,
 * a link to nothing, project text the plugin cannot be written from, a project in the wrong state, a
 * script that does not compile, a downloaded file that cannot be installed as asked — become `InvalidParams`, so the client sees something to fix rather
 * than a server fault. What is missing on the machine — a compiler, a writable disk, a way to Nexus —
 * is not the request's fault and passes through to BaseHandler's mapping, as does everything else.
 */
const REQUEST_ERRORS = new Set(['notFound', 'badRequest', 'badArchive', 'danglingLinks', 'writeFailed']);

export async function asRequestError<T>(work: Promise<T> | T): Promise<T> {
    try {
        return await work;
    } catch (error) {
        const aboutTheRequest =
            (error instanceof HelperError && REQUEST_ERRORS.has(error.code)) ||
            (error instanceof NexusError && error.code === 'notFound') ||
            error instanceof ProjectError ||
            error instanceof InstallError ||
            error instanceof ScriptCompileError;
        if (aboutTheRequest) throw new McpError(ErrorCode.InvalidParams, (error as Error).message);
        throw error;
    }
}
