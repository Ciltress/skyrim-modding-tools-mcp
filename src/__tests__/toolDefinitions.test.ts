import { createHandlers } from '../handlers/index';
import type { AppBackend } from '../backend/index';
import type { ToolProperty } from '../types/tools';

/**
 * The catalogue itself. getTools() never touches the backend, so none is needed
 * to inspect it.
 */
const handlers = createHandlers(undefined as unknown as AppBackend);
const allTools = handlers.flatMap(h => h.getTools().map(tool => ({ handler: h.constructor.name, tool })));

describe('tool catalogue', () => {
    it('has no duplicate tool names', () => {
        const seen = new Map<string, string>();
        const duplicates: string[] = [];
        for (const { handler, tool } of allTools) {
            const owner = seen.get(tool.name);
            if (owner) duplicates.push(`${tool.name} (${owner} and ${handler})`);
            else seen.set(tool.name, handler);
        }
        expect(duplicates).toEqual([]);
    });

    it('never claims the name healthcheck, which the server defines itself', () => {
        expect(allTools.map(t => t.tool.name)).not.toContain('healthcheck');
    });

    it('routes every listed tool to its own handler', async () => {
        // handle() must not fall through to "no tool named" for a name it lists.
        // The missing backend makes the call fail afterwards — that is fine, we
        // only care that the name was recognised.
        for (const handler of handlers) {
            for (const tool of handler.getTools()) {
                let message = '';
                try {
                    await handler.handle(tool.name, {});
                } catch (error: any) {
                    message = String(error?.message ?? '');
                }
                expect(`${handler.constructor.name}.${tool.name}: ${message}`).not.toMatch(/has no tool named/);
            }
        }
    });

    it('describes every tool and every argument', () => {
        const thin: string[] = [];
        const undescribed: string[] = [];
        const walk = (where: string, property: ToolProperty) => {
            if (!property.description) undescribed.push(where);
            if (property.items) walk(`${where}[]`, property.items);
            for (const [name, child] of Object.entries(property.properties ?? {})) walk(`${where}.${name}`, child);
        };
        for (const { handler, tool } of allTools) {
            const where = `${handler}.${tool.name}`;
            if ((tool.description ?? '').length < 40) thin.push(`${where}: "${tool.description}"`);
            expect(tool.inputSchema.type).toBe('object');
            for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
                walk(`${where}.${name}`, property);
            }
        }
        expect(thin).toEqual([]);
        expect(undescribed).toEqual([]);
    });

    it('uses camelCase tool names a model can type without guessing', () => {
        for (const { tool } of allTools) expect(tool.name).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    });

    it('only marks properties as required that actually exist', () => {
        for (const { handler, tool } of allTools) {
            for (const name of tool.inputSchema.required ?? []) {
                expect(`${handler}.${tool.name}.${name}`).toBe(
                    tool.inputSchema.properties[name] ? `${handler}.${tool.name}.${name}` : 'missing property'
                );
            }
        }
    });

    it('never uses the non-JSON-Schema "optional" marker', () => {
        const offenders: string[] = [];
        const walk = (where: string, property: ToolProperty) => {
            if ('optional' in property) offenders.push(where);
            if (property.items) walk(`${where}[]`, property.items);
            for (const [name, child] of Object.entries(property.properties ?? {})) walk(`${where}.${name}`, child);
        };
        for (const { handler, tool } of allTools) {
            for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
                walk(`${handler}.${tool.name}.${name}`, property);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('gives every array argument an element schema', () => {
        const bare: string[] = [];
        for (const { tool } of allTools) {
            for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
                if (property.type === 'array' && !property.items) bare.push(`${tool.name}.${name}`);
            }
        }
        expect(bare).toEqual([]);
    });

    it('declares structured arguments as such, never as strings', () => {
        // TEMPLATE: list the arguments your backend wants as objects or arrays.
        // Declared as strings, they make callers pass a name where the whole
        // object a previous call returned was expected.
        const structured: Record<string, string[]> = {
            createNote: ['tags'],
            updateNote: ['tags']
        };

        for (const { tool } of allTools) {
            for (const name of structured[tool.name] ?? []) {
                const property = tool.inputSchema.properties[name];
                expect(`${tool.name}.${name}`).toBe(property ? `${tool.name}.${name}` : 'missing property');
                expect(`${tool.name}.${name} is ${property.type}`).toBe(
                    `${tool.name}.${name} is ${property.type === 'array' ? 'array' : 'object'}`
                );
            }
        }
    });
});
