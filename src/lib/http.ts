import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseList } from 'skyrim-modding-tools-core';

/**
 * The raw-HTTP side of Streamable HTTP hosting: everything that has to happen
 * before a request reaches an MCP transport. The routing itself is
 * `AppServer.runHttp()`; see docs/Hosting.md for the whole picture.
 */

/** A body this large on /mcp is not a tool call; refusing it early is cheaper than parsing it. */
export const MAX_HTTP_BODY_BYTES = 10 * 1024 * 1024;

/** `stdio` (the default) or `http`. */
export function resolveTransportMode(env: NodeJS.ProcessEnv): 'stdio' | 'http' {
    const mode = String(env.MCP_TRANSPORT ?? '').trim().toLowerCase();
    return mode === 'http' ? 'http' : 'stdio';
}

/**
 * The caller's own bearer token — this server's only credential for an HTTP
 * session, and the only thing that makes one caller's session distinct from
 * another's.
 */
export function extractBearerToken(req: IncomingMessage): string | undefined {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return match?.[1];
}

/** Reads and JSON-parses the body of an HTTP request, capped against an unbounded body. */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_HTTP_BODY_BYTES) {
                req.destroy();
                reject(new Error(`request body exceeds ${MAX_HTTP_BODY_BYTES} bytes`));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

/** A JSON-RPC error response on the raw HTTP layer — before any transport or session exists. */
export function writeJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

/** Scheme, host and port, lower-cased, so two spellings of one origin compare equal. */
function normalizeOrigin(origin: string): string {
    try {
        return new URL(origin).origin.toLowerCase();
    } catch {
        return origin.trim().toLowerCase();
    }
}

/** The headers a browser client has to be allowed to send, and to read back. */
export const CORS_REQUEST_HEADERS =
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID';
export const CORS_EXPOSED_HEADERS = 'Mcp-Session-Id';

export interface OriginPolicy {
    /** `*` was allow-listed: every origin passes, and CORS headers are echoed back. */
    any: boolean;
    list: Set<string>;
}

/**
 * Which browser origins may talk to `/mcp` — the DNS-rebinding guard the MCP
 * spec asks a Streamable HTTP server to apply for itself.
 *
 * A reverse proxy cannot do this one. A page on any origin can make the browser
 * resolve a name it controls to `127.0.0.1` and post to whatever is listening
 * there, so binding to loopback is not an access control, and the proxy is not
 * in that request's path at all. What the attacking page cannot forge is the
 * `Origin` header the browser attaches, so that is what is checked.
 *
 * Requests carrying no `Origin` pass: those are not browser requests, which is
 * every MCP client that is not a web page. `initialize` is a JSON POST, which
 * no browser can send without a preflight, so a real browser always announces
 * itself here.
 */
export function resolveOriginPolicy(env: NodeJS.ProcessEnv): OriginPolicy {
    const entries = parseList(env.MCP_HTTP_ALLOWED_ORIGINS);
    return {
        any: entries.includes('*'),
        list: new Set(entries.filter(entry => entry !== '*').map(normalizeOrigin))
    };
}

export function originAllowed(origin: string, policy: OriginPolicy): boolean {
    return policy.any || policy.list.has(normalizeOrigin(origin));
}

/** The `Host` values this server answers to. Empty means any. */
export function resolveAllowedHosts(env: NodeJS.ProcessEnv): string[] {
    return parseList(env.MCP_HTTP_ALLOWED_HOSTS);
}

/**
 * Defence in depth behind the origin check: a `Host` allow-list, for the
 * rebinding case where the attacker's name — not the operator's — is what
 * resolved to this server. Unset means any Host, which is what a deployment
 * behind a proxy that already rewrites Host wants.
 */
export function hostAllowed(req: IncomingMessage, allowed: string[]): boolean {
    if (allowed.length === 0) return true;
    const host = String(req.headers.host ?? '').toLowerCase();
    const withoutPort = host.replace(/:\d+$/, '');
    return allowed.some(entry => {
        const candidate = entry.toLowerCase();
        return candidate === host || candidate === withoutPort;
    });
}

export interface RateLimiter {
    /** Spends one request's worth of budget, or says how long to wait for it. */
    take(key: string): { ok: true } | { ok: false; retryAfter: number };
}

/**
 * A per-session request ceiling, off unless `MCP_HTTP_RATE_LIMIT` sets one.
 *
 * This is not the proxy's rate limit and does not replace it. A proxy sees
 * addresses; the thing worth limiting here is one *session* — one agent that
 * has gone into a loop and is putting load on a shared backend, which looks
 * exactly like healthy traffic from the front and takes the backend down for
 * everyone else. A token bucket rather than a fixed window, so a burst of
 * legitimate reads inside one turn is not punished for arriving together.
 */
export function createRateLimiter(env: NodeJS.ProcessEnv): RateLimiter | undefined {
    const limit = Number(env.MCP_HTTP_RATE_LIMIT ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) return undefined;

    const windowMs = 60_000;
    const refillPerMs = limit / windowMs;
    const buckets = new Map<string, { tokens: number; updated: number }>();

    return {
        take(key: string) {
            const now = Date.now();
            // Sessions come and go; buckets belonging to ones long gone are swept
            // rather than tracked, so nothing has to be told a session ended.
            if (buckets.size > 1024) {
                for (const [id, bucket] of buckets) {
                    if (now - bucket.updated > windowMs * 2) buckets.delete(id);
                }
            }
            const bucket = buckets.get(key) ?? { tokens: limit, updated: now };
            bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updated) * refillPerMs);
            bucket.updated = now;
            buckets.set(key, bucket);

            if (bucket.tokens < 1) {
                const waitMs = (1 - bucket.tokens) / refillPerMs;
                return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
            }
            bucket.tokens -= 1;
            return { ok: true };
        }
    };
}

/**
 * What the rate limit counts. The session once there is one; before that the
 * credential the caller presented, hashed because this is a map key that stays
 * in memory and a bearer token is not something to keep a copy of. The peer
 * address is the last resort, for a request that has neither.
 */
export function rateLimitKey(req: IncomingMessage): string {
    const sessionId = req.headers['mcp-session-id'];
    if (typeof sessionId === 'string' && sessionId) return `session:${sessionId}`;
    const credential = extractBearerToken(req);
    if (credential) {
        return `token:${createHash('sha256').update(credential).digest('hex').slice(0, 32)}`;
    }
    return `peer:${req.socket.remoteAddress ?? 'unknown'}`;
}
