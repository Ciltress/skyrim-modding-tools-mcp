import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import { asRequestError, limitArg, optionalChoice, optionalString, requirePositiveInteger } from './args.js';
import type { NexusSort } from '../backend/index.js';

/**
 * The Nexus Mods catalogue for Skyrim Special Edition: finding a mod, reading its page — what it
 * requires and which files it offers — and downloading a file of it. Searching and reading need no
 * API key; downloading through the API needs a premium account's, so that tool is gated. Nexus is an
 * outside service, so these are the server's open-world tools.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SORTS: readonly NexusSort[] = ['endorsements', 'downloads', 'updated'];

const MOD_ID_HINT = 'It is the number in the mod page\'s address: …/skyrimspecialedition/mods/12604.';

export class NexusHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
            {
                definition: {
                    name: 'searchNexus',
                    annotations: {
                        title: 'Search Nexus Mods',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: true
                    },
                    description:
                        'Search Nexus Mods for Skyrim Special Edition mods by words in their name, matched in any ' +
                        'order — most endorsed first; without `text`, the catalogue in `sort` order. Each row has ' +
                        'the mod\'s number (`modId`), version, author, summary and page. Read one with readNexusMod. ' +
                        '`total` counts matches before the limit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            text: {
                                type: 'string',
                                description: 'Words in the mod\'s name, e.g. "address library".'
                            },
                            sort: {
                                type: 'string',
                                enum: [...SORTS],
                                description: 'Most endorsed, most downloaded or latest updated first. Defaults to endorsements.'
                            },
                            limit: {
                                type: 'number',
                                description: `How many mods to return, 1-${MAX_LIMIT}.`,
                                default: DEFAULT_LIMIT
                            }
                        }
                    },
                    narrowingHint: 'Make `text` more specific, or lower `limit`.'
                },
                onFailure: 'Failed to search Nexus Mods',
                run: args => asRequestError(this.backend.searchNexus({
                    text: optionalString(args, 'text'),
                    sort: optionalChoice(args, 'sort', SORTS),
                    limit: limitArg(args, DEFAULT_LIMIT, MAX_LIMIT)
                }))
            },
            {
                definition: {
                    name: 'readNexusMod',
                    annotations: {
                        title: 'Read Nexus mod',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: true
                    },
                    description:
                        'One Nexus Mods page for Skyrim Special Edition: its description as text, what it requires — ' +
                        'SKSE, other mods, DLC — and the files it offers now (main, update, optional, miscellaneous), ' +
                        'each with its fileId, version and size. Check the requirements before recommending or ' +
                        'installing a mod: one that lacks them crashes the game or does nothing.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            modId: {
                                type: 'number',
                                description: `The Nexus mod's number. ${MOD_ID_HINT}`
                            }
                        },
                        required: ['modId']
                    }
                },
                onFailure: 'Failed to read the Nexus mod',
                run: args => asRequestError(this.backend.readNexusMod(requirePositiveInteger(args, 'modId', MOD_ID_HINT)))
            },
            {
                definition: {
                    name: 'downloadNexusFile',
                    annotations: {
                        title: 'Download Nexus file',
                        readOnlyHint: false,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: true
                    },
                    description:
                        'Download one file of a Nexus mod into the instance\'s downloads folder, through Nexus\'s API — ' +
                        'listed only when NEXUS_API_KEY belongs to a premium account. Take modId and fileId from ' +
                        'readNexusMod\'s files: usually the main file, plus the optional files the user wants. ' +
                        'Recorded beside it the way Mod Organizer records its own downloads; a file already there with ' +
                        'the right size is not downloaded again. Answers its full path.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            modId: {
                                type: 'number',
                                description: `The Nexus mod's number. ${MOD_ID_HINT}`
                            },
                            fileId: {
                                type: 'number',
                                description: 'The file\'s number, from readNexusMod\'s `files`.'
                            }
                        },
                        required: ['modId', 'fileId']
                    },
                    needsFeature: 'nexus-premium'
                },
                onFailure: 'Failed to download the Nexus file',
                run: args => asRequestError(this.backend.downloadNexusFile(
                    requirePositiveInteger(args, 'modId', MOD_ID_HINT),
                    requirePositiveInteger(args, 'fileId', 'Take it from readNexusMod\'s `files`.')
                ))
            }
        ];
    }
}
