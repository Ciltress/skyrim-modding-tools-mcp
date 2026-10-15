import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
    if (!plugin) throw new ProjectError(`'${file}' names no ModKey.`);
    return { plugin, light: /^\s*-\s*Small\s*$/m.test(text) };
}

export function projectInfo(name: string, paths: ProjectPaths, created: boolean): ProjectInfo {
    const { plugin, light } = readProjectHeader(paths);
    return { project: name, plugin, light, path: paths.root, pluginFolder: paths.plugin, created };
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
 * writes one — and renames its file the way Spriggit names it. Once assigned, a FormID never moves:
 * other plugins and saves will point at it. Deterministic: files are numbered in path order after the
 * highest number in use.
 */
export function assignFormIds(pluginDir: string, plugin: string, light: boolean):
    { formId: string; editorId: string | null; file: string }[] {
    const used: number[] = [];
    const fresh: { file: string; text: string }[] = [];
    const ownKey = new RegExp(`^FormKey:\\s*([0-9A-Fa-f]{6}):${escapeRegExp(plugin)}\\s*$`, 'im');

    for (const file of recordFiles(pluginDir)) {
        const text = fs.readFileSync(file, 'utf8');
        if (/^FormKey:/m.test(text)) {
            const own = ownKey.exec(text);
            if (own) used.push(parseInt(own[1], 16));
        } else {
            fresh.push({ file, text });
        }
    }

    let next = Math.max(FIRST_ID - 1, ...used) + 1;
    const max = light ? LIGHT_MAX : FULL_MAX;
    const assigned: { formId: string; editorId: string | null; file: string }[] = [];
    for (const { file, text } of fresh) {
        if (next > max) {
            throw new ProjectError(
                `${plugin} is a light plugin and has no FormIDs left (it holds at most ${LIGHT_MAX - FIRST_ID + 1} new ` +
                `records). Remove the 'Small' flag from plugin/RecordData.yaml to make it a full plugin.`);
        }
        const id = next.toString(16).toUpperCase().padStart(6, '0');
        next++;
        const editorId = /^EditorID:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
        const name = `${editorId ? `${safeFileName(editorId)} - ` : ''}${id}_${plugin}.yaml`;
        const target = path.join(path.dirname(file), name);
        fs.writeFileSync(target, `FormKey: ${id}:${plugin}\n${text}`);
        if (target !== file) fs.rmSync(file);
        assigned.push({ formId: `${id}:${plugin}`, editorId, file: path.relative(pluginDir, target).replace(/\\/g, '/') });
    }
    return assigned;
}

function safeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_');
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- files

/** The newest modification time of the project's sources: plugin, scripts and assets. */
export function newestSourceTime(paths: ProjectPaths): number {
    let newest = 0;
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
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

/** Copies a folder's contents into another, creating folders as needed. Returns the number of files. */
export function copyTree(from: string, to: string): number {
    if (!fs.existsSync(from)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
            count += copyTree(source, target);
        } else {
            fs.mkdirSync(to, { recursive: true });
            fs.copyFileSync(source, target);
            count++;
        }
    }
    return count;
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
