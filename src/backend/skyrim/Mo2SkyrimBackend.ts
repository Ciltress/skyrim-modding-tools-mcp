import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermanentBackendError, SessionExpiredError } from '../Backend.js';
import type { HealthReport } from '../Backend.js';
import { readInstance, readModList, type Mo2Instance } from './mo2.js';
import { activatePlugin, enableMod, refreshIfRunning } from './mo2Profile.js';
import { compileScripts, hasUncommittedChanges } from './externalTools.js';
import { HelperError, HelperUnavailableError } from './helperClient.js';
import {
    ProjectError, assignFormIds, copyTree, createProject, fileHash, newestSourceTime, projectExists,
    projectInfo, projectPaths, readDeployState, readProjectHeader, syncYaml, writeDeployState
} from './projects.js';
import type { SkyrimEngine } from './engine.js';
import type {
    AddPatchRequest, AddPatchResult, BuildResult, DeployResult, NewProjectRequest, ProjectInfo, PullResult,
    RecordQuery, RecordRequest, RecordSearchResult, RecordVersions, SkyrimBackend
} from './SkyrimBackend.js';

export interface Mo2SkyrimBackendOptions {
    engine: SkyrimEngine;
    /** The caller's bearer token, in HTTP mode. */
    credential?: string;
    /** Tokens HTTP callers may present. Undefined in stdio mode, where nothing is checked. */
    acceptedCredentials?: readonly string[];
    /** Tells a running Mod Organizer to re-read its profile. Replaced in tests, which have none running. */
    refreshModOrganizer?: (instance: Mo2Instance) => Promise<DeployResult['modOrganizer']>;
}

/**
 * The backend one server talks to: a thin layer over the shared SkyrimEngine, which holds
 * the MO2 instance and the plugin helper. Per session it only adds the credential check.
 *
 * `connect()` is the credential check and nothing else — it starts the engine in the background but
 * does not wait for it. An instance that cannot be read, or a helper that is not built, is not a
 * refused credential: it surfaces on the first tool call and in healthcheck with its own cause, and
 * is checked again on every call rather than latched.
 */
export class Mo2SkyrimBackend implements SkyrimBackend {
    private accepted = false;

    constructor(private readonly options: Mo2SkyrimBackendOptions) { }

    private get engine(): SkyrimEngine {
        return this.options.engine;
    }

    describe(): string {
        return `the Mod Organizer instance at ${this.engine.instanceDir}`;
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
            instance = readInstance(this.engine.instanceDir);
        } catch (error) {
            return { ok: false, summary: (error as Error).message };
        }
        const engine = this.engine;
        const helper = engine.ready
            ? { running: true, version: engine.helperVersion }
            : { running: false };
        const missing = engine.missingPlugins.length;
        const failed = !engine.ready && engine.startError !== undefined;
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
            instance: engine.instanceDir,
            profile: instance.profile,
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
        return this.engine.helper.call('readRecord', { ...request });
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
        const copied = await afterLocalWrites(this.engine.helper.call<Omit<AddPatchResult, 'project'>>('addOverrides', {
            plugin,
            projectPluginDir: paths.plugin,
            records: request.records,
            from: request.from
        }));
        return { project: projectInfo(request.project, paths, created), ...copied };
    }

    async buildProject(project: string): Promise<BuildResult> {
        await this.engine.ensureFresh();
        const paths = projectPaths(this.engine.projectsDir, project);
        const { plugin, light } = readProjectHeader(paths);

        const assignedFormIds = assignFormIds(paths.plugin, plugin, light);
        // Every build starts from nothing, so a script deleted from the project leaves no .pex behind.
        // The plugin is written last: a build that fails on the way leaves no plugin, and deploy refuses.
        fs.rmSync(paths.build, { recursive: true, force: true });

        const instance = readInstance(this.engine.instanceDir);
        const compiled = await compileScripts({
            platform: this.engine.platform,
            compiler: this.engine.papyrusCompiler,
            creationKitDir: this.engine.creationKitDir,
            scriptsDir: paths.scripts,
            outputDir: path.join(paths.build, 'Scripts'),
            instance,
            mods: readModList(instance)
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
            assignedFormIds,
            scripts: { compiled }
        };
    }

    async deployProject(project: string): Promise<DeployResult> {
        const instance = readInstance(this.engine.instanceDir);
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
        // A copy in overwrite outranks the mod: it is the one the game loads, and the one to guard.
        const inOverwrite = path.join(instance.overwriteDir, plugin);
        const overwriteCopy = fs.existsSync(inOverwrite);
        const live = overwriteCopy ? inOverwrite : deployed;
        const state = readDeployState(paths);
        if (!state && fs.existsSync(modFolder) && fs.readdirSync(modFolder).some(f => f.toLowerCase() !== 'meta.ini')) {
            throw new ProjectError(
                `A mod named '${project}' already exists in the instance and was not deployed from this project. ` +
                `Rename the project, or remove that mod in Mod Organizer first.`);
        }
        if (!state && overwriteCopy) {
            throw new ProjectError(
                `Mod Organizer's overwrite folder holds a ${plugin}, which would hide this deploy from the game. ` +
                `If it is this project's work, run pullProject first; otherwise move it out of overwrite in Mod Organizer.`);
        }
        if (state && fs.existsSync(live) && fileHash(live) !== state.pluginHash) {
            throw new ProjectError(
                `The deployed ${plugin}${overwriteCopy ? ' (the copy in overwrite)' : ''} changed since the last deploy — ` +
                `saved in the Creation Kit or xEdit? Run pullProject to bring those changes into the project first; ` +
                `deploying now would overwrite them.`);
        }

        // Everything but Mod Organizer's own meta.ini is replaced, so files removed from the project go too.
        if (fs.existsSync(modFolder)) {
            for (const entry of fs.readdirSync(modFolder)) {
                if (entry.toLowerCase() !== 'meta.ini') fs.rmSync(path.join(modFolder, entry), { recursive: true, force: true });
            }
        }
        const files = copyTree(paths.build, modFolder) + copyTree(paths.assets, modFolder);
        // Guarded above: an overwrite copy that got this far was pulled, so the project holds its work.
        if (overwriteCopy) fs.rmSync(inOverwrite);

        const modEnabled = enableMod(instance, project);
        const { pluginActive, addedToLoadOrder } = activatePlugin(instance, plugin);
        const modOrganizer = await (this.options.refreshModOrganizer ?? (i => refreshIfRunning(i, this.engine.platform)))(instance);
        writeDeployState(paths, { modFolder, plugin, pluginHash: fileHash(deployed), at: new Date().toISOString() });

        return {
            project, plugin, modFolder, files,
            ...(overwriteCopy ? { removedFromOverwrite: inOverwrite } : {}),
            profile: { name: instance.profile, modEnabled, pluginActive, addedToLoadOrder },
            modOrganizer
        };
    }

    async pullProject(project: string): Promise<PullResult> {
        await this.engine.ensureFresh();
        const instance = readInstance(this.engine.instanceDir);
        const paths = projectPaths(this.engine.projectsDir, project);
        const { plugin } = readProjectHeader(paths);

        // The Creation Kit writes a plugin it edits back to its mod, but a plugin it saves anew lands in overwrite.
        const deployed = path.join(instance.modsDir, project, plugin);
        const inOverwrite = path.join(instance.overwriteDir, plugin);
        const candidates = [deployed, inOverwrite].filter(file => fs.existsSync(file));
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
            return {
                project, plugin, source, ...changes,
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
