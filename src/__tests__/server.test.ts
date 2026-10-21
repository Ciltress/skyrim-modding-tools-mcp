import { vi, type MockInstance } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AppServer } from '../server';
import { PermanentBackendError, SessionExpiredError } from '../backend/Backend';
import { createHandlers } from '../handlers/index';
import type { AppBackend } from '../backend/index';
import { GUIDES, guideUri } from '../lib/guides';
import { PROFILES } from '../lib/profiles';
import { SERVER_INFO } from '../lib/serverInfo';
import { FAMILY_SKILLS, findSkill } from '../lib/skills';
import { fakeBackend } from './fakes';
import type { FakeBackendOptions } from './fakes';

/**
 * The server itself: initialize, routing, profiles, the capability gate, the
 * response budget, healthcheck, and the session recovery that keeps a
 * long-running process working. Driven through a real MCP client over the SDK's
 * in-memory transport, so what is asserted is what a client would see.
 */

/** Gating off unless a test is about it, so connect counts mean what they say. */
const BASE_ENV: NodeJS.ProcessEnv = { MCP_GATE: 'off', SKYRIM_MO2_INSTANCE: 'test-instance' };

/** Every tool the handlers offer, plus healthcheck. */
const TOTAL_TOOLS = createHandlers(undefined as unknown as AppBackend)
    .reduce((n, h) => n + h.getTools().length, 0) + 1;

/**
 * The first tool that needs a backend feature. The gate's end-to-end tests run against it, and are
 * skipped while no tool needs one — they come back by themselves with the first gated tool.
 */
const GATED = createHandlers(undefined as unknown as AppBackend)
    .flatMap(h => h.getTools())
    .find(t => t.needsFeature);
const gatedIt = GATED ? it : it.skip;

async function connect(env: NodeJS.ProcessEnv = {}, options: FakeBackendOptions = {}) {
    const fake = fakeBackend(options);
    const server = new AppServer({ env: { ...BASE_ENV, ...env }, backend: fake.backend });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    return { client, server, ...fake };
}

const payloadOf = (result: any) => JSON.parse(result.content[0].text);
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as any;

let consoleError: MockInstance;
beforeAll(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => { }); });
afterAll(() => { consoleError.mockRestore(); });

describe('initialize', () => {
    it('announces the name and version package.json publishes', async () => {
        const { client } = await connect();
        expect(client.getServerVersion()).toEqual(expect.objectContaining(SERVER_INFO));
    });

    it('says what it is bound to and where the help is, before anything is called', async () => {
        const { client } = await connect();
        const instructions = client.getInstructions() ?? '';
        expect(instructions).toContain('the fake Mod Organizer instance');
        expect(instructions).toContain('readServerGuide');
    });
});

describe('tools/list', () => {
    it('lists everything on the default profile, healthcheck included', async () => {
        const { client } = await connect();
        const { tools } = await client.listTools();
        expect(tools.length).toBe(TOTAL_TOOLS);
        expect(tools.map(t => t.name)).toContain('healthcheck');
    });

    it('lists the profile, plus healthcheck, which sits outside every profile', async () => {
        const { client } = await connect({ MCP_PROFILE: 'core' });
        const names = (await client.listTools()).tools.map(t => t.name);

        expect(names).toContain('healthcheck');
        expect(names).not.toContain('pullProject');
        expect(names.length).toBe(PROFILES.core.tools!.length + 1);
    });

    it('sends all four hints on every tool, healthcheck included', async () => {
        // What a directory checks is the wire, not the handlers: OpenAI's rejects a
        // tool whose four hints are not all present booleans. healthcheck is defined
        // in the server rather than a handler, so only this test sees it.
        const { client } = await connect();
        const { tools } = await client.listTools();

        const incomplete = tools
            .filter(t => ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']
                .some(hint => typeof (t.annotations as any)?.[hint] !== 'boolean'))
            .map(t => t.name);
        expect(incomplete).toEqual([]);
    });
});

describe('resources', () => {
    it('lists every guide and the bundled skills', async () => {
        const { client } = await connect();
        const uris = (await client.listResources()).resources.map(r => r.uri);

        for (const guide of GUIDES) expect(uris).toContain(guideUri(guide.id));
        expect(uris.some(uri => uri.endsWith('/skills/domain/skyrim-modding-basics'))).toBe(true);
    });

    it('reads a guide as markdown', async () => {
        const { client } = await connect();
        const read = await client.readResource({ uri: guideUri('router') });
        expect(read.contents[0].mimeType).toBe('text/markdown');
        expect(String((read.contents[0] as any).text)).toMatch(/^# Tool router/);
    });

    it('refuses an unknown resource and names the real ones', async () => {
        const { client } = await connect();
        await expect(client.readResource({ uri: 'file:///etc/passwd' })).rejects.toThrow(/Unknown resource/);
    });
});

describe('routing', () => {
    it('tells a model a tool exists but is out of profile, rather than denying it', async () => {
        // Without this a model that knows the tool exists is told it does not,
        // and retries.
        const { client } = await connect({ MCP_PROFILE: 'readonly' });
        const payload = payloadOf(await call(client, 'addPatch', { project: 'x', records: ['sample'] }));

        expect(payload.error).toMatch(/exists but is not in the active profile 'readonly'/);
        expect(payload.error).toMatch(/MCP_PROFILE=all/);
    });

    it('says plainly when there is no such tool', async () => {
        const { client } = await connect();
        expect(payloadOf(await call(client, 'noSuchToolAnywhere')).error).toMatch(/Unknown tool: noSuchToolAnywhere/);
    });

    it('says first in addPatch\'s answer which records are copied as overrides, and how a new record like one is made', async () => {
        // Asked for a new sword "like the Iron Sword", a model patched the Iron Sword and renamed it (eval probe 16);
        // said after the copied files' text, e4b still did in four of six misses (eval round 22).
        const { client } = await connect();
        const payload = payloadOf(await call(client, 'addPatch', { project: 'FlameBlade', records: ['sample'] }));

        expect(Object.keys(payload).slice(0, 2)).toEqual(['status', 'note']);
        expect(payload.note).toMatch(/^sample \(000800:Sample\.esp\) is copied as an override: it changes that record itself, everywhere/);
        expect(payload.note).toMatch(/write a new file instead, mirroring it without the FormKey line.*and delete the copy/);
    });

    it('names in newProject\'s answer the skill of each record family, every one a skill the server serves', async () => {
        // 26b skipped the family skill in three of nine authoring runs; every run that read it passed (eval round 12).
        const { client } = await connect();
        const payload = payloadOf(await call(client, 'newProject', { project: 'FlameBlade' }));

        expect(payload.readFirst).toMatch(/readSkill/);
        for (const family of FAMILY_SKILLS) {
            expect(payload.readFirst).toContain(`"${family.skill}" for ${family.covers}`);
            expect(findSkill(family.skill)).toBeDefined();
        }
    });

    it('makes readonly a boundary rather than a suggestion', async () => {
        // Filtering only tools/list would leave every tool callable by a client
        // that guessed a name.
        const { client, calls } = await connect({ MCP_PROFILE: 'readonly' });
        await call(client, 'deployProject', { project: 'sample' });
        expect(calls).not.toContain('deployProject');
    });

    it('answers a tool call with exactly one level of JSON', async () => {
        const { client } = await connect();
        const payload = payloadOf(await call(client, 'readRecord', { record: 'sample' }));
        expect(payload.status).toBe('success');
        expect(payload.editorId).toBe('sample');
    });

    it('keeps the message of an argument error, with its code', async () => {
        const { client } = await connect();
        const result = await call(client, 'readRecord', { record: 'missing' });
        expect(result.isError).toBe(true);
        expect(payloadOf(result).error).toMatch(/No record with editor ID 'missing'/);
        expect(payloadOf(result).code).toBe(-32602);
    });
});

describe('the capability gate', () => {
    const without = { capabilities: async () => ['something-else'] };

    gatedIt('withholds the tools a backend cannot serve', async () => {
        const { client } = await connect({ MCP_GATE: 'on' }, without);
        const names = (await client.listTools()).tools.map(t => t.name);

        expect(names).not.toContain(GATED!.name);
        expect(names).toContain('findRecords');
    });

    gatedIt('lists everything when the backend does offer the feature', async () => {
        const { client } = await connect({ MCP_GATE: 'on' }, { capabilities: async () => [GATED!.needsFeature!] });
        expect((await client.listTools()).tools.map(t => t.name)).toContain(GATED!.name);
    });

    it.each([
        ['capabilities throws', async () => { throw new Error('backend down'); }],
        ['capabilities is undefined', async () => undefined],
        ['capabilities is empty', async () => []]
    ])('leaves the list COMPLETE when %s', async (_label, capabilities) => {
        // The important one. Hiding a tool that would have worked is invisible;
        // offering one that errors is not. Every failure path fails open.
        const { client } = await connect({ MCP_GATE: 'on' }, { capabilities });
        const names = (await client.listTools()).tools.map(t => t.name);

        if (GATED) expect(names).toContain(GATED.name);
        expect(names.length).toBe(TOTAL_TOOLS);
    });

    it('asks the backend at most once per process', async () => {
        const { client, capabilityReads } = await connect({ MCP_GATE: 'on' });

        await client.listTools();
        await client.listTools();
        await call(client, 'findRecords');

        expect(capabilityReads()).toBe(1);
    });

    it('does not ask at all when gating is switched off', async () => {
        const { client, capabilityReads } = await connect({ MCP_GATE: 'off' });
        await client.listTools();
        expect(capabilityReads()).toBe(0);
    });

    gatedIt('explains a withheld tool instead of letting it fail obscurely', async () => {
        const { client } = await connect({ MCP_GATE: 'on' }, without);
        const payload = payloadOf(await call(client, GATED!.name));

        expect(payload.error).toMatch(/does not offer/);
        // The message has to stop a retry, not merely report a failure.
        expect(payload.error).toMatch(/calling it again will not help/);
    });
});

describe('session handling', () => {
    it('connects before the first tool call, not before', async () => {
        const { client, connects } = await connect();
        expect(connects()).toBe(0);

        await call(client, 'findRecords');
        expect(connects()).toBe(1);
    });

    it('does not reconnect a session that is still good', async () => {
        const { client, connects } = await connect();
        await call(client, 'findRecords');
        await call(client, 'findRecords');
        expect(connects()).toBe(1);
    });

    it('reconnects and retries once after the backend dropped the session', async () => {
        const { client, connects, calls } = await connect({}, {
            failWith: { error: new SessionExpiredError('session expired'), times: 1 }
        });

        const result = await call(client, 'findRecords');

        expect(connects()).toBe(2);
        expect(calls.filter(c => c === 'findRecords').length).toBe(2);
        expect(result.isError).toBeFalsy();
    });

    it('does NOT retry an error that might have been applied', async () => {
        // Retrying is safe only for errors that mean the backend refused the
        // request before running it. Anything else could be applied twice.
        const { client, connects, calls } = await connect({}, {
            failWith: { error: new Error('conflict: the plugin was changed by someone else'), times: 1 }
        });

        const result = await call(client, 'findRecords');

        expect(connects()).toBe(1);
        expect(calls.filter(c => c === 'findRecords').length).toBe(1);
        expect(result.isError).toBe(true);
    });

    it('gives up rather than looping when the retry fails too', async () => {
        const { client, calls } = await connect({}, {
            failWith: { error: new SessionExpiredError('session expired'), times: 5 }
        });

        const result = await call(client, 'findRecords');

        expect(calls.filter(c => c === 'findRecords').length).toBe(2);
        expect(result.isError).toBe(true);
    });
});

describe('a credential the backend has refused', () => {
    /**
     * The retry treats an expired session as "reconnect and go again", which is
     * right for a token that timed out and ruinous for a password: a backend that
     * counts failed logons would lock the account after a few tool calls. The
     * contract is that a failure marked `permanent` is latched and re-thrown
     * without touching the backend again.
     */
    it('is tried once and never again, however many tools are called', async () => {
        const { client, connects } = await connect({}, {
            connectError: new PermanentBackendError('the backend rejected the password')
        });

        for (let i = 0; i < 5; i++) await call(client, 'findRecords');

        // Five tool calls, one connect attempt. Without the latch this is five
        // failed logons and a locked account.
        expect(connects()).toBe(1);
    });

    it('still reports the reason on every call, rather than going quiet', async () => {
        const { client } = await connect({}, {
            connectError: new PermanentBackendError('the backend rejected the password')
        });
        await call(client, 'findRecords');
        expect(payloadOf(await call(client, 'findRecords')).error).toMatch(/rejected the password/);
    });

    it('keeps retrying a failure that is not permanent', async () => {
        // An unreachable backend costs nothing to retry, and reconnecting is the
        // whole point of the self-healing path.
        const { client, connects } = await connect({}, { connectError: new Error('ECONNREFUSED') });
        for (let i = 0; i < 3; i++) await call(client, 'findRecords');
        expect(connects()).toBe(3);
    });
});

describe('healthcheck', () => {
    it('answers without connecting, so it can report on a broken backend', async () => {
        const { client, connects } = await connect();
        const payload = payloadOf(await call(client, 'healthcheck'));

        expect(connects()).toBe(0);
        expect(payload.status).toBe('healthy');
        expect(payload.boundTo).toBe('the fake Mod Organizer instance');
        expect(payload.server).toEqual(SERVER_INFO);
    });

    it('reports the active profile and the budget that follows it', async () => {
        const { client } = await connect({ MCP_PROFILE: 'core' });
        const payload = payloadOf(await call(client, 'healthcheck'));

        expect(payload.tools.profile).toBe('core');
        expect(payload.tools.responseBudgetBytes).toBe(24_000);
        // The gap between listed and available is what the profile is holding back.
        expect(payload.tools.listed).toBe(PROFILES.core.tools!.length + 1);
        expect(payload.tools.available).toBe(TOTAL_TOOLS);
    });

    it('says it did not check, rather than implying health, when there is no probe', async () => {
        const { client } = await connect();
        expect(payloadOf(await call(client, 'healthcheck')).health).toEqual({ checked: false });
    });

    it('follows the probe, and goes degraded when it fails', async () => {
        const healthy = await connect({}, { health: async () => ({ ok: true, summary: 'all good' }) });
        expect(payloadOf(await call(healthy.client, 'healthcheck')).status).toBe('healthy');

        const down = await connect({}, { health: async () => ({ ok: false, summary: 'API answered 503' }) });
        const payload = payloadOf(await call(down.client, 'healthcheck'));
        expect(payload.status).toBe('degraded');
        expect(payload.health.summary).toBe('API answered 503');
    });

    it('answers even when the probe itself blows up', async () => {
        const { client } = await connect({}, { health: async () => { throw new Error('probe vanished'); } });
        const result = await call(client, 'healthcheck');

        expect(result.isError).toBeFalsy();
        expect(payloadOf(result).health.summary).toMatch(/probe vanished/);
        expect(payloadOf(result).status).toBe('degraded');
    });

    it('names a refused credential, so an agent stops retrying', async () => {
        const { client } = await connect({}, { connectError: new PermanentBackendError('token revoked') });
        await call(client, 'findRecords');
        const payload = payloadOf(await call(client, 'healthcheck'));

        expect(payload.status).toBe('degraded');
        expect(payload.session.refused).toMatch(/token revoked/);
    });

    gatedIt('lists what this backend cannot serve once the gate has run', async () => {
        const { client } = await connect({ MCP_GATE: 'on' }, { capabilities: async () => ['other'] });
        await client.listTools();
        const payload = payloadOf(await call(client, 'healthcheck'));

        expect(payload.tools.backendMissing).toContain(GATED!.needsFeature);
        expect(payload.tools.withheldForBackend).toContain(GATED!.name);
    });
});

describe('the response budget', () => {
    it('withholds an oversized answer with valid JSON and the tool\'s own next step', async () => {
        const { client } = await connect({ MCP_MAX_RESPONSE_BYTES: '2000' });
        const payload = payloadOf(await call(client, 'readServerGuide', { guide: 'tools' }));

        expect(payload.status).toBe('truncated');
        expect(payload.nextStep).toMatch(/section/);
    });

    it('counts the withheld answer in the handler\'s metrics', async () => {
        const { client } = await connect({ MCP_MAX_RESPONSE_BYTES: '2000' });
        await call(client, 'readServerGuide', { guide: 'tools' });
        const metrics = payloadOf(await call(client, 'healthcheck')).metrics.DocsHandlers;

        expect(metrics.truncatedCount).toBe(1);
        expect(metrics.maxResponseBytes).toBeGreaterThan(2000);
    });
});

describe('bootstrap', () => {
    it('adds what the health probe found to a failed connect, and keeps it permanent', async () => {
        const { backend } = fakeBackend({
            connectError: new PermanentBackendError('the backend rejected the password'),
            health: async () => ({ ok: true, summary: 'the API itself answers' })
        });
        const server = new AppServer({ env: BASE_ENV, backend });

        const error: any = await server.bootstrap().catch(e => e);
        expect(error.message).toMatch(/rejected the password/);
        expect(error.message).toMatch(/Health probe: the API itself answers/);
        expect(error.permanent).toBe(true);
    });

    it('refuses to start on an unknown profile, before anything else', () => {
        expect(() => new AppServer({ env: { ...BASE_ENV, MCP_PROFILE: 'everything' }, backend: fakeBackend().backend }))
            .toThrow(/not a known profile/);
    });
});
