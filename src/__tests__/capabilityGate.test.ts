import { GATED_FEATURES, evaluateGate, gatingEnabled } from '../lib/capabilityGate';
import { createHandlers } from '../handlers/index';
import type { AppBackend } from '../backend/index';
import type { ToolDefinition } from '../types/tools';

const CATALOGUE = createHandlers(undefined as unknown as AppBackend).flatMap(h => h.getTools());

const tool = (name: string, needsFeature?: string): ToolDefinition => ({
    name,
    description: `does ${name}`,
    inputSchema: { type: 'object', properties: {} },
    ...(needsFeature ? { needsFeature } : {})
});

describe('evaluateGate', () => {
    // The mechanism, with an example feature of its own: it must not depend on which features this
    // server happens to declare today.
    const tools = [tool('plain'), tool('tagged', 'tags')];
    const features = [{ id: 'tags', label: 'tag indexing' }];

    it('withholds a tool whose feature the backend does not offer', () => {
        const gate = evaluateGate(['something-else'], tools, features);
        expect(gate.missing).toEqual(['tags']);
        expect([...gate.unavailable.keys()]).toEqual(['tagged']);
    });

    it('withholds nothing when the feature is offered, in any case', () => {
        expect(evaluateGate(['TAGS'], tools, features).unavailable.size).toBe(0);
    });

    it.each([
        ['undefined', undefined],
        ['empty', []],
        ['not an array', 'tags' as any]
    ])('withholds NOTHING when the capabilities are %s', (_label, capabilities) => {
        // The important one. Hiding a tool that would have worked is invisible;
        // offering one that errors is not. Every unclear answer fails open.
        const gate = evaluateGate(capabilities, tools, features);
        expect(gate.unavailable.size).toBe(0);
        expect(gate.missing).toEqual([]);
    });

    it('explains itself well enough to stop a retry', () => {
        const reason = evaluateGate(['x'], tools, features).unavailable.get('tagged')!;
        expect(reason).toMatch(/does not offer tag indexing/);
        expect(reason).toMatch(/calling it again will not help/);
    });
});

describe('the gated features', () => {
    it('describes every one well enough to explain itself', () => {
        for (const feature of GATED_FEATURES) {
            expect(feature.id).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(feature.label.length).toBeGreaterThan(3);
        }
    });

    it('never lets a tool need a feature that does not exist', () => {
        // A typo in needsFeature would otherwise un-gate the tool without a word.
        const known = new Set(GATED_FEATURES.map(f => f.id));
        const unknown = CATALOGUE.filter(t => t.needsFeature && !known.has(t.needsFeature))
            .map(t => `${t.name} -> ${t.needsFeature}`);
        expect(unknown).toEqual([]);
    });

    it('has at least one real tool declaring each feature', () => {
        // A feature nothing needs is dead configuration.
        for (const feature of GATED_FEATURES) {
            expect(`${feature.id}: ${CATALOGUE.some(t => t.needsFeature === feature.id)}`)
                .toBe(`${feature.id}: true`);
        }
    });
});

describe('gatingEnabled', () => {
    it('is on unless explicitly switched off', () => {
        expect(gatingEnabled({})).toBe(true);
        expect(gatingEnabled({ MCP_GATE: 'on' })).toBe(true);
    });

    it('accepts the usual ways of saying no', () => {
        for (const no of ['off', 'OFF', 'false', '0', 'no', ' off ']) {
            expect(gatingEnabled({ MCP_GATE: no })).toBe(false);
        }
    });
});
