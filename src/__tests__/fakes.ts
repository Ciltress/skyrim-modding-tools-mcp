import { InMemoryNotesBackend, NoteStore } from '../backend/notes';
import { SessionExpiredError } from '../backend/Backend';
import type { HealthReport } from '../backend/Backend';
import type { AppBackend } from '../backend/index';

/**
 * Test doubles shared by the suites. Not a test file itself — vitest only runs
 * `*.test.ts`.
 *
 * TEMPLATE: when you replace the notes backend, rewrite these two against your
 * own. Keep what they promise: `recordingBackend` records every domain call and
 * can fail all of them; `fakeBackend` counts connects and can fail on demand.
 */

/**
 * What every generated string argument becomes in the contract suite, and the id
 * of a note that exists — so a tool that looks something up by id has a success
 * path to be held to, not only a not-found.
 */
export const SAMPLE = 'sample';

const seedStore = () => new NoteStore([
    { id: SAMPLE, title: 'Sample', body: 'A sample note.', tags: [SAMPLE] },
    { id: 'note-2', title: 'Another', body: 'Second note, longer body. '.repeat(10), tags: ['other'] }
]);

/** Members of the backend that are its lifecycle rather than its domain. */
const LIFECYCLE = new Set([
    'describe', 'connected', 'connect', 'isSessionExpired', 'capabilities', 'health',
    // Must not look like a promise, or awaiting the backend would hang.
    'then', 'catch', 'finally'
]);

/**
 * A real in-memory backend behind a recording proxy: every domain call is
 * captured, and with `fail` every one of them throws a plain Error — the shape
 * an HTTP client's failure usually has.
 */
export function recordingBackend(options: { fail?: boolean; features?: readonly string[] } = {}) {
    const calls: { method: string; args: any[] }[] = [];
    const real = new InMemoryNotesBackend({ store: seedStore(), features: options.features });

    const backend = new Proxy(real, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || LIFECYCLE.has(property) || typeof value !== 'function') {
                return value;
            }
            return async (...args: any[]) => {
                calls.push({ method: property, args });
                if (options.fail) throw new Error(`simulated backend failure in ${property}`);
                return value.apply(target, args);
            };
        }
    }) as unknown as AppBackend;

    return { backend, calls };
}

export interface FakeBackendOptions {
    /** What capabilities() answers, or does. Defaults to every feature. */
    capabilities?: () => Promise<readonly string[] | undefined>;
    /** Fails the next N domain calls with this error, then succeeds. */
    failWith?: { error: unknown; times: number };
    /** connect() throws this, every time. */
    connectError?: unknown;
    /** The health probe. Absent by default, as on a backend that has none. */
    health?: () => Promise<HealthReport>;
}

const DOMAIN_METHODS = ['searchNotes', 'getNote', 'createNote', 'updateNote', 'deleteNote', 'listTags'] as const;

/**
 * A backend whose lifecycle a test controls: it counts connects and capability
 * reads, starts disconnected so the first tool call has to connect, and can be
 * made to fail its domain calls N times — which is how the retry is exercised.
 */
export function fakeBackend(options: FakeBackendOptions = {}) {
    let connects = 0;
    let capabilityReads = 0;
    let connected = false;
    let remaining = options.failWith?.times ?? 0;
    const calls: string[] = [];
    const real = new InMemoryNotesBackend({ store: seedStore() });

    const domain = Object.fromEntries(DOMAIN_METHODS.map(name => [name, async (...args: any[]) => {
        calls.push(name);
        if (remaining > 0) {
            remaining--;
            // A session the backend dropped really is not connected any more.
            if (options.failWith!.error instanceof SessionExpiredError) connected = false;
            throw options.failWith!.error;
        }
        return (real[name] as (...a: any[]) => any).apply(real, args);
    }]));

    const backend = {
        describe: () => 'the fake notes store',
        get connected() { return connected; },
        async connect() {
            connects++;
            if (options.connectError) throw options.connectError;
            connected = true;
        },
        isSessionExpired: (error: unknown) => error instanceof SessionExpiredError,
        async capabilities() {
            capabilityReads++;
            return options.capabilities ? options.capabilities() : ['tags'];
        },
        ...(options.health ? { health: options.health } : {}),
        ...domain
    } as unknown as AppBackend;

    return {
        backend,
        calls,
        connects: () => connects,
        capabilityReads: () => capabilityReads
    };
}
