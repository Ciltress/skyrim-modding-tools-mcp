import type { Backend } from '../Backend.js';

/**
 * The domain operations the tools call, on top of the lifecycle every backend has. FormIDs are
 * written `012EB7:Skyrim.esm` throughout — the defining plugin and the local number, never a
 * load-order slot.
 */
export interface SkyrimBackend extends Backend {
    findRecords(query: RecordQuery): Promise<RecordSearchResult>;
    readRecord(request: RecordRequest): Promise<RecordVersions>;

    newProject(request: NewProjectRequest): Promise<ProjectInfo>;
    /** Copies records into a project as overrides — creating the project first when it does not exist. */
    addPatch(request: AddPatchRequest): Promise<AddPatchResult>;
    buildProject(project: string): Promise<BuildResult>;
    deployProject(project: string): Promise<DeployResult>;
    pullProject(project: string): Promise<PullResult>;
}

export interface NewProjectRequest {
    /** Folder name under the projects folder, and the mod's name in Mod Organizer. */
    project: string;
    /** Plugin file name. Defaults to `<project>.esp`. */
    plugin?: string;
    /** Light (ESL-flagged). Defaults to true. */
    light?: boolean;
}

export interface ProjectInfo {
    project: string;
    plugin: string;
    light: boolean;
    /** The project's folder on disk. */
    path: string;
    /** Where its records live, one YAML file each. */
    pluginFolder: string;
    created: boolean;
}

export interface AddPatchRequest {
    project: string;
    /** FormIDs or editor IDs of the records to override. */
    records: string[];
    /** Copy that plugin's version instead of the winning one. */
    from?: string;
    /** Plugin file name when the project is created here. Defaults to `<project>.esp`. */
    plugin?: string;
}

export interface AddPatchResult {
    project: ProjectInfo;
    added: { formId: string; editorId: string | null; type: string; from: string; files: string[] }[];
    alreadyInProject: { formId: string; file: string }[];
}

export interface BuildResult {
    project: string;
    plugin: string;
    output: string;
    records: number;
    masters: string[];
    headerVersion: number;
    /** New records that got their FormID in this build. */
    assignedFormIds: { formId: string; editorId: string | null; file: string }[];
    scripts: { compiled: number };
}

export interface DeployResult {
    project: string;
    plugin: string;
    modFolder: string;
    files: number;
    /** A copy of the plugin in overwrite, already pulled into the project, that was removed so it no longer hides the mod's. */
    removedFromOverwrite?: string;
    /** What happened in Mod Organizer's profile. */
    profile: { name: string; modEnabled: boolean; pluginActive: boolean; addedToLoadOrder: boolean };
    /** Whether a running Mod Organizer was told to re-read its profile. */
    modOrganizer: 'notRunning' | 'refreshed' | 'otherInstanceRunning';
}

export interface PullResult {
    project: string;
    plugin: string;
    source: string;
    added: string[];
    changed: string[];
    removed: string[];
    /** Set when the pull could not check git, so nothing guarded uncommitted work. */
    warning?: string;
}

export interface RecordQuery {
    /** Case-insensitive text in the editor ID or the name. */
    text?: string;
    /** Exact lookups: FormIDs or editor IDs. Takes precedence over `text`. */
    records?: string[];
    /** Signatures (`WEAP`) or Mutagen type names (`Weapon`). */
    types?: string[];
    /** Only records this plugin defines or overrides. */
    plugin?: string;
    limit: number;
}

export interface RecordSummary {
    formId: string;
    editorId: string | null;
    name: string | null;
    signature: string;
    type: string;
    /** The plugin that first defined the record. */
    definedIn: string;
    /** The plugin whose version the game uses. */
    winner: string;
    /** How many plugins override it after the one that defined it. */
    overrides: number;
}

export interface RecordSearchResult {
    /** Matches before the limit. */
    total: number;
    records: RecordSummary[];
    /** Exact lookups that matched nothing. */
    notFound?: string[];
}

export interface RecordRequest {
    /** A FormID or an editor ID. */
    record: string;
    /** That plugin's version, instead of the winning one. */
    plugin?: string;
    /** Every plugin's version, winning first. */
    allVersions?: boolean;
}

export interface RecordFile {
    /** Path inside a project's plugin folder, e.g. `Weapons/IronSword - 012EB7_Skyrim.esm.yaml`. */
    path: string;
    text: string;
}

export interface RecordVersion {
    plugin: string;
    winning: boolean;
    files: RecordFile[];
}

export interface RecordVersions {
    formId: string;
    editorId: string | null;
    type: string;
    signature: string;
    definedIn: string;
    winner: string;
    /** Every plugin that carries the record, in load order — the last one wins. */
    plugins: string[];
    versions: RecordVersion[];
}
