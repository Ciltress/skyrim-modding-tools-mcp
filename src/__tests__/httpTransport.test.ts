import { vi, type MockInstance } from 'vitest';
import { AppServer } from '../server';
import { PermanentBackendError } from 'skyrim-modding-tools-core';
import { fakeBackend } from 'skyrim-modding-tools-core/testing';

/**
 * The Streamable HTTP transport (MCP_TRANSPORT=http): the bearer-token gate,
 * per-connection session isolation, the binding of a session to the token that
 * opened it, and the session-id routing that decides whether a request creates
 * a session, reuses one, or is rejected.
 *
 * `createSessionServer` is overridden here for exactly the reason
 * `ServerDependencies` exists on AppServer itself: so this can be tested
 * without a real backend. Each simulated connection gets a fake backend that
 * accepts only 'good-token' or 'other-good-token'.
 */

const BASE_ENV: NodeJS.ProcessEnv = {
    MCP_GATE: 'off',
    MCP_TRANSPORT: 'http',
    MCP_HTTP_PORT: '0',
    MCP_HTTP_HOST: '127.0.0.1',
    SKYRIM_MO2_INSTANCE: 'test-instance'
};

const ACCEPTED = ['good-token', 'other-good-token'];

class TestableServer extends AppServer {
    /** The token each session was built with, in order. */
    readonly sessionTokens: string[] = [];

    startHttp() {
        return (this as any).runHttp() as Promise<{ port: number; close(): Promise<void> }>;
    }

    protected createSessionServer(env: NodeJS.ProcessEnv, bearerToken: string): AppServer {
        this.sessionTokens.push(bearerToken);
        const { backend } = fakeBackend(ACCEPTED.includes(bearerToken)
            ? {}
            : { connectError: new PermanentBackendError('the backend refused this token') });
        return new AppServer({ env, backend });
    }
}

async function startServer(extraEnv: NodeJS.ProcessEnv = {}) {
    const server = new TestableServer({ env: { ...BASE_ENV, ...extraEnv }, backend: fakeBackend().backend });
    const { port, close } = await server.startHttp();
    return { url: `http://127.0.0.1:${port}/mcp`, close, server };
}

const initializeMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
    }
};

const toolsList = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const headers = (token?: string) => ({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
});

const post = (url: string, body: unknown, extra: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: extra, body: JSON.stringify(body) });

/** Opens a session and answers its id. */
async function openSession(url: string, token: string): Promise<string> {
    const response = await post(url, initializeMessage, headers(token));
    expect(response.status).toBe(200);
    await response.text();
    return response.headers.get('mcp-session-id')!;
}

let consoleError: MockInstance;
beforeAll(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => { }); });
afterAll(() => { consoleError.mockRestore(); });

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
    await close?.();
    close = undefined;
});

describe('Streamable HTTP transport', () => {
    it('rejects a request with no Authorization header', async () => {
        const server = await startServer();
        close = server.close;

        const response = await post(server.url, initializeMessage, headers());

        expect(response.status).toBe(401);
        expect((await response.json()).error.message).toMatch(/Authorization/);
    });

    it('rejects a token the backend refuses', async () => {
        const server = await startServer();
        close = server.close;

        const response = await post(server.url, initializeMessage, headers('bad-token'));

        expect(response.status).toBe(401);
        expect((await response.json()).error.message).toMatch(/refused this session's token/);
    });

    it('establishes a session per bearer token and serves tools/list on it', async () => {
        const server = await startServer();
        close = server.close;

        const sessionId = await openSession(server.url, 'good-token');
        expect(sessionId).toBeTruthy();

        const response = await post(server.url, toolsList, { ...headers('good-token'), 'mcp-session-id': sessionId });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('findRecords');
    });

    it('builds one backend per caller, each with that caller\'s own token', async () => {
        const server = await startServer();
        close = server.close;

        const first = await openSession(server.url, 'good-token');
        const second = await openSession(server.url, 'other-good-token');

        expect(first).not.toBe(second);
        expect(server.server.sessionTokens).toEqual(['good-token', 'other-good-token']);
    });

    it('binds a session to the token that opened it', async () => {
        // A session id is a routing key, not a credential — the MCP specification
        // says not to authenticate by it. Someone holding only the id, or the id
        // and their own token, must not be served as the session's owner.
        const server = await startServer();
        close = server.close;
        const sessionId = await openSession(server.url, 'good-token');

        const otherToken = await post(server.url, toolsList, { ...headers('other-good-token'), 'mcp-session-id': sessionId });
        expect(otherToken.status).toBe(401);
        expect((await otherToken.json()).error.message).toMatch(/different credential/);

        const noToken = await post(server.url, toolsList, { ...headers(), 'mcp-session-id': sessionId });
        expect(noToken.status).toBe(401);
    });

    it('rejects an unknown Mcp-Session-Id', async () => {
        const server = await startServer();
        close = server.close;

        const response = await post(server.url, toolsList, { ...headers('good-token'), 'mcp-session-id': 'not-a-real-session' });
        expect(response.status).toBe(404);
    });

    it('wants initialize before anything else', async () => {
        const server = await startServer();
        close = server.close;

        const response = await post(server.url, toolsList, headers('good-token'));
        expect(response.status).toBe(400);
    });

    it('404s anything outside /mcp', async () => {
        const server = await startServer();
        close = server.close;

        const response = await fetch(server.url.replace('/mcp', '/other'));
        expect(response.status).toBe(404);
    });
});

describe('Streamable HTTP with the real backend factory', () => {
    it('accepts only the tokens SKYRIM_ACCEPTED_TOKENS names', async () => {
        // No createSessionServer override: this is the wiring that ships.
        const server = new AppServer({ env: { ...BASE_ENV, SKYRIM_ACCEPTED_TOKENS: 'let-me-in' } });
        const started = await (server as any).runHttp();
        close = started.close;
        const url = `http://127.0.0.1:${started.port}/mcp`;

        expect((await post(url, initializeMessage, headers('let-me-in'))).status).toBe(200);
        expect((await post(url, initializeMessage, headers('guess'))).status).toBe(401);
    });

    it('accepts nobody when no tokens are configured, and says how to fix it', async () => {
        const server = new AppServer({ env: BASE_ENV });
        const started = await (server as any).runHttp();
        close = started.close;

        const response = await post(`http://127.0.0.1:${started.port}/mcp`, initializeMessage, headers('anything'));
        expect(response.status).toBe(401);
        expect((await response.json()).error.message).toMatch(/SKYRIM_ACCEPTED_TOKENS/);
    });
});

/**
 * The origin allow-list is the one guard in this transport a reverse proxy
 * cannot supply, because a rebinding attempt never passes through the proxy:
 * the browser resolves the attacker's name to wherever this is listening and
 * posts straight to it. So it is checked here, and these cover both answers.
 */
describe('Streamable HTTP origin allow-list', () => {
    it('rejects a browser origin when none are allowed', async () => {
        const server = await startServer();
        close = server.close;

        const response = await post(server.url, initializeMessage,
            { ...headers('good-token'), Origin: 'https://evil.example.com' });

        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect((await response.json()).error.message).toMatch(/Origin .* is not allowed/);
    });

    it('rejects an origin outside the allow-list', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_ORIGINS: 'https://ide.example.com' });
        close = server.close;

        const response = await post(server.url, initializeMessage,
            { ...headers('good-token'), Origin: 'https://evil.example.com' });
        expect(response.status).toBe(403);
    });

    it('serves an allow-listed origin and echoes it back with CORS headers', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_ORIGINS: 'https://ide.example.com, https://other.example.com' });
        close = server.close;

        const response = await post(server.url, initializeMessage,
            { ...headers('good-token'), Origin: 'https://ide.example.com' });

        expect(response.status).toBe(200);
        // Echoed rather than '*': a browser refuses '*' on a credentialed request.
        expect(response.headers.get('access-control-allow-origin')).toBe('https://ide.example.com');
        expect(response.headers.get('access-control-expose-headers')).toMatch(/Mcp-Session-Id/i);
        expect(response.headers.get('vary')).toMatch(/Origin/i);
    });

    it('allows every origin when * is allow-listed', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_ORIGINS: '*' });
        close = server.close;

        const response = await post(server.url, initializeMessage,
            { ...headers('good-token'), Origin: 'https://anything.example.com' });

        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://anything.example.com');
    });

    it('leaves a request with no Origin alone — every non-browser MCP client', async () => {
        const server = await startServer();
        close = server.close;

        const response = await post(server.url, initializeMessage, headers('good-token'));
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('answers a preflight from an allow-listed origin', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_ORIGINS: 'https://ide.example.com' });
        close = server.close;

        const response = await fetch(server.url, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://ide.example.com',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization, content-type'
            }
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-methods')).toMatch(/POST/);
        expect(response.headers.get('access-control-allow-headers')).toMatch(/Authorization/i);
        expect(response.headers.get('access-control-allow-headers')).toMatch(/Mcp-Session-Id/i);
    });

    it('refuses a preflight from an origin that is not allowed', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_ORIGINS: 'https://ide.example.com' });
        close = server.close;

        const response = await fetch(server.url, {
            method: 'OPTIONS',
            headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' }
        });

        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-methods')).toBeNull();
    });

    it('rejects a Host outside the allow-list', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_HOSTS: 'mcp.example.com' });
        close = server.close;

        // `Host` is a forbidden header for fetch, so this arrives as the loopback
        // address the test connected to — which is exactly the case that matters:
        // a name that is not the one the operator published.
        const response = await post(server.url, initializeMessage, headers('good-token'));

        expect(response.status).toBe(403);
        expect((await response.json()).error.message).toMatch(/Host .* is not allowed/);
    });

    it('accepts an allow-listed Host whatever port it came in on', async () => {
        const server = await startServer({ MCP_HTTP_ALLOWED_HOSTS: 'mcp.example.com, 127.0.0.1' });
        close = server.close;

        // The listening port is ephemeral here, so matching at all proves the
        // allow-list compares the name with the port stripped.
        expect((await post(server.url, initializeMessage, headers('good-token'))).status).toBe(200);
    });
});

describe('Streamable HTTP rate limit', () => {
    it('is off unless MCP_HTTP_RATE_LIMIT sets one', async () => {
        const server = await startServer();
        close = server.close;

        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect((await post(server.url, initializeMessage, headers('bad-token'))).status).toBe(401);
        }
    });

    it('429s the caller past its budget, with a Retry-After', async () => {
        const server = await startServer({ MCP_HTTP_RATE_LIMIT: '2' });
        close = server.close;

        const send = () => post(server.url, initializeMessage, headers('bad-token'));
        expect((await send()).status).toBe(401);
        expect((await send()).status).toBe(401);

        const limited = await send();
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
        expect((await limited.json()).error.message).toMatch(/Rate limit exceeded/);
    });

    it('counts each caller separately', async () => {
        const server = await startServer({ MCP_HTTP_RATE_LIMIT: '2' });
        close = server.close;

        const send = (token: string) => post(server.url, initializeMessage, headers(token));
        expect((await send('one')).status).toBe(401);
        expect((await send('one')).status).toBe(401);
        expect((await send('one')).status).toBe(429);
        // A second caller's budget is untouched by the first exhausting theirs.
        expect((await send('two')).status).toBe(401);
    });
});
