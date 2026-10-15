import { NotesHandlers } from '../handlers/NotesHandlers';
import { InMemoryNotesBackend, NoteStore } from '../backend/notes';
import { PermanentBackendError, isPermanent } from '../backend/Backend';
import { createBackend } from '../backend/index';

/**
 * TEMPLATE: the behavioural suite for the example tool family — what each tool
 * actually does, which the contract suite deliberately does not check. Replace
 * it with one per tool family of your own; delete it with NotesHandlers.
 */

/** A clock that moves one second per reading, so any change shows in updatedAt. */
function tickingClock() {
    let tick = 0;
    return () => new Date(Date.UTC(2026, 0, 1) + (tick++) * 1000);
}

function setup(count = 3) {
    const store = new NoteStore(
        Array.from({ length: count }, (_, i) => ({
            id: `n${i + 1}`,
            title: `Note ${i + 1}`,
            body: i === 0 ? 'Remember the MILK. ' + 'x'.repeat(200) : `body ${i + 1}`,
            tags: i % 2 === 0 ? ['Home', 'home'] : ['work']
        })),
        tickingClock()
    );
    const handler = new NotesHandlers(new InMemoryNotesBackend({ store }));
    const run = async (tool: string, args: any = {}) =>
        JSON.parse((await handler.handle(tool, args)).content[0].text);
    return { store, run };
}

describe('searchNotes', () => {
    it('finds by text in title or body, case-insensitively', async () => {
        const { run } = setup();
        const payload = await run('searchNotes', { text: 'milk' });
        expect(payload.notes.map((n: any) => n.id)).toEqual(['n1']);
    });

    it('filters by tag, and stores tags lower-case without duplicates', async () => {
        const { run } = setup();
        const payload = await run('searchNotes', { tag: 'HOME' });
        expect(payload.notes.map((n: any) => n.id).sort()).toEqual(['n1', 'n3']);
        expect(payload.notes[0].tags).toEqual(['home']);
    });

    it('returns previews, not bodies', async () => {
        const { run } = setup();
        const note = (await run('searchNotes', { text: 'milk' })).notes[0];
        expect(note.preview.length).toBeLessThanOrEqual(121);
        expect(note).not.toHaveProperty('body');
    });

    it('says there is more, and where to continue, when the limit cut it', async () => {
        const { run } = setup(5);
        const first = await run('searchNotes', { limit: 2 });
        expect(first).toEqual(expect.objectContaining({ total: 5, returned: 2, more: true, nextOffset: 2 }));

        const last = await run('searchNotes', { limit: 2, offset: 4 });
        expect(last.returned).toBe(1);
        expect(last).not.toHaveProperty('more');
    });

    it('refuses a limit outside 1-100 rather than guessing', async () => {
        const { run } = setup();
        for (const limit of [0, 101, 1.5, 'lots']) {
            await expect(run('searchNotes', { limit })).rejects.toThrow(/'limit' must be/);
        }
    });
});

describe('readNote', () => {
    it('returns the whole note', async () => {
        const { run } = setup();
        const { note } = await run('readNote', { id: 'n1' });
        expect(note.body).toMatch(/^Remember the MILK/);
    });

    it('names the next step when the id does not exist', async () => {
        const { run } = setup();
        await expect(run('readNote', { id: 'nope' })).rejects.toThrow(/no note 'nope'.*searchNotes/);
        await expect(run('readNote', {})).rejects.toThrow(/'id' is required/);
    });
});

describe('createNote', () => {
    it('creates a note with a new id', async () => {
        const { run, store } = setup(0);
        const { note } = await run('createNote', { title: '  Plan  ', tags: ['A', 'a', 'b'] });
        expect(note).toEqual(expect.objectContaining({ title: 'Plan', body: '', tags: ['a', 'b'] }));
        expect(store.get(note.id)).toBeDefined();
    });

    it('is not idempotent, exactly as its annotation says', async () => {
        const { run, store } = setup(0);
        await run('createNote', { title: 'Same' });
        await run('createNote', { title: 'Same' });
        expect(store.size).toBe(2);
    });

    it('validates what it is given', async () => {
        const { run } = setup();
        await expect(run('createNote', {})).rejects.toThrow(/'title' is required/);
        await expect(run('createNote', { title: 'x', tags: 'home' })).rejects.toThrow(/array of strings/);
    });
});

describe('updateNote', () => {
    it('replaces the fields it is given and keeps the rest', async () => {
        const { run } = setup();
        const { note, changed } = await run('updateNote', { id: 'n2', body: 'new body' });
        expect(changed).toBe(true);
        expect(note).toEqual(expect.objectContaining({ title: 'Note 2', body: 'new body', tags: ['work'] }));
    });

    it('is idempotent, exactly as its annotation says: the second call changes nothing', async () => {
        const { run, store } = setup();
        await run('updateNote', { id: 'n2', title: 'Renamed' });
        const after = store.get('n2');

        const again = await run('updateNote', { id: 'n2', title: 'Renamed' });
        expect(again.changed).toBe(false);
        // Not even updatedAt moves, so the state really is the same.
        expect(store.get('n2')).toEqual(after);
    });

    it('clears the tags when given an empty list', async () => {
        const { run } = setup();
        expect((await run('updateNote', { id: 'n1', tags: [] })).note.tags).toEqual([]);
    });

    it('refuses an update that changes nothing, an empty title, or an unknown note', async () => {
        const { run } = setup();
        await expect(run('updateNote', { id: 'n1' })).rejects.toThrow(/Nothing to change/);
        await expect(run('updateNote', { id: 'n1', title: '  ' })).rejects.toThrow(/cannot be empty/);
        await expect(run('updateNote', { id: 'nope', body: 'x' })).rejects.toThrow(/no note 'nope'/);
    });
});

describe('deleteNote', () => {
    it('deletes, and answers rather than fails when repeated', async () => {
        const { run, store } = setup();
        expect(await run('deleteNote', { id: 'n1' })).toEqual(expect.objectContaining({ deleted: true }));
        expect(store.get('n1')).toBeUndefined();

        const again = await run('deleteNote', { id: 'n1' });
        expect(again).toEqual(expect.objectContaining({ status: 'success', deleted: false }));
    });
});

describe('listTags', () => {
    it('counts each tag, most used first', async () => {
        const { run } = setup(3);
        expect((await run('listTags')).tags).toEqual([{ tag: 'home', count: 2 }, { tag: 'work', count: 1 }]);
    });
});

describe('the example backend\'s credential check', () => {
    it('checks nothing in stdio mode, where the process belongs to whoever started it', async () => {
        const backend = new InMemoryNotesBackend();
        await backend.connect();
        expect(backend.connected).toBe(true);
    });

    it('refuses, permanently, a token it was not configured to accept', async () => {
        const backend = new InMemoryNotesBackend({ credential: 'guess', acceptedCredentials: ['secret'] });
        const error = await backend.connect().catch(e => e);
        expect(error).toBeInstanceOf(PermanentBackendError);
        expect(isPermanent(error)).toBe(true);
        expect(backend.connected).toBe(false);
    });

    it('accepts a configured token', async () => {
        const backend = new InMemoryNotesBackend({ credential: 'secret', acceptedCredentials: ['other', 'secret'] });
        await backend.connect();
        expect(backend.connected).toBe(true);
    });
});

describe('createBackend', () => {
    it('shares one store across sessions, so HTTP callers see each other\'s notes', async () => {
        const env = { EXAMPLE_ACCEPTED_TOKENS: 'a,b' };
        const first = createBackend(env, { bearerToken: 'a' });
        const second = createBackend(env, { bearerToken: 'b' });

        const created = await first.createNote({ title: 'shared' });
        expect(await second.getNote(created.id)).toEqual(created);
        await first.deleteNote(created.id);
    });

    it('checks the token only for HTTP sessions', async () => {
        await expect(createBackend({}).connect()).resolves.toBeUndefined();
        await expect(createBackend({}, { bearerToken: 'x' }).connect()).rejects.toThrow(/EXAMPLE_ACCEPTED_TOKENS/);
    });
});
