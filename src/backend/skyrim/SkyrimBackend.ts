import type { Backend } from '../Backend.js';
import type { ModManagerNotice, ProfileChange } from './modManager.js';

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

    /** Skyrim SE mods on Nexus Mods. Needs no instance, and no API key. */
    searchNexus(query: NexusSearchQuery): Promise<NexusSearchResult>;
    readNexusMod(modId: number): Promise<NexusMod>;
    /** One file of a Nexus mod into the instance's downloads folder. Needs a premium account's key. */
    downloadNexusFile(modId: number, fileId: number): Promise<NexusDownload>;
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

/** A file in a project: the full path a file tool opens as it stands, and what it holds. */
export interface ProjectFile {
    path: string;
    /** Left out once an answer carries enough text — `textLeftOut` then says so. */
    text?: string;
}

export interface AddPatchResult {
    project: ProjectInfo;
    added: { formId: string; editorId: string | null; type: string; from: string; files: ProjectFile[] }[];
    alreadyInProject: { formId: string; files: ProjectFile[] }[];
    /** Set when some files come without their text. */
    textLeftOut?: string;
}

export interface BuildResult {
    project: string;
    plugin: string;
    output: string;
    records: number;
    masters: string[];
    headerVersion: number;
    /** New records that got their FormID in this build, each with the full path of its renamed file. */
    assignedFormIds: { formId: string; editorId: string | null; file: string }[];
    scripts: { compiled: number };
}

export interface DeployResult {
    project: string;
    plugin: string;
    modFolder: string;
    files: number;
    /** Copies of the plugin that outranked the mod's — in overwrite — already pulled into the project, and removed so they no longer hide it. */
    removedCopies?: string[];
    /** What happened in the selected profile. */
    profile: { name: string } & ProfileChange;
    /** What the mod manager was told. */
    modManager: ModManagerNotice;
}

export interface PullResult {
    project: string;
    plugin: string;
    source: string;
    /** Full paths of the project's files, as for addPatch. */
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
    /**
     * Where the file would sit in a project's plugin folder, e.g. `Weapons/IronSword - 012EB7_Skyrim.esm.yaml`.
     * Not called `path`: that name is kept for full paths a file tool opens (ProjectFile).
     */
    pathInPluginFolder: string;
    text: string;
}

export interface RecordVersion {
    plugin: string;
    winning: boolean;
    files: RecordFile[];
}

/**
 * The Nexus account behind NEXUS_API_KEY: none set; checked, with its name and standing; refused by
 * Nexus (`problem`); or not checked, because Nexus could not be asked (`unchecked`). Never the key.
 */
export type NexusAccount =
    | { apiKey: false }
    | { apiKey: true; name: string; premium: boolean; supporter: boolean }
    | { apiKey: true; problem: string }
    | { apiKey: true; unchecked: string };

export type NexusSort = 'endorsements' | 'downloads' | 'updated';

export interface NexusSearchQuery {
    /** Words in the mod's name, matched in any order. Without it, the catalogue in `sort` order. */
    text?: string;
    /** Most endorsed first unless set. */
    sort?: NexusSort;
    limit: number;
}

export interface NexusModSummary {
    modId: number;
    name: string;
    version: string;
    author: string;
    category: string;
    summary: string;
    endorsements: number;
    downloads: number;
    /** `YYYY-MM-DD`. */
    updated: string;
    /** The mod's page on Nexus Mods. */
    url: string;
    /** Set when Nexus marks the mod as adult content. */
    adult?: true;
}

export interface NexusSearchResult {
    /** Matches before the limit. */
    total: number;
    mods: NexusModSummary[];
}

export interface NexusRequirement {
    /** Set for a requirement on Nexus Mods. */
    modId?: number;
    name: string;
    notes?: string;
    url?: string;
}

/** One download a Nexus mod offers now. */
export interface NexusFileInfo {
    fileId: number;
    name: string;
    version: string;
    /** `main`, `update`, `optional` or `miscellaneous`. */
    category: string;
    /** The file's name as it downloads. */
    fileName: string;
    sizeBytes: number;
    /** `YYYY-MM-DD`. */
    uploaded: string;
    description?: string;
}

export interface NexusMod extends NexusModSummary {
    uploader: string;
    /** The mod page's description as plain text. */
    description: string;
    /** Set when the description was cut, saying where the rest is. */
    descriptionCut?: string;
    requirements: NexusRequirement[];
    /** DLCs the mod needs, by name. */
    dlcRequirements: string[];
    files: NexusFileInfo[];
    /** Files the page keeps as old versions, archived or removed, left out of `files`. */
    olderFiles: number;
}

/** A Nexus file in the instance's downloads folder. */
export interface NexusDownload {
    /** The downloaded file's full path. */
    path: string;
    modId: number;
    fileId: number;
    modName: string;
    /** The file's name on the mod page. */
    name: string;
    version: string;
    /** `main`, `update`, `optional`, `miscellaneous`… */
    category: string;
    sizeBytes: number;
    /** Set when the file was there already, with the right size, and was not downloaded again. */
    alreadyThere?: true;
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
