import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import { asRequestError, optionalBoolean, optionalString, requireString } from './args.js';

/**
 * The instance's mods: installing a downloaded file as one. Any .7z, .zip or .rar in the downloads
 * folder — downloadNexusFile's, or one the user downloaded by hand — whether it carries a FOMOD
 * installer or not. Nothing here reaches Nexus.
 */
export class ModsHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
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
                        'and activate its plugins at the end of the load order; then the mod manager is told, as for ' +
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
