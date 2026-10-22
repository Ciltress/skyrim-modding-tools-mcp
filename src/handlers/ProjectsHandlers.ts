import { BaseHandler } from './BaseHandler.js';
import type { ToolSpec } from './BaseHandler.js';
import { asRequestError, optionalBoolean, optionalString, optionalStringList, recordRef, requireString } from './args.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FAMILY_SKILLS } from '../lib/skills.js';

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
                        'Create an empty project for a new mod. Add records by writing YAML files into its plugin ' +
                        'folder — one file per record, in its type\'s group folder there; the answer\'s ' +
                        '`writeRecordsTo` gives the full path, so never write into the project folder itself, and its ' +
                        '`readFirst` the skill to read for each family of records. Write ' +
                        'each record the way readRecord shows a vanilla one of its type, and leave out FormKey: the ' +
                        'build assigns one. To change records other mods already have, use addPatch instead.',
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
                run: async args => ({
                    ...await asRequestError(this.backend.newProject({
                        project: requireString(args, 'project'),
                        plugin: optionalString(args, 'plugin'),
                        light: optionalBoolean(args, 'light')
                    })),
                    // At the moment records are about to be written: the instructions alone left 26b without
                    // the family's skill in three of nine authoring runs (eval round 12).
                    readFirst: `Before writing a record, read its family's skill with readSkill: ` +
                        `${FAMILY_SKILLS.map(family => `"${family.skill}" for ${family.covers}`).join('; ')}. ` +
                        'Each holds the vanilla values its records are written with.'
                })
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
                        'Start or extend a patch — no newProject first: this creates the project when it does not ' +
                        'exist. Copies existing records into the project as overrides, to change them without touching ' +
                        'the plugins they come from: each from its current winning version — so other mods\' changes ' +
                        'are kept — or from `from`. Answers each copied file\'s full path and text (`added[].files`): edit it ' +
                        'with your file tools, then run buildProject. Past about ten records the text is left out ' +
                        '(`textLeftOut`) — read those files first. A record already in the project is reported under ' +
                        '`alreadyInProject` and left alone. An override changes the record itself, everywhere: for a new ' +
                        'record like a vanilla one, write a new file with newProject instead.',
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
                                description: 'The new project\'s own plugin file name, used only when this call creates the ' +
                                    'project. Defaults to "<project>.esp". Not the plugin to copy from — that is `from`.'
                            }
                        },
                        required: ['project', 'records']
                    }
                },
                onFailure: 'Failed to add records to the patch',
                run: args => {
                    const records = optionalStringList(args, 'records', '["IronSword"]')?.map(recordRef);
                    if (!records) {
                        throw new McpError(ErrorCode.InvalidParams,
                            `'records' is required: the FormIDs or editor IDs to override, e.g. ["IronSword"].`);
                    }
                    return asRequestError(this.backend.addPatch({
                        project: requireString(args, 'project'),
                        records,
                        from: optionalString(args, 'from'),
                        plugin: optionalString(args, 'plugin')
                    })).then(result => {
                        // Asked for a new sword "like the Iron Sword", a model patched the Iron Sword and renamed it:
                        // every Iron Sword in the game became its Flame Blade (eval probe 16). Said after every copied
                        // file's text, it left e4b making its "new" sword or note this way in four of six misses
                        // (eval round 22): first now, naming the records, as a build's warnings went first (round 21).
                        // The copy written empty, not deleted: OpenClaw gives a model no tool to delete a file (round 26).
                        const copies = [
                            ...result.added.map(record => record.editorId ? `${record.editorId} (${record.formId})` : record.formId),
                            ...result.alreadyInProject.map(record => record.formId)
                        ];
                        const one = copies.length === 1;
                        return {
                            note: `${copies.join(', ')} ${one ? 'is' : 'are'} copied as ${one ? 'an override' : 'overrides'}: ` +
                                `${one ? 'it changes that record' : 'each changes its record'} itself, everywhere the game uses ` +
                                `${one ? 'it' : 'them'} — a new name renames ${one ? 'it' : 'them'} everywhere. If a new record ` +
                                'like it was meant, write a new file instead, mirroring it without the FormKey line and with an ' +
                                'EditorID of its own, where newProject\'s writeRecordsTo says — and write the copy empty — the build ' +
                                'leaves an empty record file out.',
                            ...result
                        };
                    });
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
                        'their files, which keep their names), turns a link written as an editor ID — a new record of the project, or one of the ' +
                        'load order — into that record\'s FormID (`resolvedLinks`), checks that every link points at a ' +
                        'record that exists, compiles the project\'s Papyrus scripts and writes the plugin with the ' +
                        'header this game version needs. Refuses a project with no records, fields a record type does ' +
                        'not have, and files below a group\'s folder — each named. What has one right fix — a FormKey copied ' +
                        'into a new record, escapes copied out of a JSON answer — it writes into the file and lists in `corrected`. ' +
                        'What builds but likely not as meant — record files outside the plugin folder, an override ' +
                        'renamed as if it were a new record, a woman\'s voice on a man — is answered with status ' +
                        '`built_with_warnings` and the `warnings` first: the plugin is written, and each warning says ' +
                        'what to fix. Does not touch the mod manager — deployProject does.',
                    inputSchema: { type: 'object', properties: { project: PROJECT }, required: ['project'] }
                },
                onFailure: 'Failed to build the project',
                run: async args => {
                    const { warnings, ...built } = await asRequestError(this.backend.buildProject(requireString(args, 'project')));
                    if (!warnings?.length) return built;
                    // A warning at the end of an answer that said success was passed by: five of e4b's eight misses
                    // in eval round 21 end on one, each a build that did what was not asked.
                    return {
                        status: 'built_with_warnings',
                        warnings,
                        nextStep: `Built, with ${warnings.length === 1 ? 'a warning' : `${warnings.length} warnings`}: ` +
                            'read each — fix what it says and build again, unless the user asked for it so.',
                        ...built
                    };
                }
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
                        'Returns the full paths of the files added, changed and removed.',
                    inputSchema: { type: 'object', properties: { project: PROJECT }, required: ['project'] }
                },
                onFailure: 'Failed to pull the project',
                run: args => asRequestError(this.backend.pullProject(requireString(args, 'project')))
            }
        ];
    }
}
