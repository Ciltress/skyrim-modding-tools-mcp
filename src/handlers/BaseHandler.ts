import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { performance } from 'perf_hooks';
import type { AppBackend } from '../backend/index.js';
import type { ToolDefinition } from "../types/tools.js";
import { createLogger } from '../lib/logger.js';
import { coerceArgs } from './args.js';

/**
 * One tool: what a caller must know to use it, and what it does.
 *
 * `run` returns the payload and nothing else. The timer, the MCP envelope, the
 * error mapping and the dispatch are BaseHandler's business, not the tool's —
 * most tools are a single call to the backend, and writing that ceremony out per
 * tool produces thousands of lines that hold no behaviour, several private
 * wrappers, and more than one spelling of the envelope.
 */
export interface ToolSpec {
  definition: ToolDefinition;
  /** Does the work and returns the payload. Throwing is the way to fail. */
  run(args: any): Promise<any> | any;
  /**
   * Prefix for the message when `run` throws something that is not already an
   * McpError, e.g. 'Failed to update the note'. Kept per tool because it is the
   * part of a failure that tells a reader which call went wrong.
   */
  onFailure?: string;
}

export abstract class BaseHandler {
  protected readonly backend: AppBackend;
  protected readonly logger = createLogger(this.constructor.name);
  private readonly metrics = {
    requestCount: 0,
    errorCount: 0,
    successCount: 0,
    totalTime: 0,
    /** Bytes returned to the client, summed. The cheap answer to "what is expensive?". */
    responseBytes: 0,
    /** The single largest answer this handler has given. Where a row limit is missing. */
    maxResponseBytes: 0,
    /** Answers withheld for exceeding the response budget. */
    truncatedCount: 0
  };

  constructor(backend: AppBackend) {
    this.backend = backend;
  }

  protected trackRequest(startTime: number, success: boolean): void {
    const duration = performance.now() - startTime;
    this.metrics.requestCount++;
    this.metrics.totalTime += duration;

    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
    }

    this.logger.info('Request completed', {
      duration,
      success,
      metrics: this.getMetrics()
    });
  }

  /**
   * Records what one answer cost the client. Measurement only — the decision to
   * withhold an oversized answer is made once, centrally, in serializeResult.
   */
  public trackResponseBytes(bytes: number, truncated: boolean): void {
    this.metrics.responseBytes += bytes;
    if (bytes > this.metrics.maxResponseBytes) this.metrics.maxResponseBytes = bytes;
    if (truncated) this.metrics.truncatedCount++;
  }

  /** Per-handler counters, aggregated by the healthcheck tool. */
  public getMetrics() {
    return {
      ...this.metrics,
      averageTime: this.metrics.requestCount > 0
        ? this.metrics.totalTime / this.metrics.requestCount
        : 0,
      averageResponseBytes: this.metrics.requestCount > 0
        ? Math.round(this.metrics.responseBytes / this.metrics.requestCount)
        : 0
    };
  }

  /** The tools this handler offers, declared once. */
  protected abstract toolSpecs(): ToolSpec[];

  /** Built once. `toolSpecs()` closes over the handler, so it must not run before construction finishes. */
  private specIndex?: Map<string, ToolSpec>;

  private specs(): Map<string, ToolSpec> {
    if (!this.specIndex) {
      this.specIndex = new Map(this.toolSpecs().map(spec => [spec.definition.name, spec]));
    }
    return this.specIndex;
  }

  /** The tools this handler exposes. Used to build both the tool list and the router. */
  getTools(): ToolDefinition[] {
    return this.toolSpecs().map(spec => spec.definition);
  }

  /** Executes one of this handler's tools. Every name in getTools() is routable here. */
  async handle(toolName: string, args: any): Promise<any> {
    const spec = this.specs().get(toolName);
    if (!spec) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `${this.constructor.name} has no tool named '${toolName}'.`
      );
    }

    const startTime = performance.now();
    try {
      // Never undefined: a tool reading `args.name` on a call with no arguments
      // would otherwise throw a TypeError, which reads to a client as a bug in
      // the server rather than as a missing argument.
      const payload = await spec.run(coerceArgs(spec.definition.inputSchema, args ?? {}));
      this.trackRequest(startTime, true);
      return this.envelope(payload);
    } catch (error) {
      this.trackRequest(startTime, false);
      throw this.asMcpError(error, spec.onFailure);
    }
  }

  /**
   * Wraps a payload in the one MCP envelope this server speaks.
   *
   * `status: 'success'` is added for a plain object that does not already carry a
   * `status`, which is what nearly every tool wants. A tool that returns its own
   * `status` keeps it, and a bare array is serialised as it stands rather than
   * being spread into an object with numeric keys.
   *
   * Compact, never pretty-printed. Indentation costs response budget and buys a
   * model nothing.
   */
  protected envelope(payload: any) {
    const isPlainObject =
      !!payload && typeof payload === 'object' && !Array.isArray(payload);

    const body = isPlainObject && !('status' in payload)
      ? { status: 'success', ...payload }
      : payload;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(body, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        )
      }]
    };
  }

  /**
   * The single place a failure becomes something a client can read.
   *
   * An McpError is passed through untouched: the tools that raise one have
   * already chosen the code and written the message, and both carry information
   * a generic wrapper would destroy. Anything else keeps the backend's own detail
   * when an HTTP client attached one, because `error.message` is frequently just
   * "Request failed with status code 400".
   */
  protected asMcpError(error: unknown, onFailure?: string): McpError {
    if (error instanceof McpError) return error;

    const raw = error as any;
    const detail =
      raw?.response?.data?.message ||
      raw?.message ||
      'Unknown error';

    const wrapped = new McpError(
      ErrorCode.InternalError,
      onFailure ? `${onFailure}: ${detail}` : String(detail)
    );
    // Kept, because the server still has to recognise what this was: a session
    // the backend dropped is retried, and the retry asks the backend about the
    // original error, not about this wrapper.
    (wrapped as Error).cause = error;
    return wrapped;
  }
}
