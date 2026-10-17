import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import { asRequestError, limitArg, offsetArg, optionalBoolean, optionalString, requireString } from './args.js';

/** listMods' page: a whole list of most setups, within core's 24 KB (a short row is ~135 bytes); a part of a Wabbajack one's. */
const MOD_PAGE = 150;
const MAX_MOD_PAGE = 5000;

/**
 * The instance's mods: listing them, checking them against the game's version, installing a downloaded
 * file as one — any .7z, .zip or .rar in the downloads folder, downloadNexusFile's or one the user
 * downloaded by hand, whether it carries a FOMOD installer or not — and disabling one. Nothing here
 * reaches Nexus.
 */
export class ModsHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
            {
                definition: {
                    name: 'listMods',
                    annotations: {
                        title: 'List mods',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'The mods installed in the mod manager\'s selected profile, lowest priority first as Mod Organizer ' +
                        'shows them, one short row each: enabled or not, its priority and separator, its Nexus Mods modId ' +
                        '(for readNexusMod), and `skse` when it carries SKSE plugins. With `details`, also its plugins — ' +
                        'whether the game loads that copy — and the file and version installed. `total` counts every mod ' +
                        `matched; past ${MOD_PAGE}, \`next\` says how to get the rest. Read from the files, at once.`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            text: {
                                type: 'string',
                                description: 'Only the mods whose name holds this, in any case, e.g. "SkyUI".'
                            },
                            enabledOnly: {
                                type: 'boolean',
                                description: 'Only the enabled mods.'
                            },
                            details: {
                                type: 'boolean',
                                description: 'Each mod\'s plugins, and the Nexus file and version installed.'
                            },
                            limit: {
                                type: 'number',
                                description: `How many mods to answer, 1-${MAX_MOD_PAGE}.`,
                                default: MOD_PAGE
                            },
                            offset: {
                                type: 'number',
                                description: 'Where to start, for the rest of a long list: the offset `next` names.'
                            }
                        }
                    },
                    narrowingHint: 'Give `text`, a part of the names of the mods you want, or `enabledOnly`; leave out `details`, or lower `limit`.'
                },
                onFailure: 'Failed to list the mods',
                run: args => asRequestError(this.backend.listMods({
                    text: optionalString(args, 'text'),
                    enabledOnly: optionalBoolean(args, 'enabledOnly'),
                    details: optionalBoolean(args, 'details'),
                    limit: limitArg(args, MOD_PAGE, MAX_MOD_PAGE),
                    offset: offsetArg(args)
                }))
            },
            {
                definition: {
                    name: 'checkGameVersion',
                    annotations: {
                        title: 'Check mods against the game version',
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Whether the mods fit the installed game version: SKSE in the game folder, Address Library\'s file for ' +
                        'this runtime, and every SKSE plugin the game loads — the copy that wins, from enabled mods, overwrite ' +
                        'and the game folder — judged by SKSE\'s own log of the last game start where it is this game\'s, and by ' +
                        'the rules SKSE and Address Library apply. `problems` groups the plugins that do not fit, each with its ' +
                        'mod and Nexus modId: refusedAtLastStart (SKSE did not load it), willNotLoad (it will not), mayNotWork ' +
                        '(an Address Library plugin from before 1.7.99\'s change: it loads, and often still works — try the ' +
                        'game). Plugins that fit are only counted. Reads files; changes nothing.',
                    inputSchema: {
                        type: 'object',
                        properties: {}
                    }
                },
                onFailure: 'Failed to check the game version',
                run: () => asRequestError(this.backend.checkGameVersion())
            },
            {
                definition: {
                    name: 'installMod',
                    annotations: {
                        title: 'Install mod',
                        readOnlyHint: false,
                        // With `replace`, a mod's files are replaced.
                        destructiveHint: true,
                        // Installed again with `replace`, the mod and the profile end up as they were.
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Install a downloaded file (.7z, .zip, .rar) as a mod: unpack it into a new mod, enable the mod ' +
                        'and activate its plugins at the end of the load order — or right before an active plugin that ' +
                        'needs one as a master (`placedBefore`); then the mod manager is told, as for ' +
                        'deployProject — when the user has to act, `modManager.nextStep` says what. A file with a FOMOD ' +
                        'installer takes two calls: the first installs nothing and answers its steps, every option with ' +
                        'an id like 1.1.2; the second, with `choices`, installs. A mod name already taken is refused ' +
                        'unless `replace` is true. `missingMasters` names plugins the game cannot load until the mods ' +
                        'they need are installed too.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                description: 'The downloaded file: its name in the downloads folder, or its full path, as ' +
                                    'downloadNexusFile answers it.'
                            },
                            choices: {
                                type: 'array',
                                items: { type: 'string', description: 'An option id like 1.1.2: step, group, option.' },
                                description: 'For a FOMOD installer: the ids of the options to install, from the first ' +
                                    'answer, e.g. ["1.1.2", "2.1.1"]. A group you choose nothing in keeps its default; [] ' +
                                    'installs every default.'
                            },
                            name: {
                                type: 'string',
                                description: 'The mod\'s name in the mod manager. Defaults to the Nexus mod\'s name, else the file\'s.'
                            },
                            root: {
                                type: 'string',
                                description: 'Only when an answer asks for it: the folder of the file to install as the ' +
                                    'mod, e.g. "2K". It is installed as it is, without any FOMOD installer.'
                            },
                            replace: {
                                type: 'boolean',
                                description: 'Replace the files of the mod of the same name; it keeps its place in the mod order.'
                            }
                        },
                        required: ['file']
                    }
                },
                onFailure: 'Failed to install the mod',
                run: args => asRequestError(this.backend.installMod({
                    file: requireString(args, 'file', 'Give the downloaded file\'s name in the downloads folder, or its full path.'),
                    choices: choicesArg(args),
                    name: optionalString(args, 'name'),
                    root: rootArg(args),
                    replace: optionalBoolean(args, 'replace')
                }))
            },
            {
                definition: {
                    name: 'disableMod',
                    annotations: {
                        title: 'Disable mod',
                        readOnlyHint: false,
                        // Its plugins lose their place in the load order.
                        destructiveHint: true,
                        // A mod disabled already is left as it is.
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Disable a mod in the mod manager\'s selected profile — only when the user said so, for this mod: ' +
                        'it stays where it is in the mod order, its files stay, and its plugins leave the load order as the ' +
                        'mod manager does with a disabled mod\'s — except one another enabled mod also has (`keptActive`). ' +
                        'Then the mod manager is told, as for installMod. `missingMasters` names active plugins that need one ' +
                        'taken out: the game will not start until their mods are disabled too, or this one enabled again.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            mod: {
                                type: 'string',
                                description: 'The mod\'s name, as listMods shows it, e.g. "Better Jumping SE".'
                            }
                        },
                        required: ['mod']
                    }
                },
                onFailure: 'Failed to disable the mod',
                run: args => asRequestError(this.backend.disableMod({
                    mod: requireString(args, 'mod', 'Give the mod\'s name as listMods shows it.')
                }))
            }
        ];
    }
}

/** The choices as given — an empty list too, which installs every default. */
function choicesArg(args: any): string[] | undefined {
    const value = args?.choices;
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new McpError(ErrorCode.InvalidParams,
            '\'choices\' must be an array of option ids from the first answer, e.g. ["1.1.2", "2.1.1"]; [] installs every default.');
    }
    return value.map((item: string) => item.trim()).filter(Boolean);
}

/** The folder as given — '' too, which is the file's top. */
function rootArg(args: any): string | undefined {
    const value = args?.root;
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') throw new McpError(ErrorCode.InvalidParams, '\'root\' must be a folder of the file, e.g. "2K".');
    return value.trim();
}
