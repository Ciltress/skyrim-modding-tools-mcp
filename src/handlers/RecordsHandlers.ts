import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import { asRequestError, limitArg, optionalBoolean, optionalString, optionalStringList, requireString } from './args.js';

/**
 * Looking records up across the active load order: who defines a record, who overrides it, and what
 * each version says — in the same text a project holds, so a version read here can be mirrored or
 * copied as it stands.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const FORM_ID_HINT = 'FormIDs are written 012EB7:Skyrim.esm.';

export class RecordsHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
            {
                definition: {
                    name: 'findRecords',
                    annotations: {
                        title: 'Find records',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Find records in the active load order — by text in the editor ID or name, or by exact ' +
                        'FormIDs and editor IDs. Each row says which plugin defines the record, which one wins, ' +
                        'and how many override it. Use `records` to turn the FormIDs in project text into names ' +
                        '(and back) before reasoning about them. Placed references, landscape and navmesh are ' +
                        'not searched. `total` counts matches before the limit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            text: {
                                type: 'string',
                                description: 'Case-insensitive text in the editor ID or the in-game name, e.g. "iron sword". Exact matches come first, then in-game names.'
                            },
                            records: {
                                type: 'array',
                                items: { type: 'string', description: 'A FormID like 012EB7:Skyrim.esm, or an editor ID like IronSword.' },
                                description: 'Exact lookups instead of a text search. Unknown ones come back under `notFound`.'
                            },
                            types: {
                                type: 'array',
                                items: { type: 'string', description: 'A signature like WEAP, or a type name like Weapon.' },
                                description: 'Only these record types, e.g. ["WEAP", "ARMO"].'
                            },
                            plugin: {
                                type: 'string',
                                description: 'Only records this plugin defines or overrides, e.g. "Dawnguard.esm".'
                            },
                            limit: {
                                type: 'number',
                                description: `How many rows to return, 1-${MAX_LIMIT}.`,
                                default: DEFAULT_LIMIT
                            }
                        }
                    },
                    narrowingHint: 'Add `types` or `plugin`, make `text` more specific, or lower `limit`.'
                },
                onFailure: 'Failed to search the load order',
                run: args => asRequestError(this.backend.findRecords({
                    text: optionalString(args, 'text'),
                    records: optionalStringList(args, 'records', '["012EB7:Skyrim.esm", "IronSword"]'),
                    types: optionalStringList(args, 'types', '["WEAP"]'),
                    plugin: optionalString(args, 'plugin'),
                    limit: limitArg(args, DEFAULT_LIMIT, MAX_LIMIT)
                }))
            },
            {
                definition: {
                    name: 'readRecord',
                    annotations: {
                        title: 'Read record',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'One record as project text (YAML): by default the version that wins in the load order; ' +
                        'with `plugin`, that plugin\'s version; with `allVersions`, every plugin\'s version, winning ' +
                        'first — compare them to see a conflict. Each file carries `pathInPluginFolder`, where it ' +
                        'would sit in a project\'s plugin folder; to change a record, copy it in with addPatch rather ' +
                        'than writing this text yourself. Links inside are FormIDs: resolve them with findRecords.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            record: {
                                type: 'string',
                                description: `A FormID or an editor ID, e.g. "IronSword". ${FORM_ID_HINT}`
                            },
                            plugin: {
                                type: 'string',
                                description: 'Read this plugin\'s version instead of the winning one, e.g. "Update.esm".'
                            },
                            allVersions: {
                                type: 'boolean',
                                description: 'Every plugin\'s version, winning first. Defaults to false.'
                            }
                        },
                        required: ['record']
                    },
                    narrowingHint: 'Name one `plugin` instead of asking for `allVersions`.'
                },
                onFailure: 'Failed to read the record',
                run: args => asRequestError(this.backend.readRecord({
                    record: requireString(args, 'record', `Pass a FormID or an editor ID. ${FORM_ID_HINT}`),
                    plugin: optionalString(args, 'plugin'),
                    allVersions: optionalBoolean(args, 'allVersions')
                }))
            }
        ];
    }
}
