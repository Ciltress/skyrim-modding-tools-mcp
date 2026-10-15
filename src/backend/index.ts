import { parseList } from '../lib/env.js';
import { EXAMPLE_NOTES, InMemoryNotesBackend, NoteStore } from './notes.js';
import type { NotesBackend } from './notes.js';

export type { Backend, HealthReport } from './Backend.js';
export { PermanentBackendError, SessionExpiredError, isPermanent } from './Backend.js';

/**
 * TEMPLATE: the backend every handler is written against. Point this at your
 * own interface — the one that extends `Backend` with your domain operations —
 * and the handlers, the server and the tests follow.
 */
export type AppBackend = NotesBackend;

/**
 * TEMPLATE: the environment variables this server refuses to start without.
 *
 * server.json marks exactly these `isRequired`, and serverManifest.test.ts holds
 * the two together, so a client is never told to collect something the server
 * does not need — nor left to discover at startup that it skipped something it
 * does.
 */
export const REQUIRED_ENV: readonly string[] = [];

export interface BackendOptions {
    /**
     * The caller's own bearer token, in HTTP mode — that session's identity
     * towards the backend. Undefined in stdio mode, where the process belongs to
     * whoever started it and the credential, if any, comes from the environment.
     */
    bearerToken?: string;
}

/** One store per process, so every HTTP session sees the same notes. */
let sharedStore: NoteStore | undefined;

/**
 * TEMPLATE: builds the backend for one server instance. Must not touch the
 * network — see the rules in ./Backend.ts.
 */
export function createBackend(env: NodeJS.ProcessEnv = process.env, options: BackendOptions = {}): AppBackend {
    sharedStore ??= new NoteStore(EXAMPLE_NOTES);

    return new InMemoryNotesBackend({
        store: sharedStore,
        credential: options.bearerToken,
        // Only HTTP sessions present a credential, so only they are checked.
        acceptedCredentials: options.bearerToken !== undefined
            ? parseList(env.EXAMPLE_ACCEPTED_TOKENS)
            : undefined
    });
}
