import { SkillsHandlers } from '../handlers/SkillsHandlers';
import type { AppBackend } from '../backend/index';
import {
    SKILL_URI_PREFIX,
    SkillFileError,
    discoverSkills,
    findSkill,
    parseFrontmatter,
    readSkillFile,
    skillByUri,
    skillUri
} from '../lib/skills';

/**
 * The bundled skills, served as resources and through readSkill. Like the guide
 * tests, these read the real skills/ directory: what ships is what is served.
 */

describe('parseFrontmatter', () => {
    it('reads top-level key: value pairs, unquoted', () => {
        expect(parseFrontmatter('---\nname: tdd\ndescription: "Test first."\n---\nbody'))
            .toEqual({ name: 'tdd', description: 'Test first.' });
    });

    it('folds a continuation line into the previous key', () => {
        expect(parseFrontmatter('---\ndescription: one\n  two\n---\n').description).toBe('one two');
    });

    it('answers {} for a document without frontmatter', () => {
        expect(parseFrontmatter('# just a heading')).toEqual({});
    });
});

describe('discoverSkills', () => {
    const skills = discoverSkills();
    const example = findSkill('skyrim-modding-basics', 'domain');

    it('finds the vendored example skill, with its supporting files', () => {
        expect(example).toBeDefined();
        expect(example!.collection).toBe('domain');
        expect(example!.description.length).toBeGreaterThan(40);
        expect(example!.files).toContain('REFERENCE.md');
    });

    it('gives every skill a name and a description, which is what makes it findable', () => {
        for (const skill of skills) {
            expect(`${skill.dir}: ${!!skill.name}`).toBe(`${skill.dir}: true`);
            expect(`${skill.dir}: ${skill.description.length > 0}`).toBe(`${skill.dir}: true`);
        }
    });

    it('round-trips every skill through its resource uri', () => {
        for (const skill of skills) {
            expect(skillUri(skill).startsWith(SKILL_URI_PREFIX)).toBe(true);
            expect(skillByUri(skillUri(skill))).toEqual(skill);
        }
        expect(skillByUri('file:///etc/passwd')).toBeUndefined();
    });
});

describe('readSkillFile', () => {
    const example = () => findSkill('skyrim-modding-basics')!;

    it('reads SKILL.md by default and a supporting file on request', () => {
        expect(readSkillFile(example())).toMatch(/^---/);
        expect(readSkillFile(example(), 'REFERENCE.md').length).toBeGreaterThan(0);
    });

    it('refuses a path that escapes the skill directory', () => {
        // The argument arrives from a tool call, so '../../.env' must not resolve.
        expect(() => readSkillFile(example(), '../../../package.json')).toThrow(SkillFileError);
        expect(() => readSkillFile(example(), '../../../package.json')).toThrow(/outside the skill directory/);
    });

    it('names what is available when the file does not exist', () => {
        expect(() => readSkillFile(example(), 'nope.md')).toThrow(/Available: SKILL.md, REFERENCE.md, TOOLS.md/);
    });
});

describe('readSkill', () => {
    const run = async (args: any) => {
        const envelope = await new SkillsHandlers(undefined as unknown as AppBackend).handle('readSkill', args);
        return JSON.parse(envelope.content[0].text);
    };

    it('answers the cheap index with no arguments, and a hint that names a real skill', async () => {
        const payload = await run({});
        expect(payload.collections.map((c: any) => c.collection)).toContain('domain');
        // The hint is built from what is installed, never from what might be.
        const named = /"skill":"([^"]+)"/.exec(payload.hint)![1];
        expect(findSkill(named)).toBeDefined();
    });

    it('describes one collection', async () => {
        const payload = await run({ collection: 'domain' });
        expect(payload.skills.map((s: any) => s.name)).toContain('skyrim-modding-basics');
        expect(payload.skills[0].description).toBeTruthy();
    });

    it('reads one skill and one of its files', async () => {
        expect((await run({ skill: 'skyrim-modding-basics' })).content).toMatch(/FormID/);
        expect((await run({ skill: 'skyrim-modding-basics', file: 'REFERENCE.md' })).file)
            .toBe('REFERENCE.md');
    });

    it('turns a bad request into an argument error, not a fault', async () => {
        await expect(run({ skill: 'no-such-skill' })).rejects.toThrow(/no skill 'no-such-skill'/);
        await expect(run({ collection: 'nope' })).rejects.toThrow(/no collection 'nope'/);
        await expect(run({ file: 'x.md' })).rejects.toThrow(/without a skill/);
        await expect(run({ skill: 'skyrim-modding-basics', file: '../../../.env' })).rejects.toThrow(/outside/);
    });
});
