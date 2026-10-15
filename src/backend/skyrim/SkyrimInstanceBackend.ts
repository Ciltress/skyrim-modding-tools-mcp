import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermanentBackendError, SessionExpiredError } from '../Backend.js';
import type { HealthReport } from '../Backend.js';
import { compileScripts, hasUncommittedChanges } from './externalTools.js';
import { HelperError, HelperUnavailableError } from './helperClient.js';
import {
    ProjectError, assignFormIds, createProject, fileHash, newestSourceTime, projectExists,
    projectInfo, projectPaths, readDeployState, readProjectHeader, syncFolder, syncYaml, writeDeployState
} from './projects.js';
import type { SkyrimEngine } from './engine.js';
import type {
    AddPatchRequest, AddPatchResult, BuildResult, DeployResult, NewProjectRequest, ProjectFile, ProjectInfo, PullResult,
    RecordQuery, RecordRequest, RecordSearchResult, RecordVersion, RecordVersions, SkyrimBackend
} from './SkyrimBackend.js';

/** What the helper's addOverrides answers: files relative to the project's plugin folder. */
interface CopiedRecords {
    added: { formId: string; editorId: string | null; type: string; from: string; files: string[] }[];
    alreadyInProject: { formId: string; file: string }[];
}

export interface SkyrimInstanceBackendOptions {
    engine: SkyrimEngine;
    /** The caller's bearer token, in HTTP mode. */
    credential?: string;
    /** Tokens HTTP callers may present. Undefined in stdio mode, where nothing is checked. */
    acceptedCredentials?: readonly string[];
}

/**
 * The backend one server talks to: a thin layer over the shared SkyrimEngine, which holds the
 * instance — through its mod manager — and the plugin helper. Per session it only adds the
 * credential check. Nothing here knows which mod manager it is (docs/adr/0007).
 *
 * `connect()` is the credential check and nothing else — it starts the engine in the background but
 * does not wait for it. An instance that cannot be read, or a helper that is not built, is not a
 * refused credential: it surfaces on the first tool call and in healthcheck with its own cause, and
 * is checked again on every call rather than latched.
 */
export class SkyrimInstanceBackend implements SkyrimBackend {
    private accepted = false;

    constructor(private readonly options: SkyrimInstanceBackendOptions) { }

    private get engine(): SkyrimEngine {
        return this.options.engine;
    }

    describe(): string {
        return this.engine.modManager.describe();
    }

    get connected(): boolean {
        return this.accepted;
    }

    async connect(): Promise<void> {
        const { acceptedCredentials, credential } = this.options;
        if (acceptedCredentials !== undefined && !matchesAny(credential, acceptedCredentials)) {
            throw new PermanentBackendError(
                'The bearer token was refused. Use one of the tokens in SKYRIM_ACCEPTED_TOKENS.');
        }
        this.accepted = true;
        if (!this.engine.ready) this.engine.warmUp();
    }

    isSessionExpired(error: unknown): boolean {
        return error instanceof SessionExpiredError;
    }

    /** Nothing is gated yet: every tool works against any instance this server can open. */
    async capabilities(): Promise<readonly string[] | undefined> {
        return undefined;
    }

    async health(): Promise<HealthReport> {
        let instance;
        try {
            instance = this.engine.modManager.readInstance();
        } catch (error) {
            return { ok: false, summary: (error as Error).message };
        }
        const engine = this.engine;
        const helper = engine.ready
            ? { running: true, version: engine.helperVersion }
            : { running: false };
        const missing = engine.missingPlugins.length;
        const failed = !engine.ready && engine.startError !== undefined;
        const notes = engine.modManager.notes(instance);
        return {
            // Still starting is not a fault: the instance is readable, and the helper is on its way.
            ok: !failed && missing === 0,
            summary: failed
                ? `The plugin helper could not start: ${engine.startError}`
                : !engine.ready
                ? `The instance is readable; the plugin helper is starting, or starts with the first tool call.`
                : missing > 0
                    ? `${missing} active plugin(s) have no file in the game or any enabled mod: ${engine.missingPlugins.slice(0, 5).join(', ')}.`
                    : `Profile '${instance.profile}': ${engine.activePlugins} active plugins, game ${engine.gameVersion}.`,
            modManager: engine.modManager.name,
            instance: engine.modManager.location,
            profile: instance.profile,
            ...(notes.length > 0 ? { notes } : {}),
            game: { dir: instance.gameDir, edition: instance.edition, version: engine.gameVersion ?? null },
            plugins: { active: engine.activePlugins, missing: engine.missingPlugins },
            helper
        };
    }

    async findRecords(query: RecordQuery): Promise<RecordSearchResult> {
        await this.engine.ensureFresh();
        return this.engine.helper.call('findRecords', { ...query });
    }

    async readRecord(request: RecordRequest): Promise<RecordVersions> {
        await this.engine.ensureFresh();
        // The helper says `path`, relative to a plugin folder; here that name is kept for full paths.
        type HelperVersions = Omit<RecordVersions, 'versions'> & {
            versions: (Omit<RecordVersion, 'files'> & { files: { path: string; text: string }[] })[];
        };
        const read = await this.engine.helper.call<HelperVersions>('readRecord', { ...request });
        return {
            ...read,
            versions: read.versions.map(version => ({
                ...version,
                files: version.files.map(file => ({ pathInPluginFolder: file.path, text: file.text }))
            }))
        };
    }

    // ---------------------------------------------------------------- projects

    /** An existing project is returned as it is (`created: false`) — unless it was asked for under another plugin name. */
    async newProject(request: NewProjectRequest): Promise<ProjectInfo> {
        const paths = projectPaths(this.engine.projectsDir, request.project);
        if (projectExists(paths)) {
            const existing = projectInfo(request.project, paths, false);
            if (request.plugin && request.plugin.toLowerCase() !== existing.plugin.toLowerCase()) {
                throw new ProjectError(
                    `The project '${request.project}' already exists, with the plugin ${existing.plugin}. Choose another project name.`);
            }
            return existing;
        }
        prepareProjectsFolder(this.engine.projectsDir);
        createProject(paths, request.plugin ?? `${request.project}.esp`, request.light ?? true);
        return projectInfo(request.project, paths, true);
    }

    async addPatch(request: AddPatchRequest): Promise<AddPatchResult> {
        await this.engine.ensureFresh();
        const paths = projectPaths(this.engine.projectsDir, request.project);
        let created = false;
        if (!projectExists(paths)) {
            prepareProjectsFolder(this.engine.projectsDir);
            createProject(paths, request.plugin ?? `${request.project}.esp`, true);
            created = true;
        }
        const { plugin } = readProjectHeader(paths);
        const copied = await afterLocalWrites(this.engine.helper.call<CopiedRecords>('addOverrides', {
            plugin,
            projectPluginDir: paths.plugin,
            records: request.records,
            from: request.from
        }));
        // Full paths, and the text to edit: given paths relative to the plugin folder, models joined
        // them to the project folder; given no text, they spent a call reading it. The text stops
        // short of what the response budget would withhold — a patch of fifty leveled lists is fine.
        let textBytes = 0;
        let leftOut = 0;
        const projectFile = (file: string): ProjectFile => {
            const full = path.resolve(paths.plugin, file);
            const text = fs.readFileSync(full, 'utf8');
            textBytes += Buffer.byteLength(text);
            if (textBytes > PATCH_TEXT_BYTES) {
                leftOut++;
                return { path: full };
            }
            return { path: full, text };
        };
        const result: AddPatchResult = {
            project: projectInfo(request.project, paths, created),
            added: copied.added.map(record => ({ ...record, files: record.files.map(projectFile) })),
            alreadyInProject: copied.alreadyInProject.map(record => ({ formId: record.formId, files: [projectFile(record.file)] }))
        };
        if (leftOut > 0) {
            result.textLeftOut = `The text of ${leftOut} file${leftOut === 1 ? '' : 's'} is left out to keep this answer ` +
                `small: read ${leftOut === 1 ? 'it at its path' : 'each at its path'} before editing.`;
        }
        return result;
    }

    async buildProject(project: string): Promise<BuildResult> {
        await this.engine.ensureFresh();
        const paths = projectPaths(this.engine.projectsDir, project);
        const { plugin, light } = readProjectHeader(paths);

        const assignedFormIds = assignFormIds(paths.plugin, plugin, light);
        // Every build starts from nothing, so a script deleted from the project leaves no .pex behind.
        // The plugin is written last: a build that fails on the way leaves no plugin, and deploy refuses.
        fs.rmSync(paths.build, { recursive: true, force: true });

        const instance = this.engine.modManager.readInstance();
        const compiled = await compileScripts({
            platform: this.engine.platform,
            compiler: this.engine.papyrusCompiler,
            creationKitDir: this.engine.creationKitDir,
            scriptsDir: paths.scripts,
            outputDir: path.join(paths.build, 'Scripts'),
            instance,
            mods: this.engine.modManager.readModList(instance)
        });

        const output = path.join(paths.build, plugin);
        const built = await afterLocalWrites(this.engine.helper.call<{ records: number; masters: string[]; headerVersion: number }>('build', {
            projectPluginDir: paths.plugin,
            outputPath: output,
            headerVersion: this.engine.headerVersion
        }, BUILD_TIMEOUT_MS));

        return {
            project, plugin, output,
            records: built.records,
            masters: built.masters,
            headerVersion: built.headerVersion,
            assignedFormIds: assignedFormIds.map(record => ({ ...record, file: path.resolve(paths.plugin, record.file) })),
            scripts: { compiled }
        };
    }

    async deployProject(project: string): Promise<DeployResult> {
        const modManager = this.engine.modManager;
        const instance = modManager.readInstance();
        const paths = projectPaths(this.engine.projectsDir, project);
        const { plugin } = readProjectHeader(paths);
        const output = path.join(paths.build, plugin);

        if (!fs.existsSync(output)) {
            throw new ProjectError(`'${project}' has not been built yet: run buildProject first.`);
        }
        if (newestSourceTime(paths) > fs.statSync(output).mtimeMs) {
            throw new ProjectError(`'${project}' changed since its last build: run buildProject, then deploy.`);
        }

        const modFolder = path.join(instance.modsDir, project);
        const deployed = path.join(modFolder, plugin);
        // A copy that outranks the mod — Mod Organizer's overwrite — is the one the game loads, and the one to guard.
        const shadowing = modManager.shadowingCopies(instance, project, plugin).filter(file => fs.existsSync(file));
        const live = shadowing[0] ?? deployed;
        const state = readDeployState(paths);
        if (!state && fs.existsSync(modFolder) && fs.readdirSync(modFolder).some(f => f.toLowerCase() !== 'meta.ini')) {
            throw new ProjectError(
                `A mod named '${project}' already exists in the instance and was not deployed from this project. ` +
                `Rename the project, or remove that mod in the mod manager first.`);
        }
        if (!state && shadowing.length > 0) {
            throw new ProjectError(
                `A ${plugin} at '${shadowing[0]}' would hide this deploy from the game. If it is this project's work, ` +
                `run pullProject first; otherwise move it away in the mod manager.`);
        }
        if (state && fs.existsSync(live) && fileHash(live) !== state.pluginHash) {
            throw new ProjectError(
                `The deployed ${plugin}${live === deployed ? '' : ` (the copy at '${live}')`} changed since the last ` +
                `deploy — saved in the Creation Kit or xEdit? Run pullProject to bring those changes into the project ` +
                `first; deploying now would overwrite them.`);
        }

        // The mod folder becomes the build plus the assets, so files removed from the project go too —
        // all but the mod manager's own meta.ini.
        const files = syncFolder([paths.assets, paths.build], modFolder, name => name.toLowerCase() === 'meta.ini');
        // Guarded above: a shadowing copy that got this far was pulled, so the project holds its work.
        for (const copy of shadowing) fs.rmSync(copy);

        const profileChange = modManager.enable(instance, project, plugin);
        const notice = await modManager.afterDeploy(instance);
        writeDeployState(paths, { modFolder, plugin, pluginHash: fileHash(deployed), at: new Date().toISOString() });

        return {
            project, plugin, modFolder, files,
            ...(shadowing.length > 0 ? { removedCopies: shadowing } : {}),
            profile: { name: instance.profile, ...profileChange },
            modManager: notice
        };
    }

    async pullProject(project: string): Promise<PullResult> {
        await this.engine.ensureFresh();
        const instance = this.engine.modManager.readInstance();
        const paths = projectPaths(this.engine.projectsDir, project);
        const { plugin } = readProjectHeader(paths);

        // The Creation Kit writes a plugin it edits back to its mod, but one it saves anew can land
        // elsewhere — in Mod Organizer, in overwrite. The newest copy is the latest work.
        const deployed = path.join(instance.modsDir, project, plugin);
        const candidates = [deployed, ...this.engine.modManager.shadowingCopies(instance, project, plugin)].filter(file => fs.existsSync(file));
        if (candidates.length === 0) {
            throw new ProjectError(`There is no deployed ${plugin} to pull from: deploy the project first.`);
        }
        const source = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

        const dirty = await hasUncommittedChanges(paths.root);
        if (dirty) {
            throw new ProjectError(
                `'${project}' has uncommitted changes. Commit them first, so what the pull changes shows up on its own in ` +
                `git diff and can be undone.`);
        }

        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-pull-'));
        try {
            await this.engine.helper.call('serialize', { pluginPath: source, outputDir: scratch }, BUILD_TIMEOUT_MS);
            const changes = syncYaml(scratch, paths.plugin);
            writeDeployState(paths, {
                modFolder: path.join(instance.modsDir, project),
                plugin,
                pluginHash: fileHash(source),
                at: new Date().toISOString()
            });
            const inPlugin = (files: string[]) => files.map(file => path.resolve(paths.plugin, file));
            return {
                project, plugin, source,
                added: inPlugin(changes.added),
                changed: inPlugin(changes.changed),
                removed: inPlugin(changes.removed),
                ...(dirty === undefined
                    ? { warning: 'git could not check the project folder for uncommitted changes, so nothing guarded them.' }
                    : {})
            };
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }
}

/** Builds and pulls of big plugins take a while; the helper's default timeout is for lookups. */
const BUILD_TIMEOUT_MS = 600_000;

/**
 * How much copied text one addPatch answer carries: about ten records, and well inside the smallest
 * response budget (responseBudget.ts), which would otherwise withhold the whole answer.
 */
const PATCH_TEXT_BYTES = 16_000;

/**
 * A helper call made after this tool call already wrote files — a created project, assigned FormIDs.
 * "The helper was not running" normally means nothing happened, and the server retries; here something
 * did, and a retry would report it wrongly, so the failure is reported as it is instead.
 */
function afterLocalWrites<T>(call: Promise<T>): Promise<T> {
    return call.catch(error => {
        if (!(error instanceof HelperUnavailableError)) throw error;
        throw new HelperError('helperUnavailable',
            `${error.message} This call had already written to the project; check it before repeating the call.`);
    });
}

/**
 * The projects folder's own git rules, written once: build output and deploy state stay out of git,
 * binary assets go to Git LFS (docs/adr/0004).
 */
function prepareProjectsFolder(projectsDir: string): void {
    fs.mkdirSync(projectsDir, { recursive: true });
    const ignore = path.join(projectsDir, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# What a build produces, and what was deployed last.\n*/build/\n*/.deploy.json\n');
    const attributes = path.join(projectsDir, '.gitattributes');
    if (!fs.existsSync(attributes)) {
        const binary = ['nif', 'dds', 'tga', 'png', 'hkx', 'wav', 'xwm', 'fuz', 'lip', 'bsa', 'swf', 'pex', 'esp', 'esm', 'esl'];
        fs.writeFileSync(attributes,
            '# Binary assets live in Git LFS. Run `git lfs install` once per machine.\n' +
            binary.map(ext => `*.${ext} filter=lfs diff=lfs merge=lfs -text`).join('\n') + '\n');
    }
}

function matchesAny(credential: string | undefined, accepted: readonly string[]): boolean {
    if (!credential) return false;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    const given = digest(credential);
    return accepted.some(candidate => timingSafeEqual(given, digest(candidate)));
}
