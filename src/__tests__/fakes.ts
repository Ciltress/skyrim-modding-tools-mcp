import { SessionExpiredError } from '../backend/Backend';
import type { HealthReport } from '../backend/Backend';
import type { AppBackend } from '../backend/index';
import { HelperError } from '../backend/skyrim/helperClient';
import { NexusError } from '../backend/skyrim/nexus';
import { ProjectError } from '../backend/skyrim/projects';
import type {
    AddPatchRequest, AddPatchResult, BuildResult, ProjectFile, DeployResult, NewProjectRequest, NexusDownload, NexusMod, NexusModSummary,
    NexusSearchQuery, NexusSearchResult, ProjectInfo, PullResult, RecordQuery, RecordRequest, RecordSearchResult,
    RecordSummary, RecordVersions
} from '../backend/skyrim/SkyrimBackend';

/**
 * Test doubles shared by the suites. Not a test file itself — vitest only runs `*.test.ts`.
 *
 * `recordingBackend` records every domain call and can fail all of them; `fakeBackend` counts
 * connects and can fail on demand. Both sit on InMemorySkyrimBackend, which keeps a few records and
 * projects in memory and answers the way the real backend does — including its errors.
 */

/**
 * What every generated string argument becomes in the contract suite. It is the editor ID of a
 * record and the name of a project that exist, built and deployed — so every tool has a success path
 * to be held to, not only a not-found.
 */
export const SAMPLE = 'sample';

const RECORDS: RecordSummary[] = [
    {
        formId: '000800:Sample.esp', editorId: SAMPLE, name: 'Sample Sword', signature: 'WEAP', type: 'Weapon',
        definedIn: 'Sample.esp', winner: 'Sample.esp', overrides: 0
    },
    {
        formId: '012EB7:Skyrim.esm', editorId: 'IronSword', name: 'Iron Sword', signature: 'WEAP', type: 'Weapon',
        definedIn: 'Skyrim.esm', winner: 'Update.esm', overrides: 1
    }
];

interface FakeProject {
    plugin: string;
    light: boolean;
    records: Set<string>;
    built: boolean;
    deployed: boolean;
}

export class InMemorySkyrimBackend implements AppBackend {
    readonly projects = new Map<string, FakeProject>([
        [SAMPLE, { plugin: SAMPLE, light: true, records: new Set(), built: true, deployed: true }]
    ]);

    describe() { return 'the fake Mod Organizer instance'; }
    get connected() { return true; }
    async connect() { }
    isSessionExpired(error: unknown) { return error instanceof SessionExpiredError; }
    async capabilities() { return undefined; }

    private find(id: string): RecordSummary | undefined {
        const key = id.toLowerCase();
        return RECORDS.find(r => r.formId.toLowerCase() === key || r.editorId?.toLowerCase() === key);
    }

    private resolve(id: string): RecordSummary {
        const record = this.find(id);
        if (!record) throw new HelperError('notFound', `No record with editor ID '${id}' in the load order. Search with findRecords.`);
        return record;
    }

    async findRecords(query: RecordQuery): Promise<RecordSearchResult> {
        let matches: RecordSummary[];
        const notFound: string[] = [];
        if (query.records) {
            matches = [];
            for (const id of query.records) {
                const record = this.find(id);
                if (record) matches.push(record); else notFound.push(id);
            }
        } else {
            const text = (query.text ?? '').toLowerCase();
            matches = RECORDS.filter(r => !text || r.editorId?.toLowerCase().includes(text) || r.name?.toLowerCase().includes(text));
        }
        if (query.types) matches = matches.filter(r => query.types!.some(t => t === r.signature || t === r.type || t === SAMPLE));
        return {
            total: matches.length,
            records: matches.slice(0, query.limit),
            ...(notFound.length ? { notFound } : {})
        };
    }

    async readRecord(request: RecordRequest): Promise<RecordVersions> {
        const record = this.resolve(request.record);
        const file = { pathInPluginFolder: `Weapons/${record.editorId} - ${record.formId.replace(':', '_')}.yaml`, text: `FormKey: ${record.formId}\n` };
        return {
            formId: record.formId, editorId: record.editorId, type: record.type, signature: record.signature,
            definedIn: record.definedIn, winner: record.winner, plugins: [record.definedIn],
            versions: [{ plugin: record.winner, winning: true, files: [file] }]
        };
    }

    private info(name: string, created: boolean): ProjectInfo {
        const project = this.projects.get(name)!;
        return { project: name, plugin: project.plugin, light: project.light, path: `projects/${name}`, pluginFolder: `projects/${name}/plugin`, created };
    }

    private existing(name: string): FakeProject {
        const project = this.projects.get(name);
        if (!project) throw new ProjectError(`There is no project '${name}'. Create it with newProject or addPatch.`);
        return project;
    }

    async newProject(request: NewProjectRequest): Promise<ProjectInfo> {
        const existing = this.projects.get(request.project);
        if (existing) {
            if (request.plugin && request.plugin !== existing.plugin) {
                throw new ProjectError(`The project '${request.project}' already exists, with the plugin ${existing.plugin}.`);
            }
            return this.info(request.project, false);
        }
        this.projects.set(request.project, {
            plugin: request.plugin ?? `${request.project}.esp`, light: request.light ?? true, records: new Set(), built: false, deployed: false
        });
        return this.info(request.project, true);
    }

    async addPatch(request: AddPatchRequest): Promise<AddPatchResult> {
        let created = false;
        if (!this.projects.has(request.project)) {
            await this.newProject({ project: request.project, plugin: request.plugin });
            created = true;
        }
        const project = this.projects.get(request.project)!;
        const result: Omit<AddPatchResult, 'project'> = { added: [], alreadyInProject: [] };
        for (const id of request.records) {
            const record = this.resolve(id);
            if (project.records.has(record.formId)) {
                result.alreadyInProject.push({ formId: record.formId, files: [this.copiedFile(request.project, record)] });
            } else {
                project.records.add(record.formId);
                result.added.push({ formId: record.formId, editorId: record.editorId, type: record.type, from: request.from ?? record.winner, files: [this.copiedFile(request.project, record)] });
            }
        }
        return { project: this.info(request.project, created), ...result };
    }

    private copiedFile(project: string, record: RecordSummary): ProjectFile {
        return { path: `projects/${project}/plugin/Weapons/${record.formId.replace(':', '_')}.yaml`, text: `FormKey: ${record.formId}\n` };
    }

    async buildProject(name: string): Promise<BuildResult> {
        const project = this.existing(name);
        project.built = true;
        return {
            project: name, plugin: project.plugin, output: `projects/${name}/build/${project.plugin}`,
            records: project.records.size, masters: ['Skyrim.esm'], headerVersion: 1.71, assignedFormIds: [], scripts: { compiled: 0 }
        };
    }

    async deployProject(name: string): Promise<DeployResult> {
        const project = this.existing(name);
        if (!project.built) throw new ProjectError(`'${name}' has not been built yet: run buildProject first.`);
        project.deployed = true;
        return {
            project: name, plugin: project.plugin, modFolder: `mods/${name}`, files: 1,
            profile: { name: 'Default', modEnabled: false, pluginActive: false, addedToLoadOrder: false },
            modManager: { manager: 'mo2', status: 'notRunning' }
        };
    }

    async pullProject(name: string): Promise<PullResult> {
        const project = this.existing(name);
        if (!project.deployed) throw new ProjectError(`There is no deployed ${project.plugin} to pull from: deploy the project first.`);
        return { project: name, plugin: project.plugin, source: `mods/${name}/${project.plugin}`, added: [], changed: [], removed: [] };
    }

    async searchNexus(query: NexusSearchQuery): Promise<NexusSearchResult> {
        const mods = [NEXUS_MOD].filter(mod => !query.text || mod.name.toLowerCase().includes(query.text.toLowerCase()));
        return { total: mods.length, mods: mods.slice(0, query.limit) };
    }

    /** Mod 1 exists — the number the contract suite generates — and nothing else. */
    async readNexusMod(modId: number): Promise<NexusMod> {
        if (modId !== NEXUS_MOD.modId) throw new NexusError('notFound', `No Nexus mod ${modId} for Skyrim Special Edition. Find it with searchNexus.`);
        return { ...NEXUS_MOD, uploader: 'someone', description: 'A sample mod.', requirements: [], dlcRequirements: [], files: [], olderFiles: 0 };
    }

    /** File 1 of mod 1, and nothing else. */
    async downloadNexusFile(modId: number, fileId: number): Promise<NexusDownload> {
        if (modId !== NEXUS_MOD.modId || fileId !== 1) throw new NexusError('notFound', `Nexus mod ${modId} has no file ${fileId}. Take modId and fileId from readNexusMod's files.`);
        return {
            path: 'downloads/Sample Mod-1-1-0.zip', modId, fileId, modName: NEXUS_MOD.name, name: 'Sample Mod', version: '1.0',
            category: 'main', sizeBytes: 1024
        };
    }
}

const NEXUS_MOD: NexusModSummary = {
    modId: 1, name: 'Sample Mod', version: '1.0', author: 'someone', category: 'Gameplay', summary: 'A sample.',
    endorsements: 0, downloads: 0, updated: '2026-10-15', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/1'
};

/** Members of the backend that are its lifecycle rather than its domain. */
const LIFECYCLE = new Set([
    'describe', 'connected', 'connect', 'isSessionExpired', 'capabilities', 'health',
    // Must not look like a promise, or awaiting the backend would hang.
    'then', 'catch', 'finally'
]);

/**
 * A real in-memory backend behind a recording proxy: every domain call is
 * captured, and with `fail` every one of them throws a plain Error — the shape
 * an HTTP client's failure usually has.
 */
export function recordingBackend(options: { fail?: boolean } = {}) {
    const calls: { method: string; args: any[] }[] = [];
    const real = new InMemorySkyrimBackend();

    const backend = new Proxy(real, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || LIFECYCLE.has(property) || typeof value !== 'function') {
                return value;
            }
            return async (...args: any[]) => {
                calls.push({ method: property, args });
                if (options.fail) throw new Error(`simulated backend failure in ${property}`);
                return value.apply(target, args);
            };
        }
    }) as unknown as AppBackend;

    return { backend, calls };
}

export interface FakeBackendOptions {
    /** What capabilities() answers, or does. Defaults to undefined: nothing to gate. */
    capabilities?: () => Promise<readonly string[] | undefined>;
    /** Fails the next N domain calls with this error, then succeeds. */
    failWith?: { error: unknown; times: number };
    /** connect() throws this, every time. */
    connectError?: unknown;
    /** The health probe. Absent by default, as on a backend that has none. */
    health?: () => Promise<HealthReport>;
}

const DOMAIN_METHODS = [
    'findRecords', 'readRecord', 'newProject', 'addPatch', 'buildProject', 'deployProject', 'pullProject',
    'searchNexus', 'readNexusMod', 'downloadNexusFile'
] as const;

/**
 * A backend whose lifecycle a test controls: it counts connects and capability
 * reads, starts disconnected so the first tool call has to connect, and can be
 * made to fail its domain calls N times — which is how the retry is exercised.
 */
export function fakeBackend(options: FakeBackendOptions = {}) {
    let connects = 0;
    let capabilityReads = 0;
    let connected = false;
    let remaining = options.failWith?.times ?? 0;
    const calls: string[] = [];
    const real = new InMemorySkyrimBackend();

    const domain = Object.fromEntries(DOMAIN_METHODS.map(name => [name, async (...args: any[]) => {
        calls.push(name);
        if (remaining > 0) {
            remaining--;
            // A session the backend dropped really is not connected any more.
            if (options.failWith!.error instanceof SessionExpiredError) connected = false;
            throw options.failWith!.error;
        }
        return (real[name] as (...a: any[]) => any).apply(real, args);
    }]));

    const backend = {
        describe: () => 'the fake Mod Organizer instance',
        get connected() { return connected; },
        async connect() {
            connects++;
            if (options.connectError) throw options.connectError;
            connected = true;
        },
        isSessionExpired: (error: unknown) => error instanceof SessionExpiredError,
        async capabilities() {
            capabilityReads++;
            return options.capabilities ? options.capabilities() : undefined;
        },
        ...(options.health ? { health: options.health } : {}),
        ...domain
    } as unknown as AppBackend;

    return {
        backend,
        calls,
        connects: () => connects,
        capabilityReads: () => capabilityReads
    };
}
