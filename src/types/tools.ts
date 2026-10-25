/**
 * A single entry of an `inputSchema`. Deliberately a subset of JSON Schema —
 * enough to describe every argument a tool takes, including the structured
 * ones (objects handed back from a previous call, arrays of rows, closed value
 * sets).
 */
export interface ToolProperty {
  /** Left out for a value of any kind — editRecord's new value of a field, a number, words, a list or an object. */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  /** Element schema, for properties of type 'array'. */
  items?: ToolProperty;
  /** Component schemas, for properties of type 'object'. */
  properties?: Record<string, ToolProperty>;
  /** Mandatory components, for properties of type 'object'. */
  required?: string[];
  /** Allowed values, when the property is a closed set. */
  enum?: readonly (string | number)[];
  /** Value used by the handler when the caller omits the property. */
  default?: string | number | boolean;
}

/**
 * The MCP tool annotations: hints a client uses to decide how much ceremony a
 * call deserves — auto-approve it, ask first, or warn loudly.
 *
 * They are **hints, not guarantees**. Nothing here is enforced by the server;
 * a client that trusts them blindly on an untrusted server is the case the
 * specification warns about. What they buy on a trusted server is fewer
 * prompts for the tools that only read, and a loud one for the rest.
 *
 * Conventions, so the flags mean the same thing on every tool:
 *
 * - `readOnlyHint` — true only when the call leaves the backend exactly as it
 *   found it. A check that sends data but persists nothing is read-only;
 *   anything that executes caller-supplied code is not, because the code
 *   decides, not us.
 * - `destructiveHint` — true when the call overwrites or removes something that
 *   existed. Creating something new is not destructive.
 * - `idempotentHint` — true only when repeating the call really does leave the
 *   same state. A write that appends to a history every time does not qualify,
 *   even with identical arguments.
 * - `openWorldHint` — false for the ordinary case, where the server is bound to
 *   one backend and its data is a closed domain. True where the call reaches
 *   past that: publishing, sending, pushing to an external remote.
 *
 * Every tool states all four, read-only ones included — there they are always
 * `destructiveHint: false, idempotentHint: true`. The specification only gives
 * those two a meaning when a tool writes, but OpenAI's directory rejects a tool
 * that leaves either out, and a client that falls back to the defaults would
 * read a missing `destructiveHint` as `true`.
 */
export interface ToolAnnotations {
  /** Human-readable name for the tool, for UIs that show one instead of `name`. */
  title?: string;
  /** True when the tool does not modify its environment. Default: false. */
  readOnlyHint?: boolean;
  /** True when the tool may destroy or overwrite existing state. Meaningful only when `readOnlyHint` is false. Default: true. */
  destructiveHint?: boolean;
  /** True when repeating the call with the same arguments has no further effect. Meaningful only when `readOnlyHint` is false. Default: false. */
  idempotentHint?: boolean;
  /** True when the tool interacts with entities outside the backend this server is bound to. Default: true. */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    /**
     * The only optionality marker clients act on: anything not listed here is
     * optional. There is no `optional: true` flag — it was never JSON Schema.
     */
    required?: string[];
  };
  /**
   * What "narrow it" means for this tool, used when an answer is withheld for
   * exceeding the response budget.
   *
   * It lives here rather than in a map keyed by tool name because such a map
   * goes stale silently: renaming a tool simply stops matching, and the model
   * gets generic advice at the exact moment it needed the specific move. Omit it
   * and the caller gets the generic hint, which is the honest default for a tool
   * that has no particular way to be narrowed.
   */
  narrowingHint?: string;
  /**
   * Id of the GatedFeature this tool cannot work without, e.g. 'tags'. Absent
   * means the tool works against any backend this server supports.
   *
   * Declared on the tool for the same reason as the hint: a list of tool names
   * kept on the feature un-gates a tool without a word when it is renamed.
   */
  needsFeature?: string;
  /**
   * Behavioural hints for the client: read-only, destructive, idempotent, open-world.
   *
   * Passed straight through to `tools/list`, and declared per tool for the same
   * reason as the two fields above — a table keyed by tool name goes stale the
   * moment a tool is renamed, and here that would silently downgrade a
   * destructive tool to the client's defaults.
   */
  annotations?: ToolAnnotations;
}
