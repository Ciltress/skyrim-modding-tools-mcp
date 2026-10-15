import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { HelperError } from '../backend/skyrim/helperClient.js';
import { ProjectError } from '../backend/skyrim/projects.js';
import { ScriptCompileError } from '../backend/skyrim/externalTools.js';

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

export function limitArg(args: any, fallback: number, max: number): number {
    const value = args?.limit;
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        throw new McpError(ErrorCode.InvalidParams, `'limit' must be a number from 1 to ${max}.`);
    }
    return Math.min(Math.floor(value), max);
}

/**
 * Failures that are about the request — a record that does not exist, a malformed FormID, a reference
 * to nothing, a project in the wrong state, a script that does not compile — become `InvalidParams`,
 * so the client sees something to fix rather than a server fault. Everything else passes through to
 * BaseHandler's mapping.
 */
const REQUEST_ERRORS = new Set(['notFound', 'badRequest', 'danglingReferences', 'formIdRange', 'writeFailed']);

export async function asRequestError<T>(work: Promise<T> | T): Promise<T> {
    try {
        return await work;
    } catch (error) {
        const aboutTheRequest =
            (error instanceof HelperError && REQUEST_ERRORS.has(error.code)) ||
            error instanceof ProjectError ||
            error instanceof ScriptCompileError;
        if (aboutTheRequest) throw new McpError(ErrorCode.InvalidParams, (error as Error).message);
        throw error;
    }
}
