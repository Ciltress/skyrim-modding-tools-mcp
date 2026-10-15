import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';

/**
 * TEMPLATE: the example tool family — replace it with your own.
 *
 * Six tools, chosen so that every pattern has one working instance:
 *
 * | tool          | shows                                                          |
 * | ------------- | -------------------------------------------------------------- |
 * | `searchNotes` | a read with a row limit, `total`, and a `narrowingHint`        |
 * | `readNote`    | a read by id, with a not-found that names the next step        |
 * | `createNote`  | a write that is neither destructive nor idempotent             |
 * | `updateNote`  | a write that is destructive *and* idempotent                   |
 * | `deleteNote`  | a delete that answers instead of failing when already done     |
 * | `listTags`    | a tool gated on a backend feature (`needsFeature`)             |
 *
 * Each is one ToolSpec: a definition and a `run` that returns plain data.
 * Validation throws `McpError(InvalidParams)` with a message that says what to
 * do; everything else — envelope, timing, error mapping — is BaseHandler's.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** A required string argument, or an InvalidParams that names it. */
function requireString(args: any, name: string, hint = ''): string {
    const value = args?.[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new McpError(ErrorCode.InvalidParams, `'${name}' is required.${hint ? ` ${hint}` : ''}`);
    }
    return value.trim();
}

function optionalString(args: any, name: string): string | undefined {
    const value = args?.[name];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, `'${name}' must be a string.`);
    }
    return value;
}

function optionalTags(args: any): string[] | undefined {
    const value = args?.tags;
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string')) {
        throw new McpError(ErrorCode.InvalidParams, `'tags' must be an array of strings, e.g. ["howto"].`);
    }
    return value;
}

const NOT_FOUND_HINT = 'Find note ids with searchNotes.';

export class NotesHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
            {
                definition: {
                    name: 'searchNotes',
                    annotations: {
                        title: 'Search notes',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Find notes by text and/or tag, newest first. Returns summaries with a short preview — ' +
                        'not the full body; read one with readNote. `total` is the number of matches before ' +
                        'the limit, so a smaller `notes` list means there is more to page through.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            text: {
                                type: 'string',
                                description: 'Case-insensitive text to look for in the title or body. Omit to match every note.'
                            },
                            tag: {
                                type: 'string',
                                description: 'Only notes carrying this tag, matched exactly and case-insensitively.'
                            },
                            limit: {
                                type: 'number',
                                description: `How many summaries to return, 1-${MAX_LIMIT}.`,
                                default: DEFAULT_LIMIT
                            },
                            offset: {
                                type: 'number',
                                description: 'How many matches to skip, for paging. Defaults to 0.'
                            }
                        }
                    },
                    narrowingHint:
                        'Add `text` or `tag` to match fewer notes, or lower `limit` and page with `offset`.'
                },
                onFailure: 'Failed to search notes',
                run: args => this.searchNotes(args)
            },
            {
                definition: {
                    name: 'readNote',
                    annotations: {
                        title: 'Read note',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description: 'One note in full — title, body, tags and when it last changed — by its id.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: `The note's id, e.g. 'note-1'. ${NOT_FOUND_HINT}` }
                        },
                        required: ['id']
                    }
                },
                onFailure: 'Failed to read the note',
                run: args => this.readNote(args)
            },
            {
                definition: {
                    name: 'createNote',
                    annotations: {
                        title: 'Create note',
                        readOnlyHint: false,
                        // Creating something new overwrites nothing.
                        destructiveHint: false,
                        // Every call makes another note, even with identical arguments.
                        idempotentHint: false,
                        openWorldHint: false
                    },
                    description:
                        'Create a note and return it with its new id. Calling it twice creates two notes — ' +
                        'search first if the note might already exist.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'A short title.' },
                            body: { type: 'string', description: 'The text of the note. Defaults to empty.' },
                            tags: {
                                type: 'array',
                                items: { type: 'string', description: 'One tag.' },
                                description: 'Tags, e.g. ["howto"]. Stored lower-case, without duplicates.'
                            }
                        },
                        required: ['title']
                    }
                },
                onFailure: 'Failed to create the note',
                run: args => this.createNote(args)
            },
            {
                definition: {
                    name: 'updateNote',
                    annotations: {
                        title: 'Update note',
                        readOnlyHint: false,
                        // It replaces what was there.
                        destructiveHint: true,
                        // Setting a field to a value twice leaves the same note:
                        // nothing changes the second time, not even updatedAt.
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Replace the title, body and/or tags of an existing note. Fields you omit are kept; ' +
                        '`tags` replaces the whole list. Returns the note as it now is, and `changed:false` ' +
                        'when the note already had these values.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: `The note to change. ${NOT_FOUND_HINT}` },
                            title: { type: 'string', description: 'The new title.' },
                            body: { type: 'string', description: 'The new body, replacing the old one entirely.' },
                            tags: {
                                type: 'array',
                                items: { type: 'string', description: 'One tag.' },
                                description: 'The complete new tag list. Pass [] to remove every tag.'
                            }
                        },
                        required: ['id']
                    }
                },
                onFailure: 'Failed to update the note',
                run: args => this.updateNote(args)
            },
            {
                definition: {
                    name: 'deleteNote',
                    annotations: {
                        title: 'Delete note',
                        readOnlyHint: false,
                        destructiveHint: true,
                        // Deleting a deleted note leaves it deleted.
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Delete a note permanently. Answers `deleted:false` rather than failing when the note ' +
                        'does not exist, so a repeated call is harmless.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: `The note to delete. ${NOT_FOUND_HINT}` }
                        },
                        required: ['id']
                    }
                },
                onFailure: 'Failed to delete the note',
                run: args => this.deleteNote(args)
            },
            {
                definition: {
                    name: 'listTags',
                    annotations: {
                        title: 'List tags',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Every tag in use and how many notes carry it, most used first. Use it to find the ' +
                        'tag to pass to searchNotes.',
                    inputSchema: { type: 'object', properties: {} },
                    // Withheld by the capability gate on a backend without tag indexing.
                    needsFeature: 'tags'
                },
                onFailure: 'Failed to list tags',
                run: () => this.listTags()
            }
        ];
    }

    private async searchNotes(args: any) {
        const limit = args.limit === undefined ? DEFAULT_LIMIT : Number(args.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            throw new McpError(ErrorCode.InvalidParams, `'limit' must be a whole number from 1 to ${MAX_LIMIT}.`);
        }
        const offset = args.offset === undefined ? 0 : Number(args.offset);
        if (!Number.isInteger(offset) || offset < 0) {
            throw new McpError(ErrorCode.InvalidParams, `'offset' must be a whole number, 0 or more.`);
        }

        const result = await this.backend.searchNotes({
            text: optionalString(args, 'text'),
            tag: optionalString(args, 'tag'),
            limit,
            offset
        });

        const more = offset + result.notes.length < result.total;
        return {
            total: result.total,
            returned: result.notes.length,
            offset,
            notes: result.notes,
            // Said, not left to arithmetic: a model reads "more" faster than it
            // compares three numbers.
            ...(more ? { more: true, nextOffset: offset + result.notes.length } : {})
        };
    }

    private async readNote(args: any) {
        const id = requireString(args, 'id', NOT_FOUND_HINT);
        const note = await this.backend.getNote(id);
        if (!note) {
            throw new McpError(ErrorCode.InvalidParams, `There is no note '${id}'. ${NOT_FOUND_HINT}`);
        }
        return { note };
    }

    private async createNote(args: any) {
        const note = await this.backend.createNote({
            title: requireString(args, 'title'),
            body: optionalString(args, 'body'),
            tags: optionalTags(args)
        });
        return { note };
    }

    private async updateNote(args: any) {
        const id = requireString(args, 'id', NOT_FOUND_HINT);
        const patch = {
            title: optionalString(args, 'title'),
            body: optionalString(args, 'body'),
            tags: optionalTags(args)
        };
        if (patch.title === undefined && patch.body === undefined && patch.tags === undefined) {
            throw new McpError(ErrorCode.InvalidParams, 'Nothing to change: pass at least one of title, body or tags.');
        }
        if (patch.title !== undefined && !patch.title.trim()) {
            throw new McpError(ErrorCode.InvalidParams, `'title' cannot be empty.`);
        }

        const before = await this.backend.getNote(id);
        if (!before) {
            throw new McpError(ErrorCode.InvalidParams, `There is no note '${id}'. ${NOT_FOUND_HINT}`);
        }
        const note = await this.backend.updateNote(id, patch);
        if (!note) {
            // Deleted between the two calls: the same answer as never having existed.
            throw new McpError(ErrorCode.InvalidParams, `There is no note '${id}'. ${NOT_FOUND_HINT}`);
        }
        // Compared on content, not on updatedAt: two writes inside one clock tick
        // would otherwise report a real change as none.
        const changed = note.title !== before.title || note.body !== before.body ||
            note.tags.join('\n') !== before.tags.join('\n');
        return { note, changed };
    }

    private async deleteNote(args: any) {
        const id = requireString(args, 'id', NOT_FOUND_HINT);
        const deleted = await this.backend.deleteNote(id);
        return deleted
            ? { id, deleted: true }
            : { id, deleted: false, note: 'There was no such note, so nothing changed.' };
    }

    private async listTags() {
        return { tags: await this.backend.listTags() };
    }
}
