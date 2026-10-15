import { createHash, timingSafeEqual } from 'node:crypto';
import { PermanentBackendError, SessionExpiredError } from './Backend.js';
import type { Backend, HealthReport } from './Backend.js';

/**
 * TEMPLATE: the example domain — a small notes store, kept in memory.
 *
 * It exists to exercise every pattern the template has with something real
 * behind it: tools that only read, a write that creates, a write that
 * overwrites and can be repeated safely, a delete, a tool that needs an
 * optional feature, and a search large enough to need a row limit. Replace this
 * file with a client for whatever your server wraps, and keep the shape:
 * lifecycle from `Backend`, domain operations on the interface that extends it.
 */

export interface Note {
    id: string;
    title: string;
    body: string;
    tags: string[];
    updatedAt: string;
}

export interface NoteSummary {
    id: string;
    title: string;
    tags: string[];
    updatedAt: string;
    /** The first characters of the body — enough to choose, not enough to cost much. */
    preview: string;
}

export interface NoteSearch {
    /** Case-insensitive substring of the title or body. */
    text?: string;
    /** Exact tag, case-insensitive. */
    tag?: string;
    limit: number;
    offset?: number;
}

export interface NoteSearchResult {
    notes: NoteSummary[];
    /** Matches before the limit was applied, so a caller can tell a short answer from a cut one. */
    total: number;
}

export interface NewNote {
    title: string;
    body?: string;
    tags?: string[];
}

export interface NotePatch {
    title?: string;
    body?: string;
    tags?: string[];
}

/** The domain operations the tools call. */
export interface NotesBackend extends Backend {
    searchNotes(search: NoteSearch): Promise<NoteSearchResult>;
    getNote(id: string): Promise<Note | undefined>;
    createNote(note: NewNote): Promise<Note>;
    /** Undefined when there is no such note. */
    updateNote(id: string, patch: NotePatch): Promise<Note | undefined>;
    /** False when there was nothing to delete. */
    deleteNote(id: string): Promise<boolean>;
    listTags(): Promise<{ tag: string; count: number }[]>;
}

/** Every feature this backend implements, as the capability gate knows them. */
export const NOTES_FEATURES = ['tags'] as const;

const PREVIEW_CHARS = 120;

const normaliseTags = (tags: readonly string[] | undefined) =>
    [...new Set((tags ?? []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean))].sort();

/**
 * The data, separate from the backend that serves it, so several backends —
 * one per HTTP session — can share one store.
 */
export class NoteStore {
    private readonly notes = new Map<string, Note>();
    private nextId = 1;

    constructor(seed: readonly (NewNote & { id?: string })[] = [], private readonly clock = () => new Date()) {
        for (const note of seed) this.insert(note, note.id);
    }

    get size(): number {
        return this.notes.size;
    }

    all(): Note[] {
        return [...this.notes.values()];
    }

    get(id: string): Note | undefined {
        const note = this.notes.get(id);
        return note && { ...note, tags: [...note.tags] };
    }

    insert(note: NewNote, id?: string): Note {
        const assigned = id ?? `note-${this.nextId++}`;
        const stored: Note = {
            id: assigned,
            title: note.title.trim(),
            body: note.body ?? '',
            tags: normaliseTags(note.tags),
            updatedAt: this.clock().toISOString()
        };
        this.notes.set(assigned, stored);
        return { ...stored, tags: [...stored.tags] };
    }

    /**
     * Applies the fields that are set. `updatedAt` moves only when something
     * actually changed, which is what makes a repeated update a true no-op —
     * and the tool's `idempotentHint` honest.
     */
    update(id: string, patch: NotePatch): Note | undefined {
        const note = this.notes.get(id);
        if (!note) return undefined;

        const next: Note = {
            ...note,
            title: patch.title !== undefined ? patch.title.trim() : note.title,
            body: patch.body ?? note.body,
            tags: patch.tags !== undefined ? normaliseTags(patch.tags) : note.tags
        };
        const changed = next.title !== note.title || next.body !== note.body ||
            next.tags.join('\n') !== note.tags.join('\n');
        if (changed) {
            next.updatedAt = this.clock().toISOString();
            this.notes.set(id, next);
        }
        return { ...(changed ? next : note), tags: [...(changed ? next : note).tags] };
    }

    delete(id: string): boolean {
        return this.notes.delete(id);
    }
}

/** What the example server starts with, so it has something to show. */
export const EXAMPLE_NOTES: readonly NewNote[] = [
    {
        title: 'Welcome',
        body: 'This server is generated from mcp-template. The notes tools are the example tool family — ' +
            'replace them with tools for whatever your server wraps.',
        tags: ['template']
    },
    {
        title: 'How a tool is added',
        body: 'Add a ToolSpec to a handler\'s toolSpecs(): a definition with annotations, and a run() that ' +
            'returns plain data. BaseHandler does the envelope, the timing and the error mapping.',
        tags: ['template', 'howto']
    },
    {
        title: 'Release checklist',
        body: 'npx tsc --noEmit, npm test, npm run build, npm run docs:tools, npm run smoke.',
        tags: ['howto']
    }
];

export interface InMemoryNotesOptions {
    store?: NoteStore;
    /** Features this instance reports to the capability gate. Defaults to all of NOTES_FEATURES. */
    features?: readonly string[];
    /** The caller's credential, in HTTP mode. */
    credential?: string;
    /**
     * Credentials accepted from HTTP callers. Undefined means nothing is checked,
     * which is stdio mode: the process belongs to the one user who started it.
     */
    acceptedCredentials?: readonly string[];
}

/** Compares two secrets without leaking how much of them matched through timing. */
function sameSecret(a: string, b: string): boolean {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(a), digest(b));
}

export class InMemoryNotesBackend implements NotesBackend {
    private readonly store: NoteStore;
    private isConnected = false;

    constructor(private readonly options: InMemoryNotesOptions = {}) {
        this.store = options.store ?? new NoteStore();
    }

    describe(): string {
        return 'the in-memory example notes store';
    }

    get connected(): boolean {
        return this.isConnected;
    }

    async connect(): Promise<void> {
        const accepted = this.options.acceptedCredentials;
        if (accepted !== undefined) {
            if (!accepted.length) {
                throw new PermanentBackendError(
                    'This server accepts no HTTP callers yet: set EXAMPLE_ACCEPTED_TOKENS to the bearer ' +
                    'tokens it should accept.'
                );
            }
            const credential = this.options.credential ?? '';
            if (!accepted.some(token => sameSecret(token, credential))) {
                throw new PermanentBackendError('The notes store refused this bearer token.');
            }
        }
        this.isConnected = true;
    }

    isSessionExpired(error: unknown): boolean {
        return error instanceof SessionExpiredError;
    }

    async capabilities(): Promise<readonly string[]> {
        return this.options.features ?? NOTES_FEATURES;
    }

    async health(): Promise<HealthReport> {
        return { ok: true, summary: `in-memory store holding ${this.store.size} note(s)` };
    }

    async searchNotes(search: NoteSearch): Promise<NoteSearchResult> {
        const text = search.text?.trim().toLowerCase();
        const tag = search.tag?.trim().toLowerCase();

        const matches = this.store.all()
            .filter(note => !text || note.title.toLowerCase().includes(text) || note.body.toLowerCase().includes(text))
            .filter(note => !tag || note.tags.includes(tag))
            .sort((a, b) => (a.updatedAt === b.updatedAt
                ? (a.id < b.id ? -1 : 1)
                : (a.updatedAt < b.updatedAt ? 1 : -1)));

        const offset = Math.max(0, search.offset ?? 0);
        return {
            total: matches.length,
            notes: matches.slice(offset, offset + search.limit).map(note => ({
                id: note.id,
                title: note.title,
                tags: [...note.tags],
                updatedAt: note.updatedAt,
                preview: note.body.length > PREVIEW_CHARS ? `${note.body.slice(0, PREVIEW_CHARS)}…` : note.body
            }))
        };
    }

    async getNote(id: string): Promise<Note | undefined> {
        return this.store.get(id);
    }

    async createNote(note: NewNote): Promise<Note> {
        return this.store.insert(note);
    }

    async updateNote(id: string, patch: NotePatch): Promise<Note | undefined> {
        return this.store.update(id, patch);
    }

    async deleteNote(id: string): Promise<boolean> {
        return this.store.delete(id);
    }

    async listTags(): Promise<{ tag: string; count: number }[]> {
        const counts = new Map<string, number>();
        for (const note of this.store.all()) {
            for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
    }
}
