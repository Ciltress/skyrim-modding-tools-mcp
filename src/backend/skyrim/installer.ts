import path from 'node:path';
import { encodeQtValue } from './mo2.js';
import { NEXUS_GAME, type DownloadMeta } from './nexus.js';

/**
 * What installMod decides before it writes anything: which file of a downloaded file goes where in
 * the new mod. The helper reads the file — its list of files, and its FOMOD installer as data
 * (helper/SkyrimHelper/Fomod.cs) — and unpacks what this decides; everything between is here, so it
 * is tested without the helper.
 *
 * A file without an installer is installed from its Data folder, found the way Mod Organizer finds
 * it, or from the folder the caller names. A FOMOD installer is answered in two calls: the first
 * says what it asks, each option numbered `step.group.option`; the second installs the options
 * chosen, keeping the installer's defaults for every group the choices leave out.
 */

/** A request the caller can fix — an option the installer does not have, a folder the archive lacks. */
export class InstallError extends Error { }

// ---------------------------------------------------------------- the helper's answers

/** What the helper's readArchive answers: every file, `/` between folders, and the installer if there is one. */
export interface ArchiveListing {
    files: string[];
    fomod?: { path: string; config: FomodConfig };
}

export type FileState = 'Active' | 'Inactive' | 'Missing';
export type OptionType = 'Required' | 'Recommended' | 'Optional' | 'NotUsable' | 'CouldBeUsable';

export interface FomodConfig {
    moduleName: string;
    /** What the whole mod needs; Mod Organizer warns and installs anyway. */
    dependencies: FomodCondition | null;
    requiredFiles: FomodFile[];
    /** `Explicit`, `Ascending` or `Descending`; absent means ascending, the schema's default. */
    stepOrder: string | null;
    steps: FomodStep[];
    conditionalFiles: { when: FomodCondition | null; files: FomodFile[] }[];
}

export interface FomodStep {
    name: string;
    visible: FomodCondition | null;
    groupOrder: string | null;
    groups: FomodGroup[];
}

export interface FomodGroup {
    name: string;
    /** SelectExactlyOne, SelectAtMostOne, SelectAtLeastOne, SelectAll or SelectAny. */
    type: string;
    order: string | null;
    options: FomodOption[];
}

export interface FomodOption {
    name: string;
    description: string;
    files: FomodFile[];
    flags: { name: string; value: string }[];
    type: { default: OptionType; patterns?: { when: FomodCondition | null; type: OptionType }[] };
}

export interface FomodFile {
    source: string;
    /** Null when the installer gives none: the source's own path. Empty: the mod folder's top. */
    destination: string | null;
    folder: boolean;
    priority: number;
    alwaysInstall: boolean;
    installIfUsable: boolean;
}

export type FomodLeaf =
    | { file: string; state: string }
    | { flag: string; value: string }
    | { game: string }
    | { fomm: string }
    | { scriptExtender: string };

export interface FomodCondition {
    operator: string;
    conditions: (FomodLeaf | FomodCondition)[];
}

/** What a FOMOD condition can ask about the instance. */
export interface InstallEnvironment {
    /** A plugin active in the load order, present but inactive, or missing; any other file is Active when present. */
    fileState(file: string): FileState;
    /** The game's version, `1.7.104.0`; unknown passes every game condition. */
    gameVersion?: string;
    /** Whether SKSE is installed in the game folder. */
    scriptExtender: boolean;
}

/** One file to unpack: its path in the archive, and where it goes in the mod folder. */
export interface UnpackedFile {
    from: string;
    to: string;
}

// ---------------------------------------------------------------- archives without an installer

/** Folders the game reads from Data — one at the top of an archive means the top is Data. */
const DATA_FOLDERS = new Set([
    'meshes', 'textures', 'scripts', 'interface', 'sound', 'music', 'seq', 'skse', 'strings', 'video', 'shadersfx',
    'lodsettings', 'grass', 'dialogueviews', 'source', 'trees', 'terrain', 'lightplacer', 'calientetools',
    'nemesis_engine', 'netscriptframework', 'distantlod', 'lod', 'materials', 'platform', 'facegen'
]);

/** Files that belong in Data itself: plugins, their archives, and the ini files SKSE plugins read there. */
const DATA_FILE = /\.(esp|esm|esl|bsa|ini)$/i;

interface Level {
    folders: string[];
    files: string[];
}

/** The folders and files directly under `prefix` ('' for the top), each spelled as the archive spells it. */
function level(files: readonly string[], prefix: string): Level {
    const start = prefix ? `${prefix.toLowerCase()}/` : '';
    const folders = new Map<string, string>();
    const here: string[] = [];
    for (const file of files) {
        if (!file.toLowerCase().startsWith(start)) continue;
        const rest = file.slice(start.length);
        const slash = rest.indexOf('/');
        if (slash < 0) here.push(rest);
        else if (!folders.has(rest.slice(0, slash).toLowerCase())) folders.set(rest.slice(0, slash).toLowerCase(), rest.slice(0, slash));
    }
    return { folders: [...folders.values()], files: here };
}

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

/**
 * The folder of the archive that is the mod's Data, as Mod Organizer looks for it: the top when it
 * holds what Data holds, else a `Data` folder, else the one folder there is — stray documents beside
 * it do not count — and again inside that. Undefined when it is not clear: folders that are options.
 */
export function findDataRoot(files: readonly string[]): string | undefined {
    let prefix = '';
    for (let depth = 0; depth < 5; depth++) {
        const here = level(files, prefix);
        if (here.folders.some(name => DATA_FOLDERS.has(name.toLowerCase())) || here.files.some(name => DATA_FILE.test(name))) {
            return prefix;
        }
        const data = here.folders.find(name => name.toLowerCase() === 'data');
        if (data) return join(prefix, data);
        const folders = here.folders.filter(name => name.toLowerCase() !== 'fomod');
        if (folders.length !== 1) return undefined;
        prefix = join(prefix, folders[0]);
    }
    return undefined;
}

/** The folders at the archive's top, or under `prefix` — what a caller chooses `root` from. */
export function topFolders(files: readonly string[], prefix = ''): string[] {
    return level(files, prefix).folders.filter(name => name.toLowerCase() !== 'fomod');
}

/** The folder `root` names, spelled as the archive spells it; '' is the top. */
export function checkRoot(files: readonly string[], root: string): string {
    const wanted = normalize(root);
    if (!wanted) return '';
    const start = `${wanted.toLowerCase()}/`;
    const match = files.find(file => file.toLowerCase().startsWith(start));
    if (!match) {
        throw new InstallError(
            `The file has no folder '${wanted}'. Its folders at the top: ${topFolders(files).join(', ') || 'none'}. ` +
            `Give \`root\` as one of them, or a path inside one, like "Main/Data".`);
    }
    return match.slice(0, wanted.length);
}

/** Every file under `root`, placed relative to it — the installer's own `fomod` folder left out. */
export function plainLayout(files: readonly string[], root: string): UnpackedFile[] {
    const start = root ? `${root.toLowerCase()}/` : '';
    return files
        .filter(file => file.toLowerCase().startsWith(start))
        .map(file => ({ from: file, to: file.slice(start.length) }))
        .filter(file => file.to && !file.to.toLowerCase().startsWith('fomod/'));
}

// ---------------------------------------------------------------- FOMOD

/** How long one option's description may be in the first answer; the mod page has the rest. */
const DESCRIPTION_LIMIT = 300;

const CHOOSE: Record<string, string> = {
    SelectExactlyOne: 'exactly one', SelectAtMostOne: 'at most one', SelectAtLeastOne: 'at least one',
    SelectAll: 'all', SelectAny: 'any'
};

/** One option as the first answer shows it. */
export interface OptionQuestion {
    /** `step.group.option` — what `choices` names. */
    id: string;
    name: string;
    description?: string;
    /** Installed when the choices name nothing in its group. */
    default?: true;
    /** Always installed with its group. */
    required?: true;
    /** The installer does not allow it here. */
    notUsable?: true;
}

export interface GroupQuestion {
    name: string;
    /** How many of its options may be chosen: `exactly one`, `at most one`, `at least one`, `all` or `any`. */
    choose: string;
    options: OptionQuestion[];
}

export interface StepQuestion {
    step: number;
    name: string;
    /** Set when an earlier choice decides whether the step is shown, saying which. */
    shownWhen?: string;
    groups: GroupQuestion[];
}

export interface InstallerQuestions {
    name: string;
    steps: StepQuestion[];
    warnings?: string[];
}

/** What a FOMOD install puts where, and what was chosen — defaults included. */
export interface FomodPlan {
    files: UnpackedFile[];
    chosen: { step: string; group: string; options: string[] }[];
    /** Ids chosen in a step the earlier choices left hidden. */
    ignoredChoices: string[];
    warnings: string[];
}

interface Numbered {
    step: FomodStep;
    index: number;
    groups: { group: FomodGroup; options: { option: FomodOption; id: string }[] }[];
}

type Flags = Map<string, string>;

export class FomodInstaller {
    private readonly steps: Numbered[];
    private readonly config: FomodConfig;
    /** The folder holding `fomod/`: the installer's paths start there. */
    private readonly base: string;
    /** Every file of the archive by its lower-case path. */
    private readonly byPath: Map<string, string>;

    constructor(private readonly listing: ArchiveListing, private readonly env: InstallEnvironment) {
        if (!listing.fomod) throw new Error('No FOMOD installer in this listing.');
        this.config = trimmedNames(listing.fomod.config);
        this.base = listing.fomod.path.split('/').slice(0, -2).join('/');
        this.byPath = new Map(listing.files.map(file => [file.toLowerCase(), file]));
        this.steps = ordered(this.config.steps, this.config.stepOrder, step => step.name).map((step, s) => ({
            step,
            index: s + 1,
            groups: ordered(step.groups, step.groupOrder, group => group.name).map((group, g) => ({
                group,
                options: ordered(group.options, group.order, option => option.name)
                    .map((option, o) => ({ option, id: `${s + 1}.${g + 1}.${o + 1}` }))
            }))
        }));
    }

    /** Whether there is anything to choose: a step with a group in it. */
    get asksQuestions(): boolean {
        return this.steps.some(step => step.groups.some(group => group.options.length > 0));
    }

    /** The steps as the first answer shows them: steps the load order hides left out, the rest numbered. */
    describe(): InstallerQuestions {
        const steps: StepQuestion[] = [];
        for (const { step, index, groups } of this.steps) {
            let shownWhen: string | undefined;
            if (step.visible) {
                const shown = this.explain(step.visible);
                if (shown === false) continue;
                if (shown !== true) shownWhen = shown;
            }
            steps.push({
                step: index,
                name: step.name,
                ...(shownWhen ? { shownWhen } : {}),
                groups: groups.map(({ group, options }) => {
                    const types = options.map(({ option }) => this.typeOf(option, undefined));
                    const defaults = defaultSelection(group.type, types);
                    return {
                        name: group.name,
                        choose: CHOOSE[group.type] ?? 'any',
                        options: options.map(({ option, id }, i) => ({
                            id,
                            name: option.name,
                            ...(option.description ? { description: cut(option.description) } : {}),
                            ...(defaults.has(i) ? { default: true as const } : {}),
                            ...(types[i] === 'Required' ? { required: true as const } : {}),
                            ...(types[i] === 'NotUsable' ? { notUsable: true as const } : {})
                        }))
                    };
                })
            });
        }
        return { name: this.config.moduleName, steps, ...(this.unmet() ? { warnings: [this.unmet()!] } : {}) };
    }

    /** What the choices install: required files, the chosen options' files, and the conditional ones. */
    plan(choices: readonly string[]): FomodPlan {
        const known = new Set(this.steps.flatMap(step => step.groups.flatMap(group => group.options.map(option => option.id))));
        const unknown = choices.filter(id => !known.has(id));
        if (unknown.length > 0) {
            throw new InstallError(
                `The installer has no option ${unknown.join(', ')}. Choose ids from installMod's first answer, ` +
                `like ${[...known].slice(0, 3).join(', ')}.`);
        }
        const chosenIds = new Set(choices);
        const flags: Flags = new Map();
        const files: FomodFile[] = [...this.config.requiredFiles];
        const chosen: FomodPlan['chosen'] = [];
        const ignoredChoices: string[] = [];

        for (const { step, groups } of this.steps) {
            if (step.visible && this.evaluate(step.visible, flags) === false) {
                ignoredChoices.push(...groups.flatMap(group => group.options.map(o => o.id)).filter(id => chosenIds.has(id)));
                continue;
            }
            for (const { group, options } of groups) {
                const types = options.map(({ option }) => this.typeOf(option, flags));
                const selected = this.select(group, options.map(o => o.id), types, chosenIds);
                options.forEach(({ option }, i) => {
                    if (selected.has(i)) {
                        files.push(...option.files);
                        for (const flag of option.flags) flags.set(flag.name, flag.value);
                    } else {
                        files.push(...option.files.filter(f => f.alwaysInstall || (f.installIfUsable && types[i] !== 'NotUsable')));
                    }
                });
                if (selected.size > 0) {
                    chosen.push({ step: step.name, group: group.name, options: options.filter((_, i) => selected.has(i)).map(o => o.option.name) });
                }
            }
        }
        for (const conditional of this.config.conditionalFiles) {
            if (!conditional.when || this.evaluate(conditional.when, flags) === true) files.push(...conditional.files);
        }

        const warnings: string[] = [];
        const unmet = this.unmet();
        if (unmet) warnings.push(unmet);
        return { files: this.place(files, warnings), chosen, ignoredChoices, warnings };
    }

    /** The indexes of a group's options the choices install, checked against the group's rule. */
    private select(group: FomodGroup, ids: string[], types: OptionType[], chosenIds: Set<string>): Set<number> {
        if (group.type === 'SelectAll') return new Set(types.map((_, i) => i));
        const picked = ids.map((id, i) => chosenIds.has(id) ? i : -1).filter(i => i >= 0);
        if (picked.length === 0) return defaultSelection(group.type, types);
        const where = `'${group.name}' (${ids[0].split('.').slice(0, 2).join('.')}.x)`;
        if ((group.type === 'SelectExactlyOne' || group.type === 'SelectAtMostOne') && picked.length > 1) {
            throw new InstallError(`${where} takes ${CHOOSE[group.type]} option; the choices name ${picked.map(i => ids[i]).join(' and ')}.`);
        }
        const unusable = picked.find(i => types[i] === 'NotUsable');
        if (unusable !== undefined) {
            throw new InstallError(`${ids[unusable]} '${group.options[unusable].name}' cannot be chosen with this load order. Choose another option of ${where}.`);
        }
        const required = types.map((type, i) => type === 'Required' ? i : -1).filter(i => i >= 0);
        if (group.type === 'SelectExactlyOne' || group.type === 'SelectAtMostOne') {
            const other = required.find(i => !picked.includes(i));
            if (other !== undefined) throw new InstallError(`${where} requires ${ids[other]} '${group.options[other].name}'; choose that one.`);
            return new Set(picked);
        }
        return new Set([...picked, ...required]);
    }

    /** An option's type: the first of its patterns that holds, else its default. Unknown flags count as unset. */
    private typeOf(option: FomodOption, flags: Flags | undefined): OptionType {
        for (const pattern of option.type.patterns ?? []) {
            if (!pattern.when || this.evaluate(pattern.when, flags ?? new Map()) === true) return pattern.type;
        }
        return option.type.default;
    }

    /** A warning when the installer says the mod needs what the instance lacks. */
    private unmet(): string | undefined {
        const needs = this.config.dependencies;
        if (!needs || this.evaluate(needs, new Map()) !== false) return undefined;
        const files = leaves(needs).filter((leaf): leaf is { file: string; state: string } => 'file' in leaf && leaf.state.toLowerCase() === 'active');
        return `The installer says this mod needs ${files.map(f => f.file).join(', ') || 'something this instance lacks'}` +
            `${files.length ? ' active' : ''}; it may not work without.`;
    }

    /**
     * True, false, or — when flags are not known yet — undefined. A flag never set is the empty string,
     * as the FOMOD schema has it.
     */
    private evaluate(condition: FomodCondition, flags: Flags | undefined): boolean | undefined {
        const results = condition.conditions.map(item => 'conditions' in item ? this.evaluate(item, flags) : this.leaf(item, flags));
        if (condition.operator.toLowerCase() === 'or') {
            if (results.some(r => r === true)) return true;
            return results.length === 0 || results.every(r => r === false) ? results.length === 0 : undefined;
        }
        if (results.some(r => r === false)) return false;
        return results.every(r => r === true) ? true : undefined;
    }

    private leaf(leaf: FomodLeaf, flags: Flags | undefined): boolean | undefined {
        if ('flag' in leaf) return flags ? (flags.get(leaf.flag) ?? '') === leaf.value : undefined;
        if ('file' in leaf) return this.env.fileState(leaf.file).toLowerCase() === leaf.state.toLowerCase();
        if ('game' in leaf) return !this.env.gameVersion || compareVersions(this.env.gameVersion, leaf.game) >= 0;
        if ('scriptExtender' in leaf) return this.env.scriptExtender;
        return true;
    }

    /**
     * A step's condition in words, the flags in it named by the options that set them — or true or
     * false when the load order alone decides it.
     */
    private explain(condition: FomodCondition): string | boolean {
        const parts = condition.conditions.map(item => 'conditions' in item
            ? this.explain(item)
            : 'flag' in item ? this.explainFlag(item.flag, item.value) : this.leaf(item, new Map()) === true);
        const or = condition.operator.toLowerCase() === 'or';
        // One false part decides an And, one true part an Or; the other kind says nothing.
        if (parts.some(part => part === or)) return or;
        const words = parts.filter((part): part is string => typeof part === 'string');
        if (words.length === 0) return or ? parts.length === 0 : true;
        if (words.length === 1) return words[0];
        return words.map(w => / (and|or) /.test(w) ? `(${w})` : w).join(or ? ' or ' : ' and ');
    }

    private explainFlag(flag: string, value: string): string | boolean {
        const setters = (wanted: (v: string) => boolean) => this.steps.flatMap(step => step.groups.flatMap(group =>
            group.options.filter(o => o.option.flags.some(f => f.name === flag && wanted(f.value))).map(o => o.id)));
        if (value === '') {
            const others = setters(v => v !== '');
            return others.length === 0 ? true : `none of ${others.join(', ')} is chosen`;
        }
        const ids = setters(v => v === value);
        if (ids.length === 0) return false;
        return ids.length === 1 ? `${ids[0]} is chosen` : `one of ${ids.join(', ')} is chosen`;
    }

    /**
     * The installer's files as files of the archive and places in the mod. Of two files for one place,
     * the higher priority wins, and of equals the later one; each folder keeps the first spelling.
     */
    private place(items: FomodFile[], warnings: string[]): UnpackedFile[] {
        const winners = new Map<string, { file: UnpackedFile; priority: number }>();
        for (const item of items) {
            const source = normalize(item.source);
            const destination = item.destination === null ? null : normalize(item.destination);
            const trailingSlash = item.destination !== null && /[\\/]$/.test(item.destination);
            const expanded: UnpackedFile[] = [];
            if (item.folder) {
                const start = `${join(this.base, source).toLowerCase()}/`;
                for (const [lower, file] of this.byPath) {
                    if (lower.startsWith(start)) expanded.push({ from: file, to: join(destination ?? source, file.slice(start.length)) });
                }
            } else {
                const file = this.byPath.get(join(this.base, source).toLowerCase());
                if (file) {
                    const name = path.posix.basename(source);
                    const to = destination === null ? source : destination === '' || trailingSlash ? join(destination, name) : destination;
                    expanded.push({ from: file, to });
                }
            }
            if (expanded.length === 0) {
                warnings.push(`The installer names ${item.folder ? 'a folder' : 'a file'} '${source}' that the downloaded file does not have; it was left out.`);
                continue;
            }
            for (const file of expanded) {
                if (file.to.split('/').includes('..')) {
                    warnings.push(`The installer would put '${file.from}' outside the mod folder; it was left out.`);
                    continue;
                }
                const key = file.to.toLowerCase();
                const held = winners.get(key);
                if (held && held.priority > item.priority) continue;
                winners.delete(key);
                winners.set(key, { file, priority: item.priority });
            }
        }
        return canonicalFolders([...winners.values()].map(winner => winner.file));
    }
}

/** Installers written by hand leave spaces around names; answers and messages carry them without. */
function trimmedNames(config: FomodConfig): FomodConfig {
    return {
        ...config,
        moduleName: config.moduleName.trim(),
        steps: config.steps.map(step => ({
            ...step,
            name: step.name.trim(),
            groups: step.groups.map(group => ({
                ...group,
                name: group.name.trim(),
                options: group.options.map(option => ({ ...option, name: option.name.trim() }))
            }))
        }))
    };
}

/** The installer's order: as written when `Explicit`, else by name — ascending unless it says descending. */
function ordered<T>(items: T[], order: string | null, name: (item: T) => string): T[] {
    const kind = (order ?? 'Ascending').toLowerCase();
    if (kind === 'explicit') return [...items];
    const sorted = [...items].sort((a, b) => name(a).localeCompare(name(b), 'en'));
    return kind === 'descending' ? sorted.reverse() : sorted;
}

/** What a group installs when the choices name none of its options, as Mod Organizer preselects it. */
function defaultSelection(type: string, types: OptionType[]): Set<number> {
    const all = types.map((t, i) => ({ t, i }));
    const usable = all.filter(o => o.t !== 'NotUsable');
    const of = (...wanted: OptionType[]) => usable.filter(o => wanted.includes(o.t)).map(o => o.i);
    switch (type) {
        case 'SelectAll':
            return new Set(all.map(o => o.i));
        case 'SelectExactlyOne':
            return new Set([of('Required')[0] ?? of('Recommended')[0] ?? usable[0]?.i].filter((i): i is number => i !== undefined));
        case 'SelectAtMostOne':
            return new Set([of('Required')[0] ?? of('Recommended')[0]].filter((i): i is number => i !== undefined));
        case 'SelectAtLeastOne': {
            const preferred = of('Required', 'Recommended');
            return new Set(preferred.length > 0 ? preferred : usable.slice(0, 1).map(o => o.i));
        }
        default:
            return new Set(of('Required', 'Recommended'));
    }
}

function leaves(condition: FomodCondition): FomodLeaf[] {
    return condition.conditions.flatMap(item => 'conditions' in item ? leaves(item) : [item]);
}

/** Each folder spelled the way its first file spells it: one folder on every system, as the game sees one. */
function canonicalFolders(files: UnpackedFile[]): UnpackedFile[] {
    const spelling = new Map<string, string>();
    return files.map(file => {
        const segments = file.to.split('/');
        let canonical = '';
        for (const segment of segments.slice(0, -1)) {
            const next = join(canonical, segment);
            const key = next.toLowerCase();
            if (!spelling.has(key)) spelling.set(key, next);
            canonical = spelling.get(key)!;
        }
        return { from: file.from, to: join(canonical, segments[segments.length - 1]) };
    });
}

/** `/` between folders, no leading `./` or `/`, no trailing `/`. */
function normalize(value: string): string {
    return value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

function cut(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > DESCRIPTION_LIMIT ? `${flat.slice(0, DESCRIPTION_LIMIT).trimEnd()}…` : flat;
}

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// ---------------------------------------------------------------- the mod's name

/**
 * The name a mod gets when the caller gives none: the Nexus mod's for its main file, the mod's and the
 * file's for any other — so a mod's optional file does not collide with its main one. Without a
 * record of the download, the file's name, with Nexus's `-<mod>-<version>-<time>` left off.
 */
export function defaultModName(meta: DownloadMeta, fileName: string): string {
    let name: string;
    if (meta.modName) {
        name = meta.category && meta.category !== 1 && meta.name && meta.name !== meta.modName ? `${meta.modName} - ${meta.name}` : meta.modName;
    } else {
        // Nexus names a file `<name>-<mod>-<version>-<time>`, and lately `<name> <mod> <version> <time> <tail>`.
        const base = fileName.replace(/\.(7z|zip|rar|tar|gz)$/i, '');
        const nexus = meta.modId ? [`-${meta.modId}-`, ` ${meta.modId} `].map(at => base.indexOf(at)).find(at => at > 0) : undefined;
        name = nexus !== undefined
            ? base.slice(0, nexus)
            : /^(.+?)-\d+-.+-\d{9,11}$/.exec(base)?.[1] ?? /^(.+?) \d+ \S+ \d{4}-\d\d-\d\dT\d\d-\d\dZ \S+$/.exec(base)?.[1] ?? base;
    }
    return folderName(name);
}

/** A name as a folder on every system: what Windows forbids replaced, no trailing dots or spaces. */
export function folderName(name: string): string {
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
}

// ---------------------------------------------------------------- after unpacking

/** A plugin's header, as the helper's pluginHeaders reads it. */
export interface PluginHeader {
    name: string;
    masters: string[];
    /** Master-flagged — or an .esm or .esl, which the game treats as one. */
    master: boolean;
}

/**
 * The order a mod's plugins join the end of the load order: master-flagged ones first, as the game
 * loads them, each after the plugins of the mod it needs, otherwise by name.
 */
export function pluginOrder(plugins: readonly PluginHeader[]): string[] {
    const isMaster = (plugin: PluginHeader) => plugin.master || /\.(esm|esl)$/i.test(plugin.name);
    const own = new Set(plugins.map(plugin => plugin.name.toLowerCase()));
    const placed = new Set<string>();
    const remaining = [...plugins].sort((a, b) => Number(isMaster(b)) - Number(isMaster(a)) || a.name.localeCompare(b.name, 'en'));
    const order: string[] = [];
    while (remaining.length > 0) {
        const ready = remaining.findIndex(plugin => plugin.masters.every(m => !own.has(m.toLowerCase()) || placed.has(m.toLowerCase())));
        // Plugins that need each other cannot both come first; they keep the order above.
        const [next] = remaining.splice(Math.max(ready, 0), 1);
        order.push(next.name);
        placed.add(next.name.toLowerCase());
    }
    return order;
}

/**
 * The mod's `meta.ini` as Mod Organizer writes one for a mod it installed (modinforegular.cpp): the
 * file it came from, and for a Nexus file the mod and file — what its update check and its link to the
 * mod page read. Amethyst reads the same file.
 */
export function modMetaIni(meta: DownloadMeta, fileName: string): string {
    const general: [string, string | number][] = [
        ['gameName', NEXUS_GAME.shortName], ['modid', meta.modId ?? 0], ['version', meta.version ?? ''],
        ['installationFile', fileName], ...(meta.modId ? [['repository', 'Nexus'] as [string, string]] : [])
    ];
    const lines = ['[General]', ...general.map(([key, value]) => `${key}=${encodeQtValue(String(value))}`)];
    if (meta.modId && meta.fileId) lines.push('', '[installedFiles]', `1\\modid=${meta.modId}`, `1\\fileid=${meta.fileId}`, 'size=1');
    return `${lines.join('\r\n')}\r\n`;
}
