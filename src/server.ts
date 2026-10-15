import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { REQUIRED_ENV, createBackend, isPermanent } from './backend/index.js';
import type { AppBackend, HealthReport } from './backend/index.js';
import { createHandlers } from './handlers/index.js';
import type { BaseHandler } from './handlers/index.js';
import { GUIDES, guideByUri, guideUri, readGuideFile } from './lib/guides.js';
import { discoverSkills, readSkillFile, skillByUri, skillUri } from './lib/skills.js';
import { applyProfile, resolveProfile } from './lib/profiles.js';
import type { ProfileName } from './lib/profiles.js';
import { capToolResult, resolveResponseBudget } from './lib/responseBudget.js';
import { evaluateGate, gatingEnabled } from './lib/capabilityGate.js';
import type { GateResult } from './lib/capabilityGate.js';
import { serverInstructions } from './lib/instructions.js';
import { SERVER_INFO } from './lib/serverInfo.js';
import {
  CORS_EXPOSED_HEADERS,
  CORS_REQUEST_HEADERS,
  createRateLimiter,
  extractBearerToken,
  hostAllowed,
  originAllowed,
  rateLimitKey,
  readJsonBody,
  resolveAllowedHosts,
  resolveOriginPolicy,
  resolveTransportMode,
  writeJsonRpcError,
} from './lib/http.js';
import type { ToolDefinition } from './types/tools.js';

/**
 * How long to wait for the backend's capabilities before giving up on gating.
 * Short on purpose: this runs inside tools/list, which a client blocks on at
 * connect, and an ungated list is a perfectly good answer.
 */
const GATE_TIMEOUT_MS = 8_000;

/** How long healthcheck waits for the backend's health probe. A client is waiting on it. */
const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Tool names that were renamed, kept callable so existing clients keep working.
 * Aliases are routable but deliberately not listed by tools/list. An alias
 * whose target no longer exists routes nowhere, so remove it with the target.
 */
const TOOL_ALIASES: Record<string, string> = {};

/** Rejects with `label timed out` if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms).unref(),
    ),
  ]);
}

/** A digest to remember a credential by, without keeping the credential. */
const credentialDigest = (credential: string) =>
  createHash('sha256').update(credential).digest();

/**
 * What the server needs from outside itself.
 *
 * Both optional, and both defaulted to the real thing, so the production entry
 * point stays `new AppServer()`. They exist because the behaviour that matters
 * most here is recovery — the retry after a backend drops a session, the latch
 * after it refuses a credential, a capability gate that must never fail closed —
 * and none of that could be exercised if the only way to build this class were
 * to connect to a real backend.
 */
export interface ServerDependencies {
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to createBackend(env). */
  backend?: AppBackend;
}

export class AppServer extends Server {
  private readonly backend: AppBackend;
  /** The environment this server was built from. Injectable, so a test need not mutate process.env. */
  private readonly env: NodeJS.ProcessEnv;
  /** Which tools this server lists and routes. Resolved once, at startup. */
  private readonly profile: ProfileName;
  /** Ceiling on one answer, in bytes. 0 means none. Follows the profile. */
  private readonly responseBudget: number;

  /** Every handler, in tools/list order. */
  private handlers: BaseHandler[] = [];
  /** tool name (and alias) -> owning handler. Built from getTools(), so a listed tool is always callable. */
  private readonly toolRoutes = new Map<string, BaseHandler>();
  /** tool name -> its definition, for the facts that travel with a tool rather than in a registry. */
  private readonly toolDefinitions = new Map<string, ToolDefinition>();
  /** The profile's tools, in tools/list order. Computed once — getTools() is static. */
  private listedTools: ToolDefinition[] = [];
  /** Tools this backend cannot serve, and why. Empty until the gate has run. */
  private gate: GateResult = { unavailable: new Map(), missing: [] };
  /** In flight or settled; the gate is evaluated at most once per process. */
  private gatePromise?: Promise<void>;
  /**
   * Latched once the backend has refused the credential itself, rather than
   * aged a session out. Nothing tries again.
   *
   * The retry below treats an expired session as "reconnect and go again",
   * which is right for a token that timed out and ruinous for a password or a
   * client secret that is wrong: every tool call would spend one more failed
   * logon until the account is locked for everything that uses it. Failing the
   * same way every time, without touching the backend, is the only safe answer.
   */
  private permanentFailure?: Error;

  constructor(dependencies: ServerDependencies = {}) {
    const env = dependencies.env ?? process.env;

    // All resolved before super(), so a misconfiguration fails at startup,
    // loudly, rather than on the first tool call.
    const missing = REQUIRED_ENV.filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    const profile = resolveProfile(env);
    const responseBudget = resolveResponseBudget(profile, env);
    const backend = dependencies.backend ?? createBackend(env);

    super(
      { name: SERVER_INFO.name, version: SERVER_INFO.version },
      {
        capabilities: {
          tools: {},
          // The server's own documentation and the bundled skills.
          resources: {},
        },
        // The only thing a client sees before it calls anything — and therefore
        // the only way it can tell several of these servers apart.
        instructions: serverInstructions(backend.describe()),
      },
    );

    this.backend = backend;
    this.env = env;
    this.profile = profile;
    this.responseBudget = responseBudget;

    this.handlers = createHandlers(this.backend);
    this.buildToolRoutes();
    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  /**
   * Derives the router from getTools(), so a tool can never be listed without
   * being callable — which is what a hand-maintained switch allows.
   *
   * The profile decides what is listed *and* what is routed. Filtering only
   * tools/list would leave every tool callable by a client that guessed a name,
   * which would make `readonly` a suggestion rather than a boundary.
   */
  private buildToolRoutes(): void {
    const offered = this.handlers.flatMap((handler) => handler.getTools());
    for (const tool of offered) {
      if (!this.toolDefinitions.has(tool.name)) this.toolDefinitions.set(tool.name, tool);
    }
    this.listedTools = applyProfile(this.profile, offered);
    const listed = new Set(this.listedTools.map((tool) => tool.name));

    for (const handler of this.handlers) {
      for (const tool of handler.getTools()) {
        if (!listed.has(tool.name)) continue;

        const existing = this.toolRoutes.get(tool.name);
        if (existing) {
          console.error(
            `[MCP] duplicate tool '${tool.name}': ${handler.constructor.name} ignored, ` +
              `${existing.constructor.name} keeps it`,
          );
          continue;
        }
        this.toolRoutes.set(tool.name, handler);
      }
    }

    for (const [alias, target] of Object.entries(TOOL_ALIASES)) {
      const handler = this.toolRoutes.get(target);
      if (handler && !this.toolRoutes.has(alias)) this.toolRoutes.set(alias, handler);
    }
  }

  /**
   * Connects (or reconnects) the backend. Safe to call repeatedly — used for the
   * eager connect at startup and as self-healing before and after tool calls.
   */
  private async ensureConnected(): Promise<void> {
    // Re-thrown without contacting the backend: see the field's comment.
    if (this.permanentFailure) throw this.permanentFailure;
    try {
      await this.backend.connect();
    } catch (error) {
      if (isPermanent(error)) this.permanentFailure = error as Error;
      throw error;
    }
  }

  /**
   * Evaluates the capability gate once, and never lets it break anything.
   *
   * Every failure path — no session, backend down, a backend that cannot say, a
   * slow one — ends with an empty gate and a full tool list. Hiding a tool that
   * would have worked is a worse outcome than offering one that fails, because
   * the first is invisible.
   */
  private async ensureGate(): Promise<void> {
    if (this.gatePromise) return this.gatePromise;

    this.gatePromise = (async () => {
      if (!gatingEnabled(this.env)) return;
      try {
        if (!this.backend.connected) await this.ensureConnected();
        const capabilities = await withTimeout(
          this.backend.capabilities(),
          GATE_TIMEOUT_MS,
          'capabilities',
        );

        // The catalogue rather than the profile's slice: a tool withheld by the
        // profile is not listed anyway, and gating the whole set keeps
        // healthcheck's `withheldForBackend` honest about the backend.
        this.gate = evaluateGate(capabilities, this.handlers.flatMap((h) => h.getTools()));
        if (this.gate.missing.length) {
          console.error(
            `[MCP] the backend does not offer: ${this.gate.missing.join(', ')} — ` +
              `${this.gate.unavailable.size} tool(s) withheld`,
          );
        }
      } catch (error: any) {
        // Deliberately swallowed. See the note above.
        console.error(
          `[MCP] could not read the backend's capabilities (${error?.message ?? error}); ` +
            `offering every tool in the profile`,
        );
      }
    })();

    return this.gatePromise;
  }

  /**
   * Asks the backend about the error and everything it wraps. BaseHandler turns
   * a backend failure into an McpError for the client, keeping the original as
   * `cause` — and the original is what the backend can recognise.
   */
  private isSessionExpired(error: unknown): boolean {
    for (let current = error, depth = 0; current && depth < 5; depth++) {
      if (this.backend.isSessionExpired(current)) return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }

  /** True for anything already shaped like an MCP tool result. */
  private isToolResult(result: any): boolean {
    return !!result && typeof result === 'object' && Array.isArray(result.content);
  }

  /**
   * The single funnel every answer passes through — which is why the response
   * budget is enforced here rather than in each handler. A tool added tomorrow is
   * covered without being told about it.
   *
   * Handlers already return `{content:[{type:'text',text:'<json>'}]}`. Passing
   * that through instead of stringifying it again is what stops every response
   * from arriving as a JSON string nested inside a JSON string.
   */
  private serializeResult(result: any, toolName = 'unknown', handler?: BaseHandler) {
    try {
      const envelope = this.isToolResult(result)
        ? result
        : {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, (key, value) =>
                  typeof value === 'bigint' ? value.toString() : value,
                ),
              },
            ],
          };

      // The tool's own narrowing advice travels with its definition, so a rename
      // cannot leave the hint behind.
      const capped = capToolResult(
        toolName,
        envelope,
        this.responseBudget,
        this.toolDefinitions.get(toolName)?.narrowingHint,
      );
      handler?.trackResponseBytes(capped.bytes, capped.truncated);

      if (capped.truncated) {
        console.error(
          `[MCP] ${toolName} answered ${capped.bytes} bytes, over the ${this.responseBudget} byte ` +
            `budget for profile '${this.profile}' — withheld`,
        );
      }
      return capped.result;
    } catch {
      return this.handleError(new McpError(ErrorCode.InternalError, 'Failed to serialize result'));
    }
  }

  private handleError(error: unknown) {
    if (!(error instanceof Error)) {
      error = new Error(String(error));
    }
    if (error instanceof McpError) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message, code: error.code }) }],
        isError: true,
      };
    }
    // Not an McpError: keep the message instead of replacing it with a generic
    // one, and log the stack for the operator.
    const err = error as Error;
    console.error('[MCP Error]', err);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: err.message || 'Internal server error',
            code: ErrorCode.InternalError,
          }),
        },
      ],
      isError: true,
    };
  }

  /** The healthcheck tool is defined here rather than in a handler: it must work without a backend session. */
  private healthcheckTool(): ToolDefinition {
    return {
      name: 'healthcheck',
      annotations: {
        title: 'Health and identity',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'What this server is bound to, whether the backend answers, and per-handler call metrics. ' +
        'Call it to find out whether this is the right server for a request that names a target — a ' +
        'server cannot switch target at runtime — or when calls start failing. It never connects to ' +
        'the backend, so it answers when everything else fails. Also reports the active tool profile, ' +
        'the response budget, and anything withheld because the backend does not support it.',
      inputSchema: { type: 'object', properties: {} },
    };
  }

  /**
   * Runs the backend's health probe, and never lets the answer be an exception.
   *
   * A healthcheck that throws when the backend is unreachable reports nothing at
   * the one moment it is worth calling, so every failure — including a probe
   * that cannot run at all — comes back as data. `checked: false` is deliberate:
   * a backend with no probe has no verdict to give, and saying so beats implying
   * it is fine.
   */
  private async checkHealth(): Promise<{ checked: false } | ({ checked: true } & HealthReport)> {
    if (!this.backend.health) return { checked: false };
    try {
      const report = await withTimeout(this.backend.health(), HEALTH_TIMEOUT_MS, 'health probe');
      return { checked: true, ...report };
    } catch (error) {
      return {
        checked: true,
        ok: false,
        summary: `The health probe itself failed: ${(error as Error)?.message ?? error}`,
      };
    }
  }

  private async healthcheck() {
    const metrics: Record<string, ReturnType<BaseHandler['getMetrics']>> = {};
    for (const handler of this.handlers) metrics[handler.constructor.name] = handler.getMetrics();

    const health = await this.checkHealth();

    return {
      // Follows the probe, and stays 'healthy' when there was no probe to follow,
      // since an unchecked backend is not a failed one. A refused credential is
      // degraded whatever the probe says: the backend is up, and still nothing
      // this server offers will work.
      status: (health.checked && !health.ok) || this.permanentFailure ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      server: SERVER_INFO,
      // The answer to "is this the right server?" without a round trip.
      boundTo: this.backend.describe(),
      health,
      session: {
        connected: this.backend.connected,
        // Named rather than implied, so an agent reading this knows why every
        // call is about to fail instead of retrying it.
        ...(this.permanentFailure
          ? { refused: this.permanentFailure.message, retried: false }
          : {}),
      },
      tools: {
        profile: this.profile,
        // 0 means no ceiling. Reported because a withheld answer is otherwise
        // indistinguishable from a tool that simply returned little.
        responseBudgetBytes: this.responseBudget,
        // healthcheck is listed but not in toolRoutes; aliases are the other way round.
        listed: this.listedTools.filter((t) => !this.gate.unavailable.has(t.name)).length + 1,
        // Features this backend does not offer, and the tools withheld with them.
        // Empty when the gate has not run or found nothing missing.
        backendMissing: this.gate.missing,
        withheldForBackend: [...this.gate.unavailable.keys()],
        // What the handlers offer in total, so the gap to `listed` shows what the
        // profile is holding back rather than leaving it to be guessed.
        available: this.handlers.reduce((n, h) => n + h.getTools().length, 0) + 1,
        aliases: Object.keys(TOOL_ALIASES).filter((alias) => this.toolRoutes.has(alias)).length,
      },
      metrics,
    };
  }

  /**
   * Exposes the guides and skills as MCP resources as well as through tools.
   * Resources are the idiomatic primitive and let a user attach a document in
   * their client; the tools are what an agent can reach for by itself.
   */
  private setupResourceHandlers() {
    this.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        ...GUIDES.map((guide) => ({
          uri: guideUri(guide.id),
          name: guide.title,
          description: guide.description,
          mimeType: 'text/markdown',
        })),
        // Discovered from skills/, so a collection added on disk is reflected
        // after a restart without a rebuild.
        ...discoverSkills().map((skill) => ({
          uri: skillUri(skill),
          name: `${skill.collection}: ${skill.name}`,
          description: skill.description,
          mimeType: 'text/markdown',
        })),
      ],
    }));

    this.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      const guide = guideByUri(uri);
      if (guide) {
        return { contents: [{ uri, mimeType: 'text/markdown', text: readGuideFile(guide) }] };
      }

      const skill = skillByUri(uri);
      if (skill) {
        return { contents: [{ uri, mimeType: 'text/markdown', text: readSkillFile(skill) }] };
      }

      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown resource '${uri}'. Guides: ${GUIDES.map((g) => guideUri(g.id)).join(', ')}. ` +
          `Skills are listed by resources/list.`,
      );
    });
  }

  private setupToolHandlers() {
    this.setRequestHandler(ListToolsRequestSchema, async () => {
      // Ask the backend what it supports before answering, so a client never sees
      // a tool it cannot serve. At most one round trip per process, and it can
      // only ever shorten the list — never fail it.
      await this.ensureGate();
      return {
        // healthcheck is outside every profile on purpose: it is how a client finds
        // out which profile is active, so it has to be there in all of them.
        tools: [
          ...this.listedTools.filter((tool) => !this.gate.unavailable.has(tool.name)),
          this.healthcheckTool(),
        ],
      };
    });

    this.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      try {
        if (name === 'healthcheck') return this.serializeResult(await this.healthcheck(), 'healthcheck');

        // Not only in tools/list: a client is free to call a tool it already knows
        // about without listing first, and it would otherwise reach an ungated
        // server. Memoised, so this costs one round trip per process at most.
        await this.ensureGate();

        // A tool the backend cannot serve. Saying so beats the 400 the call would
        // otherwise produce, which reads as a transient failure and invites a retry.
        const withheld = this.gate.unavailable.get(name);
        if (withheld) throw new McpError(ErrorCode.InvalidRequest, withheld);

        const handler = this.toolRoutes.get(name);
        if (!handler) {
          // Distinguish "no such tool" from "not in this profile". Without this a
          // model that knows the tool exists gets told it does not, and retries.
          const exists = this.handlers.some((h) => h.getTools().some((t) => t.name === name));
          throw new McpError(
            ErrorCode.MethodNotFound,
            exists
              ? `Tool '${name}' exists but is not in the active profile '${this.profile}'. ` +
                  `Start the server with MCP_PROFILE=all to reach it, or use a listed tool.`
              : `Unknown tool: ${name}`,
          );
        }

        // Self-healing, part one: no session at all yet.
        if (!this.backend.connected) await this.ensureConnected();

        try {
          return this.serializeResult(
            await handler.handle(name, request.params.arguments),
            name,
            handler,
          );
        } catch (error) {
          // Part two: a session the backend dropped on its own — an idle timeout,
          // an expired token. `connected` cannot know that until a call fails.
          //
          // Retrying is safe for exactly the errors isSessionExpired() accepts:
          // the backend refused the request *before* running it, so nothing was
          // applied and nothing can be applied twice. Once, never in a loop.
          if (!this.isSessionExpired(error)) throw error;
          console.error('[MCP] session expired, reconnecting and retrying', name);
          await this.ensureConnected();
          return this.serializeResult(
            await handler.handle(name, request.params.arguments),
            name,
            handler,
          );
        }
      } catch (error) {
        return this.handleError(error);
      }
    });
  }

  /**
   * Adds what the health probe found to a failed connect.
   *
   * This is the path that matters most and the one healthcheck cannot cover: the
   * connect runs before the transport is up, so a failure here exits the process
   * and the client sees a server that died without saying why. The probe cannot
   * make things worse — whatever it finds is appended to the original error, and
   * a refused credential stays marked permanent.
   */
  private async explainStartupFailure(error: unknown): Promise<Error> {
    const original = error instanceof Error ? error : new Error(String(error));
    const health = await this.checkHealth();
    if (!health.checked) return original;

    const explained = new Error(`${original.message}\n\nHealth probe: ${health.summary}`);
    explained.name = original.name;
    (explained as any).cause = original;
    if (isPermanent(original)) (explained as any).permanent = true;
    return explained;
  }

  /**
   * Connects the backend and says what it connected to. Public and separate from
   * run() so HTTP hosting can call it once per MCP session — each of which is a
   * distinct AppServer with its own backend — rather than once per process.
   */
  async bootstrap(): Promise<void> {
    try {
      await this.ensureConnected();
    } catch (error) {
      throw await this.explainStartupFailure(error);
    }
    // stderr only: stdout is the MCP frame stream.
    console.error(`[MCP] connected to ${this.backend.describe()}`);
  }

  async run() {
    if (resolveTransportMode(this.env) === 'http') {
      await this.runHttp();
      return;
    }

    // Eagerly, so a wrong credential or an unreachable backend fails here, with
    // a diagnosis, rather than on the first tool call.
    await this.bootstrap();

    const transport = new StdioServerTransport();
    await this.connect(transport);
    console.error(`${SERVER_INFO.name} ${SERVER_INFO.version} running on stdio`);

    const shutdown = async () => {
      await this.close();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    this.onerror = (error) => {
      console.error('[MCP Error]', error);
    };
  }

  /**
   * Builds the AppServer for one HTTP/MCP session, with a backend that carries
   * that caller's own bearer token. Overridable so a test can substitute a fake
   * backend without touching the routing below.
   */
  protected createSessionServer(env: NodeJS.ProcessEnv, bearerToken: string): AppServer {
    return new AppServer({ env, backend: createBackend(env, { bearerToken }) });
  }

  /**
   * Serves Streamable HTTP instead of stdio, for a long-lived server several
   * people connect to. `Server.connect()` allows exactly one transport per
   * instance for its whole lifetime, so this cannot reuse `this` across
   * connections the way stdio does — one new AppServer, with its own backend, is
   * built per MCP session. That is the point rather than a limitation: each
   * caller presents its own bearer token on `initialize`, which becomes that
   * session's own identity towards the backend — per-user isolation, not one
   * shared credential serving everyone who connects.
   *
   * Three gates sit in front of that, in this order: the origin/host allow-list
   * (which a reverse proxy cannot do for us), the per-session rate limit (off by
   * default), and the credential. A session stays bound to the credential that
   * opened it. See docs/Hosting.md.
   */
  protected async runHttp(): Promise<{ port: number; close(): Promise<void> }> {
    const port = Number(this.env.MCP_HTTP_PORT ?? 3000);
    const host = this.env.MCP_HTTP_HOST ?? '0.0.0.0';
    const originPolicy = resolveOriginPolicy(this.env);
    const allowedHosts = resolveAllowedHosts(this.env);
    const rateLimiter = createRateLimiter(this.env);

    const sessions = new Map<
      string,
      { transport: StreamableHTTPServerTransport; server: AppServer; credential: Buffer }
    >();

    const closeSession = async (sessionId: string): Promise<void> => {
      const session = sessions.get(sessionId);
      if (!session) return;
      sessions.delete(sessionId);
      await session.server.close().catch(() => {
        /* already closing */
      });
    };

    const startSession = async (
      req: IncomingMessage,
      res: ServerResponse,
      body: unknown,
    ): Promise<void> => {
      const token = extractBearerToken(req);
      if (!token) {
        writeJsonRpcError(
          res,
          401,
          ErrorCode.InvalidRequest,
          'Missing or malformed Authorization header. This server expects ' +
            '`Authorization: Bearer <token>` on every request — that token is this session\'s own ' +
            'identity towards the backend, not a shared server credential.',
        );
        return;
      }

      const server = this.createSessionServer(this.env, token);
      server.onerror = (error) => console.error('[MCP Error]', error);

      try {
        await server.bootstrap();
      } catch (error: any) {
        writeJsonRpcError(
          res,
          401,
          ErrorCode.InvalidRequest,
          `The backend refused this session's token: ${error?.message ?? error}`,
        );
        return;
      }

      const credential = credentialDigest(token);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          sessions.set(id, { transport, server, credential });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) void closeSession(transport.sessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    };

    const httpServer = createHttpServer(async (req, res) => {
      // Origin first, before the path check and before anything reads a body:
      // a rebinding attempt is not entitled to know what this server serves.
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin) {
        if (!originAllowed(origin, originPolicy)) {
          writeJsonRpcError(
            res,
            403,
            ErrorCode.InvalidRequest,
            `Origin '${origin}' is not allowed. This endpoint answers browser origins only when ` +
              'MCP_HTTP_ALLOWED_ORIGINS names them; MCP clients that are not web pages send no ' +
              'Origin header and are unaffected.',
          );
          return;
        }
        // Echoed rather than `*`: the allow-list is the decision, and a browser
        // will not accept `*` alongside credentialed requests anyway.
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Expose-Headers', CORS_EXPOSED_HEADERS);
      }

      if (!hostAllowed(req, allowedHosts)) {
        writeJsonRpcError(
          res,
          403,
          ErrorCode.InvalidRequest,
          `Host '${req.headers.host ?? ''}' is not allowed. MCP_HTTP_ALLOWED_HOSTS names the ` +
            'names this server answers to.',
        );
        return;
      }

      if (!req.url || new URL(req.url, 'http://localhost').pathname !== '/mcp') {
        writeJsonRpcError(res, 404, ErrorCode.InvalidRequest, 'Not found. This server only serves /mcp.');
        return;
      }

      // Answered before the rate limit: a preflight is the browser's overhead,
      // not the client's traffic, and spending budget on it would make the
      // ceiling mean something different for browser clients.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': CORS_REQUEST_HEADERS,
          'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
      }

      if (rateLimiter) {
        const verdict = rateLimiter.take(rateLimitKey(req));
        if (!verdict.ok) {
          res.setHeader('Retry-After', String(verdict.retryAfter));
          writeJsonRpcError(
            res,
            429,
            ErrorCode.InvalidRequest,
            `Rate limit exceeded for this session: MCP_HTTP_RATE_LIMIT allows ` +
              `${this.env.MCP_HTTP_RATE_LIMIT} requests per minute. Retry in ` +
              `${verdict.retryAfter}s. If this was one legitimate burst rather than a loop, raise ` +
              'the limit rather than retrying harder — the backend is the resource being protected.',
          );
          return;
        }
      }

      const sessionId = req.headers['mcp-session-id'];
      const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (existing) {
        // A session id is a routing key, not a credential: the MCP specification
        // says not to authenticate by it. So every request has to present the
        // token that opened the session, and someone else's token — or none — is
        // refused rather than served as that session's owner.
        const token = extractBearerToken(req);
        if (!token || !timingSafeEqual(credentialDigest(token), existing.credential)) {
          writeJsonRpcError(
            res,
            401,
            ErrorCode.InvalidRequest,
            'This session was opened with a different credential. Send the same ' +
              '`Authorization: Bearer <token>` on every request of a session.',
          );
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }
      if (typeof sessionId === 'string') {
        writeJsonRpcError(res, 404, ErrorCode.InvalidRequest, 'Session not found.');
        return;
      }

      if (req.method !== 'POST') {
        writeJsonRpcError(res, 400, ErrorCode.InvalidRequest, 'Bad Request: Mcp-Session-Id header required.');
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error: any) {
        writeJsonRpcError(res, 400, ErrorCode.ParseError, `Parse error: ${error?.message ?? error}`);
        return;
      }
      if (!isInitializeRequest(body)) {
        writeJsonRpcError(res, 400, ErrorCode.InvalidRequest, 'Bad Request: Mcp-Session-Id header required.');
        return;
      }

      await startSession(req, res, body);
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
    const boundPort = (httpServer.address() as { port: number }).port;
    console.error(`${SERVER_INFO.name} ${SERVER_INFO.version} listening on http://${host}:${boundPort}/mcp`);

    const onSignal = () => {
      void close().then(() => process.exit(0));
    };
    const close = async (): Promise<void> => {
      // Removed again, so a process that starts and stops several servers — a
      // test suite — does not pile up listeners on process.
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      for (const id of [...sessions.keys()]) await closeSession(id);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    return { port: boundPort, close };
  }
}
