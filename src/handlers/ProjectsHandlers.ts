import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import { asRequestError, optionalBoolean, optionalString, optionalStringList, requireString } from './args.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Projects: mods authored as text (docs/adr/0004). Records are changed by editing the project's YAML
 * files with ordinary file tools — there is deliberately no tool that edits a record. These tools
 * create the starting points, and move a project between text, plugin and the mod manager:
 *
 *   newProject / addPatch  ->  edit plugin/*.yaml  ->  buildProject  ->  deployProject
 *                                        ^                                      |
 *                                        +------ pullProject <- Creation Kit ---+
 */

const PROJECT = {
    type: 'string' as const,
    description: 'The project\'s name: its folder under the projects folder, and its mod name in the mod manager, e.g. "IronSwordBuff".'
};

export class ProjectsHandlers extends BaseHandler {
    protected toolSpecs(): ToolSpec[] {
        return [
            {
                definition: {
                    name: 'newProject',
                    annotations: {
                        title: 'New project',
                        readOnlyHint: false,
                        destructiveHint: false,
                        // A second call returns the existing project and changes nothing.
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Create an empty project for a new mod: a plugin folder holding RecordData.yaml. Add records ' +
                        'by writing YAML files into it (one file per record, in the group\'s folder, e.g. ' +
                        'Weapons/MySword.yaml — leave out FormKey, the build assigns one). To change records other ' +
                        'mods already have, use addPatch instead. Returns the folder to write into.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            project: PROJECT,
                            plugin: { type: 'string', description: 'The plugin file name. Defaults to "<project>.esp".' },
                            light: {
                                type: 'boolean',
                                description: 'A light (ESL-flagged) plugin: no load-order slot; the build numbers its new records 000800–000FFF, 2,048 in all. Defaults to true.'
                            }
                        },
                        required: ['project']
                    }
                },
                onFailure: 'Failed to create the project',
                run: args => asRequestError(this.backend.newProject({
                    project: requireString(args, 'project'),
                    plugin: optionalString(args, 'plugin'),
                    light: optionalBoolean(args, 'light')
                }))
            },
            {
                definition: {
                    name: 'addPatch',
                    annotations: {
                        title: 'Add records to a patch',
                        readOnlyHint: false,
                        // Only adds files; a record already in the project is left as it is.
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Start or extend a patch: copy existing records into a project as overrides, so they can be ' +
                        'changed without touching the plugins they come from. Each record is copied from its current ' +
                        'winning version — so other mods\' changes are kept — or from `from`. Creates the project when ' +
                        'it does not exist. Then edit the copied files — their full paths are in `added[].files` — ' +
                        'and run buildProject. A record already in the project is reported under `alreadyInProject` ' +
                        'and left alone.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            project: PROJECT,
                            records: {
                                type: 'array',
                                items: { type: 'string', description: 'A FormID like 012EB7:Skyrim.esm, or an editor ID like IronSword.' },
                                description: 'The records to override. Find them with findRecords.'
                            },
                            from: {
                                type: 'string',
                                description: 'Copy this plugin\'s version instead of the winning one, e.g. "Update.esm".'
                            },
                            plugin: {
                                type: 'string',
                                description: 'Plugin file name, used only when this call creates the project. Defaults to "<project>.esp".'
                            }
                        },
                        required: ['project', 'records']
                    }
                },
                onFailure: 'Failed to add records to the patch',
                run: args => {
                    const records = optionalStringList(args, 'records', '["IronSword"]');
                    if (!records) {
                        throw new McpError(ErrorCode.InvalidParams,
                            `'records' is required: the FormIDs or editor IDs to override, e.g. ["IronSword"].`);
                    }
                    return asRequestError(this.backend.addPatch({
                        project: requireString(args, 'project'),
                        records,
                        from: optionalString(args, 'from'),
                        plugin: optionalString(args, 'plugin')
                    }));
                }
            },
            {
                definition: {
                    name: 'buildProject',
                    annotations: {
                        title: 'Build project',
                        readOnlyHint: false,
                        // Replaces only its own previous output. New records get a FormID once, never again.
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Build a project\'s plugin from its text: gives new records their FormIDs (written back into ' +
                        'their files), checks that every link (a FormID in a field) points at a record that exists, ' +
                        'compiles the project\'s Papyrus scripts and writes the plugin with the header this game ' +
                        'version needs. Fails with the list of broken links, if any. Does not touch the mod manager — ' +
                        'deployProject does.',
                    inputSchema: { type: 'object', properties: { project: PROJECT }, required: ['project'] }
                },
                onFailure: 'Failed to build the project',
                run: args => asRequestError(this.backend.buildProject(requireString(args, 'project')))
            },
            {
                definition: {
                    name: 'deployProject',
                    annotations: {
                        title: 'Deploy project',
                        readOnlyHint: false,
                        // Replaces the project's mod folder in the mod manager.
                        destructiveHint: true,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Put a built project into the mod manager (Mod Organizer or Amethyst): make its mod folder ' +
                        'the build plus the project\'s assets, enable the mod, and activate the plugin — at the end ' +
                        'of the load order when it is new, so it wins over what it patches. Then a running Mod ' +
                        'Organizer re-reads its profile, or Amethyst deploys it into the game; when the user has to ' +
                        'act, `modManager.nextStep` says what to do — tell them. Refuses when the project changed ' +
                        'since its build, or when the deployed plugin was changed elsewhere (e.g. saved in the ' +
                        'Creation Kit) — pull that first; a pulled copy that would hide the mod is then removed.',
                    inputSchema: { type: 'object', properties: { project: PROJECT }, required: ['project'] }
                },
                onFailure: 'Failed to deploy the project',
                run: args => asRequestError(this.backend.deployProject(requireString(args, 'project')))
            },
            {
                definition: {
                    name: 'pullProject',
                    annotations: {
                        title: 'Pull project',
                        readOnlyHint: false,
                        // Rewrites the project's text from the deployed plugin.
                        destructiveHint: true,
                        idempotentHint: true,
                        openWorldHint: false
                    },
                    description:
                        'Bring changes made to a deployed plugin outside the project — placing objects in the ' +
                        'Creation Kit, a fix in xEdit — back into the project\'s text. Refuses while the project folder ' +
                        'has uncommitted changes, so what the pull changes can be reviewed with git diff and undone; ' +
                        'where git cannot tell (no git, or no repository), it pulls and says so in `warning`. ' +
                        'Returns the files added, changed and removed.',
                    inputSchema: { type: 'object', properties: { project: PROJECT }, required: ['project'] }
                },
                onFailure: 'Failed to pull the project',
                run: args => asRequestError(this.backend.pullProject(requireString(args, 'project')))
            }
        ];
    }
}
