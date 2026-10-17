import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermanentBackendError, SessionExpiredError } from '../Backend.js';
import type { HealthReport } from '../Backend.js';
import { compileScripts, hasUncommittedChanges } from './externalTools.js';
import { HelperError, HelperUnavailableError } from './helperClient.js';
import {
    FomodInstaller, InstallError, checkRoot, defaultModName, findDataRoot, folderName, modMetaIni, plainLayout, pluginOrder,
    topFolders, type ArchiveListing, type InstallEnvironment, type PluginHeader, type UnpackedFile
} from './installer.js';
import type { Instance } from './modManager.js';
import { findCaseInsensitive } from './paths.js';
import {
    ProjectError, assignFormIds, belongsAt, copiedEscapes, createProject, fencedRecordFiles, fileHash, keepRecordTexts, misnamedRecordFiles, looseRecordFiles, nameRecordFiles, newestSourceTime, projectExists,
    projectInfo, projectPaths, readDeployState, readProjectHeader, recordFiles, strayRecordFiles, syncFolder, syncYaml,
    whereRecordsGo, writeDeployState
} from './projects.js';
import type { SkyrimEngine } from './engine.js';
import { NexusCatalogue, markDownloadInstalled, readDownloadMeta } from './nexus.js';
import type {
    AddPatchRequest, AddPatchResult, BuildResult, DeployResult, InstallModQuestions, InstallModRequest, InstallModResult,
    NewProjectRequest, NexusAccount, NexusDownload, NexusMod, NexusSearchQuery, NexusSearchResult, ProjectFile, ProjectInfo,
    PullResult, RecordQuery, RecordRequest, RecordSearchResult, RecordVersion, RecordVersions, SkyrimBackend
} from './SkyrimBackend.js';
import { SERVER_INFO } from '../../lib/serverInfo.js';

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
    /** The Nexus Mods catalogue. Replaced in tests; by default the real one. */
    nexus?: NexusCatalogue;
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
    private readonly nexus: NexusCatalogue;

    constructor(private readonly options: SkyrimInstanceBackendOptions) {
        this.nexus = options.nexus ?? new NexusCatalogue({ appVersion: SERVER_INFO.version });
    }

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

    /**
     * `instance` always, `nexus-api-key` when NEXUS_API_KEY is set — the Nexus tools are offered only
     * with one, at the user's decision — and `nexus-premium` when Nexus confirms the key belongs to a
     * premium account. A key Nexus could not check, or did not in time, is not confirmed premium: the
     * download is not offered then, and a restart asks again. `instance` keeps the list from ever being
     * empty, which would gate nothing (capabilityGate.ts) and list the Nexus tools after all.
     */
    async capabilities(): Promise<readonly string[] | undefined> {
        const account = await this.nexusAccount(CAPABILITIES_WAIT_MS);
        return [
            'instance',
            ...(account.apiKey ? ['nexus-api-key'] : []),
            ...('premium' in account && account.premium ? ['nexus-premium'] : [])
        ];
    }

    /** The Nexus account, waiting no longer than healthcheck can afford; a slow check finishes in the background. */
    private async nexusAccount(waitMs = 3000): Promise<NexusAccount> {
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<NexusAccount>(resolve => {
            timer = setTimeout(() => resolve({
                apiKey: true, unchecked: `Nexus Mods did not answer within ${waitMs / 1000} s; the key is checked again next time.`
            }), waitMs);
            timer.unref();
        });
        try {
            return await Promise.race([this.nexus.account(), late]);
        } finally {
            clearTimeout(timer);
        }
    }

    async health(): Promise<HealthReport> {
        // Nexus is optional: an account problem is reported, never counted against the instance's health.
        const nexus = await this.nexusAccount();
        let instance;
        try {
            instance = this.engine.modManager.readInstance();
        } catch (error) {
            return { ok: false, summary: (error as Error).message, nexus };
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
            helper,
            nexus
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
        const plugin = request.plugin ?? `${request.project}.esp`;
        this.refuseTakenPlugin(plugin);
        prepareProjectsFolder(this.engine.projectsDir);
        createProject(paths, plugin, request.light ?? true);
        return projectInfo(request.project, paths, true);
    }

    /**
     * A new project's plugin must not share its name with a plugin the load order has: deployed, it
     * would hide that one from the game — a project's Skyrim.esm would take the game's own master's place.
     */
    private refuseTakenPlugin(plugin: string): void {
        const modManager = this.engine.modManager;
        const instance = modManager.readInstance();
        const taken = modManager.resolvePluginFiles(instance, modManager.readModList(instance)).get(plugin.toLowerCase());
        if (!taken) return;
        const name = path.basename(taken);
        throw new ProjectError(
            `${name} is already a plugin in the load order; a project with that plugin would hide it from the game. ` +
            `Leave \`plugin\` out — the project gets <project>.esp — or name a new file. To copy records from ${name}, ` +
            `pass it to addPatch as \`from\`.`);
    }

    async addPatch(request: AddPatchRequest): Promise<AddPatchResult> {
        await this.engine.ensureFresh();
        const paths = projectPaths(this.engine.projectsDir, request.project);
        let created = false;
        if (!projectExists(paths)) {
            const plugin = request.plugin ?? `${request.project}.esp`;
            this.refuseTakenPlugin(plugin);
            prepareProjectsFolder(this.engine.projectsDir);
            createProject(paths, plugin, true);
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

        // A build of nothing succeeded, and small models took it for done (eval round 9): name what is
        // missing, and the record files no build would read.
        const strays = strayRecordFiles(paths);
        const files = recordFiles(paths.plugin).length;
        if (files === 0) {
            const loose = looseRecordFiles(this.engine.projectsDir);
            const where = (file: string) => {
                const target = belongsAt(file, paths, this.engine.projectsDir);
                return target ? `${file} as ${target}` : file;
            };
            // The way out first: placed after the general text, it went unread, three builds in a row (eval probe 15).
            const misnamed = misnamedRecordFiles(paths.plugin);
            throw new ProjectError(
                `'${project}' has no records to build.` +
                (misnamed.length > 0 ? ` Files the build does not read for their ending — write each as .yaml: ` +
                    `${misnamed.map(({ file, as }) => `${file} as ${as}`).join('; ')}.` : '') +
                (strays.length > 0 ? ` Its record files outside its plugin folder, where no build reads them — write each where it ` +
                    `belongs: ${strays.map(where).join('; ')}.` : '') +
                (loose.length > 0 ? ` Record files that belong to no project — write each of this project's where it belongs: ` +
                    `${loose.map(where).join('; ')}.` : '') +
                ` ${whereRecordsGo(paths)} Mirror a vanilla record of the same type (readRecord), leaving FormKey out.`);
        }
        // Copied with the fence an answer shows it in, a record broke the YAML at line 1, and the reader's
        // message sent the model to fix its indentation (eval round 15's probes): named first, plainly.
        const fenced = fencedRecordFiles(paths.plugin);
        if (fenced.length > 0) {
            const lines = (numbers: number[]) => numbers.length === 1
                ? `line ${numbers[0]}`
                : `lines ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
            throw new ProjectError(
                `${fenced.map(({ file, lines: at }) => `${file}, ${lines(at)}`).join('; ')}: a markdown fence — a line of ` +
                'backticks, the way an answer shows a file. A record file holds only the record\'s YAML: delete the fence ' +
                'lines and keep what is between them.');
        }
        // Escapes copied out of a JSON answer as they read built without a word, into a path the game cannot
        // find (eval rounds 12–15): refused, like the fence, so the model rewrites the line.
        const escaped = copiedEscapes(paths.plugin);
        if (escaped.length > 0) {
            throw new ProjectError(
                `${escaped.map(({ file, line, kind }) => `${file}, line ${line} (${kind})`).join('; ')}: copied with the escapes ` +
                'a JSON answer shows. In the file, write a path\'s folders apart with a single backslash, and a quote without ' +
                'a backslash before it.');
        }
        // With records to build, files elsewhere are named but stop nothing: a refusal only deleting a
        // file could satisfy trapped a model whose file tools could not delete (eval round 10).
        const warnings: string[] = [];
        if (strays.length > 0) {
            warnings.push(`${strays.length} record file(s) outside the plugin folder were not built — no build reads them: ${strays.join(', ')}. ` +
                `A record meant for this mod goes into its group's folder in ${paths.plugin}; a copy of one already there can stay.`);
        }
        // Fields a record type does not have, folders that are no group, copied FormKeys, links that name no
        // record: named before any record is numbered. A file in a folder that is no group, whose record its
        // group's folder holds too, is left out, untouched — the same trap (eval probe 10 after round 11).
        const checked = await this.engine.helper.call<{ records: number; leftOut?: { file: string; copy: string }[]; notes?: string[] }>(
            'checkRecords', { projectPluginDir: paths.plugin });
        // What builds but likely not as meant — a woman's voice on a man, an enchantment nothing carries (eval probe 14).
        warnings.push(...checked.notes ?? []);
        const leftOut = (checked.leftOut ?? []).map(({ file, copy }) => ({ file: path.join(paths.plugin, file), copy: copy ? path.join(paths.plugin, copy) : '' }));
        const copies = leftOut.filter(({ copy }) => copy);
        if (copies.length > 0) {
            warnings.push(`${copies.length} record file(s) the build does not read were not built: ` +
                `${copies.map(({ file, copy }) => `${file}, whose record ${copy} holds`).join('; ')}. The build reads a record ` +
                `only from a .yaml file directly in its group's folder.`);
        }
        // A file written empty holds no record: the way to drop one without deleting its file (eval probe 16).
        const emptied = leftOut.filter(({ copy }) => !copy);
        if (emptied.length > 0) {
            warnings.push(`${emptied.length} record file(s) are empty, so they hold no record and were left out: ` +
                `${emptied.map(({ file }) => file).join(', ')} — delete them when you can.`);
        }
        const skip = new Set(leftOut.map(({ file }) => file));

        const assignedFormIds = assignFormIds(paths.plugin, plugin, light, skip);
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
        // The helper writes links named by editor ID into the files as FormIDs; a build that fails takes them back.
        const giveBack = keepRecordTexts(paths.plugin);
        let built: { records: number; masters: string[]; headerVersion: number; resolvedLinks: BuildResult['resolvedLinks'] };
        try {
            built = await afterLocalWrites(this.engine.helper.call<typeof built>('build', {
                projectPluginDir: paths.plugin,
                outputPath: output,
                headerVersion: this.engine.headerVersion
            }, BUILD_TIMEOUT_MS));
            // Whatever the files looked like, a plugin without records is never what was asked (eval round 10).
            if (built.records === 0) {
                fs.rmSync(output, { force: true });
                throw new ProjectError(
                    `The build read no record from ${project}'s ${files} record file(s), and wrote no plugin. A record file sits ` +
                    `directly in its group's folder — ${path.join(paths.plugin, 'Weapons', 'MyWeapon.yaml')}, not in a folder ` +
                    `below it — and is written the way readRecord shows a record of its type.`);
            }
        } catch (error) {
            giveBack();
            throw error;
        }

        // Only a build that succeeded renames its new records' files, so a refusal never leaves a file
        // under a name its author does not know. Renaming changes no record: the plugin stays newer
        // than its sources, and deploy takes it.
        const renamed = nameRecordFiles(paths.plugin, plugin, skip);
        if (renamed.length > 0) {
            // Past the renamed folders' times, which carry more than the milliseconds a Date holds.
            const after = new Date(Math.ceil(Math.max(Date.now(), newestSourceTime(paths))) + 1);
            fs.utimesSync(output, after, after);
        }
        const nameOf = new Map(renamed.map(file => [file.from, file.to]));
        const finalPath = (file: string) => path.resolve(paths.plugin, nameOf.get(file) ?? file);
        // A record numbered by an earlier build that then failed is named now; it is listed with this build's.
        const numbered = new Set(assignedFormIds.map(record => record.file));
        const earlier = renamed.filter(file => !numbered.has(file.from)).map(({ formId, editorId, from }) => ({ formId, editorId, file: from }));

        return {
            project, plugin, output,
            records: built.records,
            masters: built.masters,
            headerVersion: built.headerVersion,
            assignedFormIds: [...earlier, ...assignedFormIds].map(record => ({ ...record, file: finalPath(record.file) })),
            resolvedLinks: (built.resolvedLinks ?? []).map(link => ({ ...link, file: finalPath(link.file) })),
            scripts: { compiled },
            ...(warnings.length > 0 ? { warnings } : {})
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
        const refusal = await modManager.writeRefusal(instance);
        if (refusal) throw new ProjectError(refusal);

        // The mod folder becomes the build plus the assets, so files removed from the project go too —
        // all but the mod manager's own meta.ini.
        const files = syncFolder([paths.assets, paths.build], modFolder, name => name.toLowerCase() === 'meta.ini');
        // Guarded above: a shadowing copy that got this far was pulled, so the project holds its work.
        for (const copy of shadowing) fs.rmSync(copy);

        const enabled = modManager.enable(instance, project, [plugin]);
        const notice = await modManager.afterDeploy(instance);
        writeDeployState(paths, { modFolder, plugin, pluginHash: fileHash(deployed), at: new Date().toISOString() });

        return {
            project, plugin, modFolder, files,
            ...(shadowing.length > 0 ? { removedCopies: shadowing } : {}),
            profile: {
                name: instance.profile,
                modEnabled: enabled.modEnabled,
                pluginActive: enabled.activated.length > 0,
                addedToLoadOrder: enabled.addedToLoadOrder.length > 0
            },
            modManager: notice
        };
    }

    async pullProject(project: string): Promise<PullResult> {
        await this.engine.ensureFresh();
        const instance = this.engine.modManager.readInstance();
        const paths = projectPaths(this.engine.projectsDir, project);
        const { plugin } = readProjectHeader(paths);

        // The Creation Kit writes a plugin it edits back to its mod, but one it saves anew can land
        // elsewhere — in Mod Organizer, in overwrite. The newest copy is the latest work; of copies with
        // the same time — a coarse file clock gives them that — the one that outranks the mod is what the
        // game loads. Highest first, so the stable sort keeps that order among equals.
        const deployed = path.join(instance.modsDir, project, plugin);
        const candidates = [...this.engine.modManager.shadowingCopies(instance, project, plugin), deployed].filter(file => fs.existsSync(file));
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

    // Nexus needs neither the instance nor the helper: these answer whatever state the engine is in.
    async searchNexus(query: NexusSearchQuery): Promise<NexusSearchResult> {
        return this.nexus.searchMods(query);
    }

    async readNexusMod(modId: number): Promise<NexusMod> {
        return this.nexus.readMod(modId);
    }

    async downloadNexusFile(modId: number, fileId: number): Promise<NexusDownload> {
        return this.nexus.downloadFile(modId, fileId, this.engine.modManager.readInstance().downloadsDir);
    }

    // ---------------------------------------------------------------- installing

    /**
     * A downloaded file into the instance as a mod, the way deployProject puts a project there: the mod
     * manager may refuse first, the mod is enabled and its plugins activated, and the mod manager is
     * told. Whatever can be refused is refused before anything is written; a FOMOD installer's first
     * answer writes nothing at all.
     */
    async installMod(request: InstallModRequest): Promise<InstallModResult | InstallModQuestions> {
        const modManager = this.engine.modManager;
        const instance = modManager.readInstance();
        const file = findDownload(instance.downloadsDir, request.file);
        const fileName = path.basename(file);
        const meta = readDownloadMeta(file);
        const mod = request.name !== undefined ? checkModName(request.name) : defaultModName(meta, fileName);
        const modFolder = path.join(instance.modsDir, mod);

        if (isProjectMod(this.engine.projectsDir, mod)) {
            throw new InstallError(
                `'${mod}' is the mod of the project '${mod}', which deployProject puts into the instance. Give \`name\` to ` +
                `install this file as another mod.`);
        }
        const exists = fs.existsSync(modFolder) && fs.readdirSync(modFolder).length > 0;
        if (exists && !request.replace) {
            throw new InstallError(
                `A mod named '${mod}' is already in the instance. Pass replace: true to replace its files with this file's, ` +
                `or give \`name\` to install it as another mod.`);
        }

        await this.engine.ensureFresh();
        const listing = await this.engine.helper.call<ArchiveListing>('readArchive', { archivePath: file }, BUILD_TIMEOUT_MS);
        const warnings: string[] = [];
        let plan: Pick<InstallModResult, 'installer' | 'root' | 'chosen' | 'ignoredChoices'> & { files: UnpackedFile[] };
        if (listing.fomod && request.root === undefined) {
            const fomod = new FomodInstaller(listing, this.installEnvironment(instance));
            if (request.choices === undefined && fomod.asksQuestions) {
                return { status: 'chooseOptions', mod, file, installer: fomod.describe(), nextStep: CHOOSE_OPTIONS };
            }
            const planned = fomod.plan(request.choices ?? []);
            warnings.push(...planned.warnings);
            plan = {
                installer: 'fomod', files: planned.files, chosen: planned.chosen,
                ...(planned.ignoredChoices.length > 0 ? { ignoredChoices: planned.ignoredChoices } : {})
            };
        } else {
            const root = request.root !== undefined ? checkRoot(listing.files, request.root) : findDataRoot(listing.files);
            if (root === undefined) {
                throw new InstallError(
                    `Which folder of ${fileName} is the mod is not clear: it has ${topFolders(listing.files).join(', ')} at the ` +
                    `top, likely options to choose from. Call installMod again with \`root\` set to the one the user wants — ` +
                    `the mod page (readNexusMod) says what each is.`);
            }
            if (request.choices !== undefined) warnings.push(`${fileName} was installed without its FOMOD installer, so \`choices\` were not used.`);
            plan = { installer: 'none', root, files: plainLayout(listing.files, root) };
        }
        if (plan.files.length === 0) {
            throw new InstallError(`Nothing of ${fileName} would be installed. Choose other options, or another \`root\`.`);
        }
        const refusal = await modManager.writeRefusal(instance);
        if (refusal) throw new InstallError(refusal);

        // Written from here on. A half-unpacked mod is worse than none: the file is still there to install again.
        if (exists) fs.rmSync(modFolder, { recursive: true, force: true });
        fs.mkdirSync(modFolder, { recursive: true });
        try {
            const unpacking = this.engine.helper.call('extractArchive', { archivePath: file, targetDir: modFolder, files: plan.files }, BUILD_TIMEOUT_MS);
            await (exists ? afterLocalWrites(unpacking) : unpacking);
        } catch (error) {
            fs.rmSync(modFolder, { recursive: true, force: true });
            throw error;
        }
        fs.writeFileSync(path.join(modFolder, 'meta.ini'), modMetaIni(meta, fileName), 'utf8');
        markDownloadInstalled(file);

        const plugins = await this.pluginsOf(modFolder, warnings);
        const order = pluginOrder(plugins);
        const loaded = new Set([
            ...modManager.readLoadOrder(instance).filter(plugin => plugin.active).map(plugin => plugin.name.toLowerCase()),
            ...order.map(name => name.toLowerCase())
        ]);
        const missingMasters = order
            .map(name => ({ plugin: name, masters: plugins.find(p => p.name === name)!.masters.filter(m => !loaded.has(m.toLowerCase())) }))
            .filter(entry => entry.masters.length > 0);
        if (missingMasters.length > 0) {
            const masters = [...new Set(missingMasters.flatMap(entry => entry.masters))];
            warnings.push(
                `The game will not start while ${masters.join(', ')} ${masters.length === 1 ? 'is' : 'are'} missing from the load ` +
                `order: install the mods ${masters.length === 1 ? 'it comes' : 'they come'} from — readNexusMod lists a mod's requirements.`);
        }

        const enabled = modManager.enable(instance, mod, order);
        const notice = await modManager.afterDeploy(instance);
        const { files: unpacked, ...how } = plan;
        return {
            mod, modFolder, file,
            files: unpacked.length,
            ...how,
            plugins: order,
            ...(missingMasters.length > 0 ? { missingMasters } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
            ...(exists ? { replaced: true as const } : {}),
            ...(meta.modId ? {
                nexus: { modId: meta.modId, ...(meta.fileId ? { fileId: meta.fileId } : {}), ...(meta.version ? { version: meta.version } : {}) }
            } : {}),
            profile: { name: instance.profile, ...enabled },
            modManager: notice
        };
    }

    /** The plugins at the top of a mod folder, with their masters; a file that is not a plugin is named in `warnings`. */
    private async pluginsOf(modFolder: string, warnings: string[]): Promise<PluginHeader[]> {
        const names = fs.readdirSync(modFolder, { withFileTypes: true })
            .filter(entry => entry.isFile() && /\.(esp|esm|esl)$/i.test(entry.name))
            .map(entry => entry.name);
        if (names.length === 0) return [];
        const read = await afterLocalWrites(this.engine.helper.call<{ plugins: { path: string; masters?: string[]; master?: boolean; error?: string }[] }>(
            'pluginHeaders', { paths: names.map(name => path.join(modFolder, name)) }));
        return read.plugins.map(plugin => {
            const name = path.basename(plugin.path);
            if (plugin.error) warnings.push(`${name} could not be read as a plugin (${plugin.error}); the game may not load it.`);
            return { name, masters: plugin.masters ?? [], master: plugin.master ?? false };
        });
    }

    /** What a FOMOD installer's conditions can ask: a file's state in the instance, the game's version, SKSE. */
    private installEnvironment(instance: Instance): InstallEnvironment {
        const modManager = this.engine.modManager;
        const mods = modManager.readModList(instance);
        const present = modManager.resolvePluginFiles(instance, mods);
        const active = new Set(modManager.readLoadOrder(instance).filter(p => p.active).map(p => p.name.toLowerCase()));
        const folders = [
            instance.overwriteDir,
            ...mods.filter(m => m.enabled && m.managed).map(m => path.join(instance.modsDir, m.name)),
            path.join(instance.gameDir, 'Data')
        ];
        // Any other file is looked for in every enabled mod — thousands, in a big list — so once per file.
        const looked = new Map<string, boolean>();
        return {
            fileState: name => {
                const file = name.replace(/\\/g, '/');
                const key = file.toLowerCase();
                if (/\.(esp|esm|esl)$/i.test(file) && !file.includes('/')) {
                    return present.has(key) ? (active.has(key) ? 'Active' : 'Inactive') : 'Missing';
                }
                if (!looked.has(key)) looked.set(key, folders.some(folder => findCaseInsensitive(folder, file)));
                return looked.get(key) ? 'Active' : 'Missing';
            },
            gameVersion: this.engine.gameVersion,
            scriptExtender: findCaseInsensitive(instance.gameDir, 'skse64_loader.exe') !== undefined
        };
    }
}

/** What the first answer for a FOMOD installer asks the caller to do. */
const CHOOSE_OPTIONS =
    'Choose the options the user wants — ask them where it matters — then call installMod again with the same file ' +
    'and `choices`: the ids of the options to install, e.g. ["1.1.2", "2.1.1"]. A group you choose nothing in keeps ' +
    'its default; `choices: []` installs every default. A step with `shownWhen` is installed only when that holds.';

/** The downloaded file a request names: a full path, or a name in the downloads folder in any letter case. */
function findDownload(downloadsDir: string, file: string): string {
    const given = file.trim();
    const found = path.isAbsolute(given) ? (fs.existsSync(given) ? given : undefined) : findCaseInsensitive(downloadsDir, given);
    if (found && fs.statSync(found).isFile()) return found;
    throw new InstallError(path.isAbsolute(given)
        ? `There is no file at '${given}'. Give the full path of a downloaded .7z, .zip or .rar, or its name in the downloads folder ${downloadsDir}.`
        : `No file '${given}' in the downloads folder ${downloadsDir}. Download it with downloadNexusFile, or give the full ` +
          `path of a file downloaded by hand.`);
}

/** A name the caller gave, as it is — or refused, when it cannot be a folder. */
function checkModName(name: string): string {
    const given = name.trim();
    if (!given || folderName(given) !== given) {
        throw new InstallError(`'${name}' cannot be a mod's name: it becomes a folder, so leave out < > : " / \\ | ? * and a trailing dot.`);
    }
    return given;
}

/** Whether a mod of this name is a project's, deployed by deployProject. */
function isProjectMod(projectsDir: string, mod: string): boolean {
    try {
        return projectExists(projectPaths(projectsDir, mod));
    } catch {
        return false; // not a name a project can have
    }
}

/**
 * How long capabilities() waits for Nexus's key check: under the server's 8 s for the whole gate, so the
 * answer arrives in time — a late one would leave the gate empty and list the download after all.
 */
const CAPABILITIES_WAIT_MS = 5_000;

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
