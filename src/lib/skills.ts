import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT, RESOURCE_SCHEME } from './serverInfo.js';

/**
 * Agent skills bundled under skills/, discovered from disk and served the same
 * two ways as the guides: as MCP resources and through the readSkill tool.
 *
 * A "collection" is one directory under skills/ — here skills/Domain, the
 * modding skills; a cloned upstream repository works the same way. Inside it,
 * every directory containing a SKILL.md is one skill. The nesting between the
 * collection's own `skills/` folder and the skill can differ per collection
 * (some group skills by category), so discovery walks rather than assuming a
 * fixed depth.
 *
 * Nothing here is required at runtime: a missing skills/ directory simply means
 * no skills are offered.
 */

export interface Skill {
    /** Collection id, lower-cased directory name, e.g. 'development'. */
    collection: string;
    /** Directory name of the collection as it is on disk, e.g. 'Development'. */
    collectionDir: string;
    /** Grouping between the collection's skills/ folder and the skill, may be ''. */
    category: string;
    /** `name` from the SKILL.md frontmatter. */
    name: string;
    /** `description` from the frontmatter — what tells an agent when to use it. */
    description: string;
    /** Skill directory, relative to the repository root. */
    dir: string;
    /** Supporting files beside SKILL.md, relative to the skill directory. */
    files: string[];
}

/**
 * The skills of the record families, each with the records it covers: named where a model is about to
 * write records — the server's instructions and newProject's answer. Every authoring run that read its
 * family's skill passed in eval round 12; 26b skipped it in three of nine.
 */
export const FAMILY_SKILLS = [
    { skill: 'skyrim-modding-items-and-crafting', covers: 'weapons, armor, other items, their enchantments and recipes' },
    { skill: 'skyrim-modding-magic', covers: 'spells, magic effects and enchantments' },
    { skill: 'skyrim-modding-npcs', covers: 'NPCs' },
    { skill: 'skyrim-modding-leveled-lists', covers: 'leveled lists' }
] as const;

export const SKILL_URI_PREFIX = `${RESOURCE_SCHEME}://skills/`;

export const skillUri = (skill: Pick<Skill, 'collection' | 'name'>) =>
    `${SKILL_URI_PREFIX}${skill.collection}/${skill.name}`;

const ROOT = PROJECT_ROOT;
const SKILLS_ROOT = path.join(ROOT, 'skills');

/**
 * Minimal YAML front matter reader: the `key: value` pairs at the top level of
 * the leading `---` block. Enough for `name` and `description`, which is all a
 * SKILL.md is required to carry, and tolerant of quoting.
 */
export function parseFrontmatter(markdown: string): Record<string, string> {
    const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!block) return {};

    const fields: Record<string, string> = {};
    let current: string | undefined;

    for (const line of block[1].split(/\r?\n/)) {
        const pair = line.match(/^([A-Za-z][\w-]*):\s?(.*)$/);
        if (pair) {
            current = pair[1];
            fields[current] = pair[2].trim();
            continue;
        }
        // A folded continuation line belongs to the previous key.
        if (current && /^\s+\S/.test(line)) {
            fields[current] = `${fields[current]} ${line.trim()}`.trim();
        }
    }

    for (const key of Object.keys(fields)) {
        fields[key] = fields[key].replace(/^["'](.*)["']$/, '$1').trim();
    }
    return fields;
}

function walkForSkills(dir: string, onFound: (skillDir: string) => void): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
        onFound(dir);
        // A skill's own subdirectories are its supporting files, not more skills.
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            walkForSkills(path.join(dir, entry.name), onFound);
        }
    }
}

/** Supporting files beside SKILL.md, relative to the skill directory. */
function supportingFiles(skillDir: string): string[] {
    const found: string[] = [];
    const walk = (dir: string, prefix: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
            else if (entry.name !== 'SKILL.md') found.push(relative);
        }
    };
    walk(skillDir, '');
    return found.sort();
}

let cache: Skill[] | undefined;

/** Discovers every skill under skills/. Cached; call resetSkillCache() in tests. */
export function discoverSkills(): Skill[] {
    if (cache) return cache;

    const skills: Skill[] = [];
    let collections: fs.Dirent[];
    try {
        collections = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
    } catch {
        return (cache = []);
    }

    for (const collection of collections) {
        if (!collection.isDirectory() || collection.name.startsWith('.')) continue;

        // Prefer the collection's own skills/ folder; fall back to its root.
        const base = path.join(SKILLS_ROOT, collection.name);
        const inner = path.join(base, 'skills');
        const searchRoot = fs.existsSync(inner) ? inner : base;

        walkForSkills(searchRoot, skillDir => {
            let frontmatter: Record<string, string>;
            try {
                frontmatter = parseFrontmatter(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
            } catch {
                return;
            }

            const name = frontmatter.name || path.basename(skillDir);
            const category = path.relative(searchRoot, path.dirname(skillDir)).split(path.sep).join('/');

            skills.push({
                collection: collection.name.toLowerCase(),
                collectionDir: collection.name,
                category: category === '.' ? '' : category,
                name,
                description: frontmatter.description ?? '',
                dir: path.relative(ROOT, skillDir).split(path.sep).join('/'),
                files: supportingFiles(skillDir)
            });
        });
    }

    skills.sort((a, b) =>
        a.collection === b.collection
            ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
            : (a.collection < b.collection ? -1 : 1));

    return (cache = skills);
}

export function resetSkillCache(): void {
    cache = undefined;
}

export function findSkill(name: string, collection?: string): Skill | undefined {
    const wanted = String(name ?? '').trim().toLowerCase();
    const inCollection = collection ? String(collection).trim().toLowerCase() : undefined;
    return discoverSkills().find(s =>
        s.name.toLowerCase() === wanted && (!inCollection || s.collection === inCollection));
}

/** A text's words, each without a plural `s`, so `NPCs` and `npc` compare equal. */
const wordsOf = (text: string) =>
    text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3).map(word => word.replace(/s$/, ''));

/**
 * The skill a request means, also when it names it loosely — small models asked for `npc`, `weapon`,
 * and sent `items` as a collection (eval probes after round 11). An exact name wins; then the one skill
 * whose name holds every word asked for (`npc`, `items`); then the skill whose description holds them
 * all and names one earliest, since a description leads with what its skill covers (`weapon`).
 * Undefined when nothing matches, or two skills match equally well.
 */
export function resolveSkill(name: string, collection?: string): Skill | undefined {
    const exact = findSkill(name, collection);
    if (exact) return exact;

    const wanted = wordsOf(String(name ?? ''));
    if (!wanted.length) return undefined;
    const inCollection = collection ? String(collection).trim().toLowerCase() : undefined;
    const candidates = discoverSkills().filter(s => !inCollection || s.collection === inCollection);

    const byName = candidates.filter(s => wanted.every(word => wordsOf(s.name).includes(word)));
    if (byName.length === 1) return byName[0];

    const ranked = candidates
        .map(skill => {
            const words = wordsOf(skill.description);
            return { skill, at: wanted.every(word => words.includes(word)) ? Math.min(...wanted.map(word => words.indexOf(word))) : -1 };
        })
        .filter(c => c.at >= 0)
        .sort((a, b) => a.at - b.at);
    return ranked.length && (ranked.length === 1 || ranked[0].at < ranked[1].at) ? ranked[0].skill : undefined;
}

export function skillByUri(uri: string): Skill | undefined {
    if (!String(uri ?? '').startsWith(SKILL_URI_PREFIX)) return undefined;
    const [collection, ...rest] = String(uri).slice(SKILL_URI_PREFIX.length).split('/');
    return rest.length ? findSkill(rest.join('/'), collection) : undefined;
}

export class SkillFileError extends Error { }

/**
 * Reads SKILL.md, or one supporting file of the skill.
 *
 * `file` is resolved inside the skill directory and rejected if it escapes it —
 * the argument reaches this from a tool call, so '../../.env' must not resolve.
 */
export function readSkillFile(skill: Skill, file?: string): string {
    const skillDir = path.resolve(ROOT, skill.dir);
    const requested = file?.trim() ? file.trim() : 'SKILL.md';
    const full = path.resolve(skillDir, requested);

    const relative = path.relative(skillDir, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new SkillFileError(
            `'${requested}' is outside the skill directory. Ask for one of: ${skill.files.join(', ') || 'SKILL.md'}`
        );
    }

    try {
        return fs.readFileSync(full, 'utf8');
    } catch {
        throw new SkillFileError(
            `Skill '${skill.name}' has no file '${requested}'. Available: ` +
            `SKILL.md${skill.files.length ? `, ${skill.files.join(', ')}` : ''}`
        );
    }
}

export interface SkillCollectionSummary {
    collection: string;
    skillCount: number;
    categories: { category: string; skills: string[] }[];
}

/** Cheap top-level index: collections, their categories and skill names only. */
export function skillCollections(): SkillCollectionSummary[] {
    const byCollection = new Map<string, Skill[]>();
    for (const skill of discoverSkills()) {
        const list = byCollection.get(skill.collection) ?? [];
        list.push(skill);
        byCollection.set(skill.collection, list);
    }

    return [...byCollection.entries()].map(([collection, skills]) => {
        const byCategory = new Map<string, string[]>();
        for (const skill of skills) {
            const list = byCategory.get(skill.category) ?? [];
            list.push(skill.name);
            byCategory.set(skill.category, list);
        }
        return {
            collection,
            skillCount: skills.length,
            categories: [...byCategory.entries()]
                .map(([category, names]) => ({ category, skills: names.sort() }))
                .sort((a, b) => (a.category < b.category ? -1 : 1))
        };
    });
}
