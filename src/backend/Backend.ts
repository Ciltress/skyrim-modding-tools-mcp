/**
 * The seam between this server and whatever it wraps.
 *
 * Everything the server needs to know about a backend's *lifecycle* is here:
 * how to describe it, how to connect, which failures mean "the session went
 * stale, try again" and which mean "stop, retrying makes it worse", what it
 * supports, and whether it is alive. The *domain* operations — what the tools
 * actually call — live on the concrete backend that extends this interface
 * (see ./skyrim/SkyrimBackend.ts).
 *
 * Two rules every implementation must keep:
 *
 * 1. **Constructing a backend never touches the network.** In HTTP mode the
 *    process builds one it never connects, purely to host sessions, and tests
 *    build them by the hundred. Connect in `connect()`, lazily.
 * 2. **A refused credential is permanent.** Throw a `PermanentBackendError`
 *    (or anything with `permanent: true`) from `connect()` when the backend
 *    rejected the credential itself. The server latches it and never connects
 *    again — because for a password or a client secret, every retry is one more
 *    failed logon, and enough of those lock the account for everyone who uses
 *    it.
 */
export interface Backend {
  /**
   * What this instance is bound to, in a few words — e.g. "the notes store at
   * https://notes.example.com". Announced in the MCP `instructions` and in
   * healthcheck, so a client running several of these servers can tell them
   * apart. Must not contact the backend.
   */
  describe(): string;

  /** True once `connect()` has succeeded, until a session is found stale. */
  readonly connected: boolean;

  /**
   * Establishes (or re-establishes) the session. Safe to call repeatedly: the
   * server calls it before the first tool call, and again after a tool call
   * failed with an error `isSessionExpired()` recognises.
   */
  connect(): Promise<void>;

  /**
   * True for errors that mean the backend refused the request *before running
   * it* because the session is stale — an expired token, a dropped session, a
   * rejected CSRF token. The server reconnects and retries exactly once for
   * these, which is only safe because nothing was applied the first time.
   * Anything that might have been applied must answer false.
   */
  isSessionExpired(error: unknown): boolean;

  /**
   * The feature ids this backend supports, for the capability gate in
   * ../lib/capabilityGate.ts. Answer `undefined` when the backend cannot say:
   * the gate then withholds nothing, because hiding a tool that would have
   * worked is invisible, and offering one that errors is not.
   */
  capabilities(): Promise<readonly string[] | undefined>;

  /**
   * A cheap liveness probe for healthcheck and for the startup failure message.
   * Optional. It should report what it found rather than throw — but the server
   * guards it anyway, because healthcheck is called precisely when everything
   * else has stopped working.
   */
  health?(): Promise<HealthReport>;
}

export interface HealthReport {
  ok: boolean;
  /** One sentence a human can act on: what answered, and what did not. */
  summary: string;
  /** Anything else worth reporting, e.g. which layer refused. */
  [detail: string]: unknown;
}

/**
 * A credential the backend refused. Never retried: see rule 2 above.
 */
export class PermanentBackendError extends Error {
  readonly permanent = true;
}

/** True for a PermanentBackendError, or anything else that marks itself permanent. */
export function isPermanent(error: unknown): boolean {
  return (error as { permanent?: unknown } | null)?.permanent === true;
}

/**
 * A session the backend no longer recognises. Throw it from a domain call when
 * the request was refused before it ran, and the server reconnects and retries
 * once.
 */
export class SessionExpiredError extends Error { }
