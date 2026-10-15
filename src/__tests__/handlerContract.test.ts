import { vi, type MockInstance } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { createHandlers } from '../handlers/index';
import type { ToolDefinition, ToolProperty } from '../types/tools';
import { SAMPLE, recordingBackend } from './fakes';

/**
 * The contract every handler owes its caller, checked for every tool in the
 * catalogue rather than handler by handler.
 *
 * Handlers are thin wrappers over a backend, so the bugs that actually occur are
 * not in their logic but at their edges: an argument passed to the wrong method,
 * a response wrapped twice, an error that escapes as a raw TypeError, or a
 * failure reported as `status:"success"`. Those are uniform properties, so they
 * are asserted uniformly — driven by each tool's own inputSchema, which means a
 * newly added tool is covered the moment it is listed, with no fixture to write.
 *
 * Behaviour belongs in the suites next door (notesHandlers.test.ts). If a tool
 * fails one of these for a legitimate design decision, encode the exception
 * below with a comment — do not weaken the assertion.
 */

type Stubs = ReturnType<typeof recordingBackend>;
const handlersFrom = (stubs: Stubs) => createHandlers(stubs.backend);

/** A plausible value for one declared argument, derived from its schema. */
function sampleValue(name: string, property: ToolProperty): any {
    if (property.enum?.length) return property.enum[0];
    switch (property.type) {
        case 'string': return SAMPLE;
        case 'number': return 1;
        case 'boolean': return true;
        case 'array': return property.items ? [sampleValue(name, property.items)] : [];
        case 'object':
            return property.properties
                ? Object.fromEntries(
                    Object.entries(property.properties).map(([k, v]) => [k, sampleValue(k, v)]))
                : {};
        default: return SAMPLE;
    }
}

function sampleArgs(tool: ToolDefinition): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tool.inputSchema.properties).map(([name, property]) => [name, sampleValue(name, property)])
    );
}

/** Every (handler, tool) pair, for table-driven cases. */
const catalogue = handlersFrom(recordingBackend())
    .flatMap(handler => handler.getTools().map(tool => ({ handler: handler.constructor.name, tool })));

const cases = () => catalogue.map(c => [c.handler, c.tool.name, c.tool] as const);

/**
 * Tools that legitimately answer without touching the backend. The guide and
 * skill readers serve files off disk — there is no backend call to make.
 */
const NO_BACKEND_CALL_EXPECTED = new Set<string>(['readServerGuide', 'readSkill']);

/**
 * Tools whose failure shape is a payload rather than a thrown error, and what
 * that payload must say. Empty in the template; a probe whose answer *is*
 * "unreachable" belongs here, with the assertion that it says so.
 */
const FAILURE_IN_PAYLOAD: Record<string, (payload: any) => void> = {};

let consoleError: MockInstance;
beforeAll(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => { }); });
afterAll(() => { consoleError.mockRestore(); });

it('has a catalogue to check', () => {
    expect(catalogue.length).toBeGreaterThan(0);
});

/**
 * The annotations every tool owes a client, checked uniformly for the same
 * reason as the envelope: they are a per-tool declaration, so the failure mode
 * is not a wrong one but a missing one. A new tool with no annotations falls
 * back to the specification's defaults — not read-only, destructive,
 * open-world — which makes it look more dangerous than a delete and pushes a
 * client to prompt for it forever.
 */
describe('every tool declares its annotations', () => {
    it.each(cases())('%s.%s says what it does to the backend', (_handler, _name, tool) => {
        const annotations = tool.annotations;
        expect(annotations).toBeDefined();

        expect(typeof annotations!.title).toBe('string');
        expect(annotations!.title!.length).toBeGreaterThan(2);
        // A title that only restates the name buys a UI nothing.
        expect(annotations!.title).not.toBe(tool.name);

        // All four, on every tool. The specification calls destructiveHint and
        // idempotentHint meaningful only when the tool writes, but OpenAI's
        // directory rejects a tool that omits either, and leaving them out
        // tells a client nothing it can use.
        expect(typeof annotations!.readOnlyHint).toBe('boolean');
        expect(typeof annotations!.destructiveHint).toBe('boolean');
        expect(typeof annotations!.idempotentHint).toBe('boolean');
        expect(typeof annotations!.openWorldHint).toBe('boolean');

        if (annotations!.readOnlyHint) {
            // A tool that changes nothing cannot destroy anything, and running
            // it twice leaves the backend exactly as once did. Anything else is
            // a typo.
            expect(annotations!.destructiveHint).toBe(false);
            expect(annotations!.idempotentHint).toBe(true);
        }
    });

    it('marks the tools that write, and only those', () => {
        // TEMPLATE: a sample from each end, so the suite fails loudly if a family
        // is annotated by pattern-matching on names rather than on what it does.
        const byName = new Map(catalogue.map(c => [c.tool.name, c.tool]));
        const writes = (name: string) => byName.get(name)?.annotations?.readOnlyHint === false;

        for (const name of ['createNote', 'updateNote', 'deleteNote'])
            expect(`${name} writes: ${writes(name)}`).toBe(`${name} writes: true`);
        for (const name of ['searchNotes', 'readNote', 'listTags', 'readServerGuide'])
            expect(`${name} writes: ${writes(name)}`).toBe(`${name} writes: false`);
    });
});

describe('every tool honours the response contract', () => {
    it.each(cases())('%s.%s returns one single-level MCP envelope', async (handlerName, _name, tool) => {
        const handler = handlersFrom(recordingBackend()).find(h => h.constructor.name === handlerName)!;

        let result: any;
        try {
            result = await handler.handle(tool.name, sampleArgs(tool));
        } catch (error) {
            // Rejecting is allowed; rejecting with something other than an
            // McpError is not — that reaches the client as "Internal error".
            expect(error).toBeInstanceOf(McpError);
            return;
        }

        expect(Array.isArray(result?.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0].type).toBe('text');
        expect(typeof result.content[0].text).toBe('string');

        // Exactly one level of JSON: parsing once must yield an object, not
        // another JSON string. That is the double-wrapping regression.
        const payload = JSON.parse(result.content[0].text);
        expect(typeof payload).toBe('object');
        expect(payload).not.toBeNull();
    });
});

describe('every tool reports a backend failure as an McpError', () => {
    it.each(cases())('%s.%s surfaces the failure', async (handlerName, _name, tool) => {
        const handler = handlersFrom(recordingBackend({ fail: true })).find(h => h.constructor.name === handlerName)!;

        let result: any;
        try {
            result = await handler.handle(tool.name, sampleArgs(tool));
        } catch (error) {
            expect(error).toBeInstanceOf(McpError);
            return;
        }

        const payload = JSON.parse(result.content[0].text);

        // A tool may report the failure in its payload instead of throwing, but
        // only if that is its documented contract — and then the payload has to
        // actually say so.
        const documented = FAILURE_IN_PAYLOAD[tool.name];
        if (documented) {
            documented(payload);
            return;
        }

        // Otherwise: returning is fine, claiming success is not.
        expect(`${handlerName}.${tool.name}: ${JSON.stringify(payload).slice(0, 120)}`)
            .not.toMatch(/"status"\s*:\s*"success"/);
    });
});

describe('every tool delegates to the backend', () => {
    it.each(cases())('%s.%s calls the backend', async (handlerName, toolName, tool) => {
        if (NO_BACKEND_CALL_EXPECTED.has(toolName)) return;

        const stubs = recordingBackend();
        const handler = handlersFrom(stubs).find(h => h.constructor.name === handlerName)!;

        // The generated arguments name the seeded note, so every tool has a
        // success path — a tool that rejects them anyway proves nothing about
        // delegation, which is why that is a failure here rather than a skip.
        await handler.handle(tool.name, sampleArgs(tool));

        expect(`${handlerName}.${toolName} called: ${stubs.calls.map(c => c.method).join(',') || '<nothing>'}`)
            .not.toMatch(/<nothing>/);
    });
});

describe('every tool survives being called with no arguments', () => {
    it.each(cases())('%s.%s fails cleanly without arguments', async (handlerName, _name, tool) => {
        const handler = handlersFrom(recordingBackend()).find(h => h.constructor.name === handlerName)!;
        try {
            const result = await handler.handle(tool.name, {});
            expect(Array.isArray(result?.content)).toBe(true);
        } catch (error) {
            // A missing mandatory argument must be an McpError, never a
            // TypeError from reading a property of undefined.
            expect(error).toBeInstanceOf(McpError);
        }
    });

    it.each(cases())('%s.%s fails cleanly with undefined arguments', async (handlerName, _name, tool) => {
        const handler = handlersFrom(recordingBackend()).find(h => h.constructor.name === handlerName)!;
        try {
            const result = await handler.handle(tool.name, undefined);
            expect(Array.isArray(result?.content)).toBe(true);
        } catch (error) {
            expect(error).toBeInstanceOf(McpError);
        }
    });
});

describe('argument mapping', () => {
    /**
     * TEMPLATE: spot checks that pin the arguments handed to the backend. These
     * are the mappings a refactor silently breaks, because the wrapper keeps
     * compiling and the envelope keeps looking right.
     */
    const mappings: { tool: string; args: any; method: string; expected: any[] }[] = [
        {
            tool: 'searchNotes',
            args: { text: 'x', tag: 'y', limit: 5, offset: 2 },
            method: 'searchNotes',
            expected: [{ text: 'x', tag: 'y', limit: 5, offset: 2 }]
        },
        {
            // Defaults are the handler's job, so the backend never sees a missing limit.
            tool: 'searchNotes', args: {}, method: 'searchNotes',
            expected: [{ text: undefined, tag: undefined, limit: 20, offset: 0 }]
        },
        { tool: 'readNote', args: { id: ` ${SAMPLE} ` }, method: 'getNote', expected: [SAMPLE] },
        { tool: 'deleteNote', args: { id: SAMPLE }, method: 'deleteNote', expected: [SAMPLE] },
        {
            tool: 'updateNote', args: { id: SAMPLE, body: 'new' }, method: 'updateNote',
            expected: [SAMPLE, { title: undefined, body: 'new', tags: undefined }]
        }
    ];

    it.each(mappings.map(m => [`${m.tool} -> ${m.method}`, m] as const))('%s', async (_label, mapping) => {
        const stubs = recordingBackend();
        const handler = handlersFrom(stubs).find(h => h.getTools().some(t => t.name === mapping.tool))!;

        await handler.handle(mapping.tool, mapping.args);

        const call = stubs.calls.find(c => c.method === mapping.method);
        expect(`${mapping.method} called: ${!!call}`).toBe(`${mapping.method} called: true`);
        expect(call!.args.slice(0, mapping.expected.length)).toEqual(mapping.expected);
    });
});
