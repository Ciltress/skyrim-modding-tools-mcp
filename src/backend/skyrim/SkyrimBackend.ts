import type { Backend } from '../Backend.js';
import type { InstallerQuestions } from './installer.js';
import type { ModDisabled, ModEnabled, ModManagerName, ModManagerNotice, ProfileChange } from './modManager.js';

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
    /** Changes fields of one record file of a project by their paths, with no text to match (docs/adr/0008). */
    editRecord(request: EditRecordRequest): Promise<EditRecordResult>;
    buildProject(project: string): Promise<BuildResult>;
    deployProject(project: string): Promise<DeployResult>;
    pullProject(project: string): Promise<PullResult>;

    /** Skyrim SE mods on Nexus Mods. Needs no instance, and no API key. */
    searchNexus(query: NexusSearchQuery): Promise<NexusSearchResult>;
    readNexusMod(modId: number): Promise<NexusMod>;
    /** One file of a Nexus mod into the instance's downloads folder. Needs a premium account's key. */
    downloadNexusFile(modId: number, fileId: number): Promise<NexusDownload>;

    /**
     * A downloaded file installed as a mod, enabled, its plugins active. A FOMOD installer is answered
     * first with what it asks, unless the request carries the choices.
     */
    installMod(request: InstallModRequest): Promise<InstallModResult | InstallModQuestions>;

    /** A mod disabled where it stands, its plugins out of the load order; its files stay. */
    disableMod(request: DisableModRequest): Promise<DisableModResult>;

    /** The selected profile's mods, lowest priority first: each one's plugins, Nexus record and SKSE plugins. */
    listMods(query: ModListQuery): Promise<ModList>;

    /** Whether SKSE, Address Library and each SKSE plugin the game loads fit its version — SKSE's log of the last start first. */
    checkGameVersion(): Promise<GameVersionCheck>;
}

export type { GameProblem, GameVersionCheck } from './sksePlugins.js';
import type { GameVersionCheck } from './sksePlugins.js';

export interface ModListQuery {
    /** Only the mods whose name holds this, in any case. */
    text?: string;
    enabledOnly?: boolean;
    /** Each mod's plugins and its whole Nexus record; without, one short row a mod. */
    details?: boolean;
    /** How many mods to answer, from `offset`; all of them unless given. */
    limit?: number;
    offset?: number;
}

export interface ModList {
    modManager: ModManagerName;
    profile: string;
    /** How the list is ordered, in words. */
    order: string;
    /** The mods matched, before the page was cut. */
    total: number;
    enabled: number;
    mods: ListedMod[];
    /** How to get the rest, when the page did not hold every mod matched. */
    next?: string;
    /** What a filter left out, when it left nothing. */
    note?: string;
}

export interface ListedMod {
    name: string;
    enabled: boolean;
    /** Mod Organizer's priority, separators counted: 0 is the lowest, and of two mods with the same file the higher one's is used. */
    priority: number;
    /** The separator the mod is listed under. */
    section?: string;
    /** With details. */
    plugins?: ListedPlugin[];
    /** What the mod manager recorded when it installed the mod from Nexus Mods (meta.ini): the modId always, the rest with details. */
    nexus?: { modId: number; fileId?: number; version?: string; file?: string };
    /** Whether it carries SKSE plugins: DLLs in SKSE/Plugins. */
    skse?: true;
}

export interface ListedPlugin {
    name: string;
    /** Whether the game loads this copy: the mod enabled, the plugin active, and no higher mod's copy of it. */
    active: boolean;
    /** Where the copy the game loads comes from instead: a higher mod, overwrite, or the game's Data folder. */
    loadedFrom?: string;
}

export interface InstallModRequest {
    /** The downloaded file: its full path, or its name in the instance's downloads folder. */
    file: string;
    /** The mod's name in the mod manager. Defaults to the Nexus mod's name, else the file's. */
    name?: string;
    /** FOMOD option ids, `step.group.option`. Groups they name nothing of keep the installer's defaults. */
    choices?: string[];
    /** The folder of the file to install as the mod's Data, skipping any installer; '' is the top. */
    root?: string;
    /** Replace the files of a mod of the same name. */
    replace?: boolean;
}

/** The first answer for a FOMOD installer: what it asks. Nothing was written. */
export interface InstallModQuestions {
    status: 'chooseOptions';
    /** The name the mod will get. */
    mod: string;
    file: string;
    installer: InstallerQuestions;
    nextStep: string;
}

export interface InstallModResult {
    mod: string;
    modFolder: string;
    /** The downloaded file it came from. */
    file: string;
    /** How many files the mod got. */
    files: number;
    /** `fomod` when its FOMOD installer chose the files, `none` when a folder of the file is the mod. */
    installer: 'fomod' | 'none';
    /** The folder of the file installed as Data; '' is its top. */
    root?: string;
    /** What the FOMOD installer installed, step by step — defaults included. */
    chosen?: { step: string; group: string; options: string[] }[];
    /** Choices in steps the other choices left hidden, which installed nothing. */
    ignoredChoices?: string[];
    /** The mod's plugins, in the order they now load. */
    plugins: string[];
    /** Plugins put before an active plugin that needs them as a master, instead of at the end of the load order. */
    placedBefore?: { plugin: string; before: string }[];
    /** Plugins needing masters the load order lacks: the game will not start until those are installed. */
    missingMasters?: { plugin: string; masters: string[] }[];
    warnings?: string[];
    /** Set when a mod of the same name was replaced. */
    replaced?: true;
    /** The Nexus mod and file, from the download's record. */
    nexus?: { modId: number; fileId?: number; version?: string };
    profile: { name: string } & ModEnabled;
    modManager: ModManagerNotice;
}

export interface DisableModRequest {
    /** The mod's name as listMods shows it; a name differing only in letter case finds it too. */
    mod: string;
}

export interface DisableModResult {
    /** The mod's name as the mod manager has it. */
    mod: string;
    /** Set when the mod was disabled already, and nothing changed. */
    note?: string;
    /** Its plugins the game still loads, because another enabled mod, overwrite or the game has the same file. */
    keptActive?: { plugin: string; loadedFrom: string }[];
    /** Active plugins needing a plugin taken out: the game will not start until their mods are disabled too. */
    missingMasters?: { plugin: string; mod: string; masters: string[] }[];
    warnings?: string[];
    profile: { name: string } & ModDisabled;
    /** What the mod manager was told; absent when nothing changed. */
    modManager?: ModManagerNotice;
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
    /** Where a record's file goes, in full paths, and the group folders' names. */
    writeRecordsTo: string;
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

export interface EditRecordRequest {
    project: string;
    /** The record file: its path in the plugin folder (`Weapons/FlameBlade.yaml`), its file name, or the record's EditorID. */
    record: string;
    /** Fields by path — `Data.Damage`, `Name`, `Effects[0].Data.Magnitude` — and the value each takes. */
    set?: Record<string, unknown>;
    /** Paths of fields, or of a list's items, to delete. */
    remove?: string[];
}

export interface EditRecordResult {
    /** The full path of the file changed. */
    file: string;
    /** Each change, as `set Data.Damage: 7 → 12`. */
    changed: string[];
    /** The file's text after the change. */
    text: string;
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
    /**
     * What the build wrote into the files where a fix had one right answer — escapes copied out of a JSON answer, a
     * FormKey copied into a new record from the record read, past a light plugin's last FormID or shared by two files no
     * build gave it to, a line written twice the same, an EditorID taken from the file's name or written with its letters alone, a field moved to the one place its record has it or taken out
     * where that place says the same, a magic effect's Data moved into the one Effects item that names it or taken out where that item has the same
     * — each with its file's full path and what was changed.
     */
    corrected?: string[];
    records: number;
    masters: string[];
    headerVersion: number;
    /** New records that got their FormID in this build, each with the full path of its file. */
    assignedFormIds: { formId: string; editorId: string | null; file: string }[];
    /**
     * Links written by editor ID and the FormID each names — `from` as written, `to` the FormID — each with the full
     * path of its file. The files keep the editor IDs; links.lock.json beside the plugin folder keeps what each link to
     * the load order named, and the next build keeps to it.
     */
    resolvedLinks: { file: string; field: string; from: string; to: string }[];
    scripts: { compiled: number };
    /** What did not stop the build but was not built: record files outside the plugin folder. */
    warnings?: string[];
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
    /** With `notFound`: how to search what was not found — by `text`, which also reads in-game names. */
    nextStep?: string;
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
    /** The file's name as it downloads; Nexus does not say it for newer uploads. */
    fileName?: string;
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
