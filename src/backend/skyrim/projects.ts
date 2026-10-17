import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findCaseInsensitive } from './paths.js';
import type { ProjectInfo } from './SkyrimBackend.js';

/**
 * A project on disk (docs/adr/0004):
 *
 *   <projects>/<name>/plugin/    the plugin as text — RecordData.yaml and one YAML file per record
 *   <projects>/<name>/scripts/   Papyrus sources (*.psc), compiled into the mod's Scripts folder
 *   <projects>/<name>/assets/    loose files copied into the mod as they are: meshes/, textures/…
 *   <projects>/<name>/build/     what a build produces; not versioned
 *   <projects>/<name>/.deploy.json   what was deployed last; not versioned
 */

export class ProjectError extends Error { }

export interface ProjectPaths {
    root: string;
    plugin: string;
    scripts: string;
    assets: string;
    build: string;
    deployState: string;
}

/** Project names become folder names and Mod Organizer mod names. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

export function projectPaths(projectsDir: string, name: string): ProjectPaths {
    if (!NAME.test(name) || name.endsWith('.')) {
        throw new ProjectError(
            `'${name}' cannot be a project name: use letters, digits, spaces, '_', '-' or '.', up to 64 characters.`);
    }
    const root = path.join(projectsDir, name);
    return {
        root,
        plugin: path.join(root, 'plugin'),
        scripts: path.join(root, 'scripts'),
        assets: path.join(root, 'assets'),
        build: path.join(root, 'build'),
        deployState: path.join(root, '.deploy.json')
    };
}

export function projectExists(paths: ProjectPaths): boolean {
    return fs.existsSync(path.join(paths.plugin, 'RecordData.yaml'));
}

/** The plugin file name and light flag, from the project's RecordData.yaml. */
export function readProjectHeader(paths: ProjectPaths): { plugin: string; light: boolean } {
    const file = path.join(paths.plugin, 'RecordData.yaml');
    if (!fs.existsSync(file)) {
        throw new ProjectError(`There is no project at '${paths.root}'. Create it with newProject or addPatch.`);
    }
    const text = fs.readFileSync(file, 'utf8');
    const plugin = /^ModKey:\s*(.+?)\s*$/m.exec(text)?.[1];
    if (!plugin) {
        throw new ProjectError(
            `'${file}' names no ModKey. Add a first line 'ModKey: <plugin file name>', as newProject writes it.`);
    }
    // The header's flags, as a block list (`- Small`) or a flow list (`Flags: [Small]`).
    const flowFlags = /^\s*Flags:\s*\[([^\]]*)\]/m.exec(text)?.[1].split(',').map(flag => flag.trim()) ?? [];
    return { plugin, light: /^\s*-\s*Small\s*$/m.test(text) || flowFlags.includes('Small') };
}

export function projectInfo(name: string, paths: ProjectPaths, created: boolean): ProjectInfo {
    const { plugin, light } = readProjectHeader(paths);
    return { project: name, plugin, light, path: paths.root, pluginFolder: paths.plugin, writeRecordsTo: whereRecordsGo(paths), created };
}

/** The group folders of the everyday record types, as Spriggit names them. */
const GROUP_FOLDERS = 'Weapons, Armors, Spells, MagicEffects, ObjectEffects (enchantments), Npcs, LeveledItems';

/**
 * Where a record's file goes, in full paths. Given an example relative to the plugin folder, small
 * models joined it to the project folder, and the build never read their records (eval round 9).
 */
export function whereRecordsGo(paths: ProjectPaths): string {
    return `One YAML file per record, in its type's group folder inside ${paths.plugin} — a new weapon as ` +
        `${path.join(paths.plugin, 'Weapons', 'MyWeapon.yaml')}. The group folders are named as readRecord's ` +
        `pathInPluginFolder names them: ${GROUP_FOLDERS}.`;
}

/**
 * Where a record file written outside the project's plugin folder belongs, as a full path: its group's
 * folder and name inside the plugin folder — `<project>/Spells/X.yaml`, `<projects>/Spells/X.yaml` and
 * `<projects>/plugin/Spells/X.yaml` (a path written without the project's folder) all belong at
 * `<project>/plugin/Spells/X.yaml`. Null for a file with no group folder above it. Told only that the
 * file was in no project, a model wrote it to the same path three builds in a row (eval probe 14).
 */
export function belongsAt(file: string, paths: ProjectPaths, projectsDir: string): string | null {
    const base = path.resolve(file).toLowerCase().startsWith(path.resolve(paths.root).toLowerCase() + path.sep) ? paths.root : projectsDir;
    const parts = path.relative(base, file).split(/[\\/]/).filter(part => part.length > 0);
    if (parts[0]?.toLowerCase() === 'plugin') parts.shift();
    return parts.length >= 2 ? path.join(paths.plugin, ...parts.slice(-2)) : null;
}

/**
 * Files in the plugin folder's group folders that the build does not read for their ending — an
 * enchantment saved as FlameBladeBurn.nhs (eval probe 16) — each with the name it reads.
 */
export function misnamedRecordFiles(pluginDir: string): { file: string; as: string }[] {
    const found: { file: string; as: string }[] = [];
    const walk = (dir: string, depth: number) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, depth + 1);
            else if (depth > 0 && !/\.yaml$/i.test(entry.name)) found.push({ file: full, as: full.replace(/\.[^.\\/]*$/, '') + '.yaml' });
        }
    };
    walk(pluginDir, 0);
    return found.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Record files with a markdown fence in them — a line of three or more backticks or tildes — and the
 * fence's line numbers. An answer shows a file that way, and a model copied the fence with it (eval
 * round 15's probes).
 */
export function fencedRecordFiles(pluginDir: string): { file: string; lines: number[] }[] {
    return recordFiles(pluginDir).flatMap(file => {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
            .flatMap((line, i) => /^\s*(`{3,}|~{3,})/.test(line) ? [i + 1] : []);
        return lines.length > 0 ? [{ file, lines }] : [];
    });
}

/**
 * Lines of record files that carry the escapes a JSON answer shows — two backslashes where the record
 * has one, a backslash before a quote — copied as they read: e4b wrote `File: Weapons\\Iron\\Sword.nif`
 * in about one run of seventeen (eval rounds 12–15), and the build took it. A double-quoted string is
 * judged once decoded, since YAML escapes there too; on 6,038 files Spriggit wrote, nothing is found.
 */
export function copiedEscapes(pluginDir: string): { file: string; line: number; kind: 'two backslashes' | 'a backslash before a quote' }[] {
    const kindOf = (text: string) =>
        /\\\\/.test(text) ? 'two backslashes' as const : /\\"/.test(text) ? 'a backslash before a quote' as const : undefined;
    return recordFiles(pluginDir).flatMap(file => fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((text, i) => {
        let outside = text;
        for (const quoted of text.match(/"(?:[^"\\]|\\.)*"/g) ?? []) {
            let decoded = '';
            try { decoded = JSON.parse(quoted); } catch { /* a YAML escape JSON does not know: not one a copy leaves */ }
            const kind = kindOf(decoded);
            if (kind) return [{ file, line: i + 1, kind }];
            outside = outside.replace(quoted, '""');
        }
        const kind = kindOf(outside);
        return kind ? [{ file, line: i + 1, kind }] : [];
    }));
}

/** YAML files in a project's folder but outside its plugin folder and build output: no build reads them. */
export function strayRecordFiles(paths: ProjectPaths): string[] {
    const skip = new Set([paths.plugin, paths.build].map(dir => path.resolve(dir).toLowerCase()));
    return yamlFilesUnder(paths.root, dir => !skip.has(path.resolve(dir).toLowerCase()));
}

/** YAML files in the projects folder that belong to no project: on its top, or in a folder that is no project. */
export function looseRecordFiles(projectsDir: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.flatMap(entry => {
        const full = path.join(projectsDir, entry.name);
        if (entry.isFile()) return /\.ya?ml$/i.test(entry.name) ? [full] : [];
        const isProject = fs.existsSync(path.join(full, 'plugin', 'RecordData.yaml'));
        return entry.isDirectory() && !isProject && !entry.name.startsWith('.') ? yamlFilesUnder(full, () => true) : [];
    }).sort();
}

function yamlFilesUnder(root: string, descend: (dir: string) => boolean): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.') && descend(full)) walk(full);
            } else if (/\.ya?ml$/i.test(entry.name)) {
                found.push(full);
            }
        }
    };
    walk(root);
    return found.sort();
}

export function createProject(paths: ProjectPaths, plugin: string, light: boolean): void {
    if (!/\.(esp|esm)$/i.test(plugin)) {
        throw new ProjectError(`'${plugin}' is not a plugin file name: end it in .esp (or .esm for a master).`);
    }
    fs.mkdirSync(paths.plugin, { recursive: true });
    const flags = light ? 'ModHeader:\n  Flags:\n  - Small\n' : '';
    fs.writeFileSync(path.join(paths.plugin, 'RecordData.yaml'), `ModKey: ${plugin}\nGameRelease: SkyrimSE\n${flags}`);
}

// ---------------------------------------------------------------- FormIDs

const LIGHT_MAX = 0xFFF;
const FULL_MAX = 0xFFFFFF;
const FIRST_ID = 0x800;

/** Every record file of a plugin folder: everything but the plugin's own header. */
export function recordFiles(pluginDir: string): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.yaml') && full !== path.join(pluginDir, 'RecordData.yaml')) files.push(full);
        }
    };
    if (fs.existsSync(pluginDir)) walk(pluginDir);
    return files.sort();
}

/**
 * Gives every new record a FormID — a record file without a top-level `FormKey:` line, as an agent
 * writes one — written at the top of its file, which keeps its name until the build succeeds
 * (nameRecordFiles). Once assigned, a FormID never moves: other plugins and saves will point at it.
 * Deterministic: files are numbered in path order after the highest number in use. The files in `skip`,
 * which the build leaves out, keep their text.
 */
export function assignFormIds(pluginDir: string, plugin: string, light: boolean, skip: ReadonlySet<string> = new Set()):
    { formId: string; editorId: string | null; file: string }[] {
    const used: number[] = [];
    const fresh: { file: string; text: string }[] = [];
    const ownKey = new RegExp(`^FormKey:[ \\t]*([0-9A-Fa-f]{6}):${escapeRegExp(plugin)}[ \\t]*(?:#.*)?$`, 'im');

    for (const file of recordFiles(pluginDir).filter(file => !skip.has(file))) {
        const text = fs.readFileSync(file, 'utf8');
        if (/^FormKey:/m.test(text)) {
            const own = ownKey.exec(text);
            if (own) used.push(parseInt(own[1], 16));
        } else if (!/^(Group)?RecordData\.yaml$/.test(path.basename(file))) {
            // The files Spriggit heads a block of cells or a cell's folder with are no new records:
            // numbered and renamed, they broke the next build of every project with a cell in it.
            fresh.push({ file, text });
        }
    }

    let next = Math.max(FIRST_ID - 1, ...used) + 1;
    const max = light ? LIGHT_MAX : FULL_MAX;
    const assigned: { formId: string; editorId: string | null; file: string }[] = [];
    for (const { file, text } of fresh) {
        if (next > max) {
            throw new ProjectError(
                `${plugin} is a light plugin and has no FormIDs left (the build numbers a light plugin's new records ` +
                `000800–000FFF, ${LIGHT_MAX - FIRST_ID + 1} in all). Remove the 'Small' flag from plugin/RecordData.yaml ` +
                `to make it a full plugin.`);
        }
        const id = next.toString(16).toUpperCase().padStart(6, '0');
        next++;
        fs.writeFileSync(file, `FormKey: ${id}:${plugin}\n${text}`);
        assigned.push({ formId: `${id}:${plugin}`, editorId: editorIdOf(text), file: relativeTo(pluginDir, file) });
    }
    return assigned;
}

/**
 * Keeps the record files' text as it stands, and answers a function that writes back each file changed
 * since. A build the helper refuses gives back the links it had written as FormIDs: a model that then
 * wrote the record they named anew, without its FormKey line, left a link to a number no record had
 * (eval probe 8 after round 11). FormIDs given by assignFormIds before stay.
 */
export function keepRecordTexts(pluginDir: string): () => void {
    const texts = new Map(recordFiles(pluginDir).map(file => [file, fs.readFileSync(file, 'utf8')]));
    return () => {
        for (const [file, text] of texts) {
            if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
        }
    };
}

/**
 * Renames the files of the project's own records the way Spriggit names them — `<editor ID> -
 * <FormID>_<plugin>.yaml` — so that a pull finds them where it would write them. Called once a build
 * has succeeded: renamed by a build that then failed, a file went on being fixed under its old name,
 * which made a second record (eval round 11). Overrides and the files heading cells keep their names.
 */
export function nameRecordFiles(pluginDir: string, plugin: string, skip: ReadonlySet<string> = new Set()):
    { from: string; to: string; formId: string; editorId: string | null }[] {
    const ownKey = new RegExp(`^FormKey:[ \\t]*([0-9A-Fa-f]{6}):${escapeRegExp(plugin)}[ \\t]*(?:#.*)?$`, 'im');
    const renamed: { from: string; to: string; formId: string; editorId: string | null }[] = [];
    for (const file of recordFiles(pluginDir).filter(file => !skip.has(file))) {
        if (/^(Group)?RecordData\.yaml$/.test(path.basename(file))) continue;
        const text = fs.readFileSync(file, 'utf8');
        const id = ownKey.exec(text)?.[1].toUpperCase();
        if (!id) continue;
        const editorId = editorIdOf(text);
        const target = path.join(path.dirname(file), `${editorId ? `${safeFileName(editorId)} - ` : ''}${id}_${plugin}.yaml`);
        if (target === file || fs.existsSync(target)) continue;
        fs.renameSync(file, target);
        renamed.push({ from: relativeTo(pluginDir, file), to: relativeTo(pluginDir, target), formId: `${id}:${plugin}`, editorId });
    }
    return renamed;
}

// A comment after either line is no part of it: `FormKey: 000123:Skyrim.esm # Placeholder` went unread (eval round 14).
const editorIdOf = (text: string) => /^EditorID:[ \t]*([^\s#]+)/m.exec(text)?.[1] ?? null;
const relativeTo = (dir: string, file: string) => path.relative(dir, file).replace(/\\/g, '/');

function safeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_');
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- files

/**
 * The newest modification time of the project's sources: plugin, scripts and assets. Folders count
 * too, because deleting a file changes only its folder's time.
 */
export function newestSourceTime(paths: ProjectPaths): number {
    let newest = 0;
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        newest = Math.max(newest, fs.statSync(dir).mtimeMs);
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else newest = Math.max(newest, fs.statSync(full).mtimeMs);
        }
    };
    walk(paths.plugin);
    walk(paths.scripts);
    walk(paths.assets);
    return newest;
}

/**
 * Makes `target` hold exactly the files of `sources` — a later source wins over an earlier one —
 * plus whatever `keep` names among its own top-level entries. Returns the number of files.
 *
 * A file that is already there is written in place, never deleted and replaced: a mod manager that
 * deployed it into the game as a hard link (Amethyst) then sees the new content at once, rather than
 * keeping the old file alive in the game's Data. Names are matched without regard to case, as the
 * game matches them.
 */
export function syncFolder(sources: readonly string[], target: string, keep: (name: string) => boolean): number {
    const wanted = new Map<string, { relative: string; file: string }>();
    const walk = (root: string, dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(root, full);
            else {
                const relative = path.relative(root, full);
                wanted.set(relative.toLowerCase(), { relative, file: full });
            }
        }
    };
    for (const source of sources) if (fs.existsSync(source)) walk(source, source);

    const prune = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relative = path.join(prefix, entry.name);
            const full = path.join(dir, entry.name);
            if (!prefix && keep(entry.name)) continue;
            if (entry.isDirectory()) {
                prune(full, relative);
                if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
            } else if (!wanted.has(relative.toLowerCase())) {
                fs.rmSync(full);
            }
        }
    };
    if (fs.existsSync(target)) prune(target, '');

    for (const { relative, file } of wanted.values()) {
        const destination = findCaseInsensitive(target, relative) ?? path.join(target, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, fs.readFileSync(file));
    }
    return wanted.size;
}

/**
 * Makes `target` hold exactly the YAML files of `source`, touching only what differs — so git sees
 * the real change and nothing else. Paths are relative to the folders, with forward slashes.
 */
export function syncYaml(source: string, target: string): { added: string[]; changed: string[]; removed: string[] } {
    const rel = (root: string, file: string) => path.relative(root, file).replace(/\\/g, '/');
    const list = (root: string) => {
        const files = new Map<string, string>();
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.yaml')) files.set(rel(root, full), full);
            }
        };
        walk(root);
        return files;
    };

    const incoming = list(source);
    const existing = list(target);
    const result = { added: [] as string[], changed: [] as string[], removed: [] as string[] };

    for (const [relative, file] of incoming) {
        const text = fs.readFileSync(file, 'utf8');
        const destination = path.join(target, relative);
        if (!existing.has(relative)) {
            result.added.push(relative);
        } else if (fs.readFileSync(destination, 'utf8') === text) {
            continue;
        } else {
            result.changed.push(relative);
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, text);
    }
    for (const [relative, file] of existing) {
        if (!incoming.has(relative)) {
            fs.rmSync(file);
            result.removed.push(relative);
        }
    }
    removeEmptyFolders(target);
    return result;
}

function removeEmptyFolders(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        removeEmptyFolders(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    }
}

export function fileHash(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------- deploy state

export interface DeployState {
    modFolder: string;
    plugin: string;
    /** sha256 of the plugin as it was deployed — or pulled, which makes it the project's again. */
    pluginHash: string;
    at: string;
}

export function readDeployState(paths: ProjectPaths): DeployState | undefined {
    try {
        return JSON.parse(fs.readFileSync(paths.deployState, 'utf8'));
    } catch {
        return undefined;
    }
}

export function writeDeployState(paths: ProjectPaths, state: DeployState): void {
    fs.writeFileSync(paths.deployState, `${JSON.stringify(state, null, 2)}\n`);
}
