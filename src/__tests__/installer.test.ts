import {
    FomodInstaller, InstallError, checkRoot, defaultModName, findDataRoot, placeInLoadOrder, plainLayout, topFolders,
    type ArchiveListing, type FileState, type FomodConfig, type FomodFile, type FomodOption, type InstallEnvironment, type PluginHeader
} from '../backend/skyrim/installer';

/**
 * What installMod decides on its own, before anything is written: where a plain archive's Data
 * folder is, what a FOMOD installer asks, and which file of the archive goes where for the choices
 * made. The archives are listings, as the helper answers them; the FOMOD installers are the helper's
 * JSON of `ModuleConfig.xml`.
 */

// ---------------------------------------------------------------- building installers

const file = (source: string, destination: string | null = null, extra: Partial<FomodFile> = {}): FomodFile =>
    ({ source, destination, folder: false, priority: 0, alwaysInstall: false, installIfUsable: false, ...extra });
const folder = (source: string, destination: string | null = null, extra: Partial<FomodFile> = {}): FomodFile =>
    ({ ...file(source, destination, extra), folder: true });
const option = (name: string, extra: Partial<FomodOption> = {}): FomodOption =>
    ({ name, description: '', files: [], flags: [], type: { default: 'Optional' }, ...extra });
const typed = (type: FomodOption['type']['default']) => ({ type: { default: type } });
const group = (name: string, type: string, options: FomodOption[], order: string | null = 'Explicit') => ({ name, type, order, options });
const step = (name: string, groups: ReturnType<typeof group>[], visible: FomodConfig['steps'][number]['visible'] = null) =>
    ({ name, visible, groupOrder: 'Explicit', groups });
const config = (steps: FomodConfig['steps'], extra: Partial<FomodConfig> = {}): FomodConfig =>
    ({ moduleName: 'Test Mod', dependencies: null, requiredFiles: [], stepOrder: 'Explicit', steps, conditionalFiles: [], ...extra });
const flagIs = (flag: string, value: string) => ({ operator: 'And' as const, conditions: [{ flag, value }] });

function environment(states: Record<string, FileState> = {}, extra: Partial<InstallEnvironment> = {}): InstallEnvironment {
    const lower = Object.fromEntries(Object.entries(states).map(([name, state]) => [name.toLowerCase(), state]));
    return { fileState: name => lower[name.toLowerCase()] ?? 'Missing', scriptExtender: false, gameVersion: '1.7.104.0', ...extra };
}

function installer(files: string[], fomod: FomodConfig, env = environment(), at = 'fomod/ModuleConfig.xml'): FomodInstaller {
    const listing: ArchiveListing = { files: [...files, at], fomod: { path: at, config: fomod } };
    return new FomodInstaller(listing, env);
}

const ids = (fomod: FomodInstaller) => fomod.describe().steps.flatMap(s => s.groups.flatMap(g => g.options.map(o => `${o.id} ${o.name}`)));
const destinations = (plan: { files: { to: string }[] }) => plan.files.map(f => f.to).sort();

// ---------------------------------------------------------------- plain archives

describe('the Data folder of an archive without an installer', () => {
    it('is the top when the top holds what Data holds — folders the game reads, plugins, archives, ini files', () => {
        expect(findDataRoot(['meshes/armor/a.nif', 'MyMod.esp', 'readme.txt'])).toBe('');
        expect(findDataRoot(['MyMod.esp', 'MyMod.bsa'])).toBe('');
        expect(findDataRoot(['SKSE/Plugins/Thing.dll'])).toBe('');
        expect(findDataRoot(['MyMod_DISTR.ini'])).toBe('');
        expect(findDataRoot(['TEXTURES/a.dds'])).toBe('');
    });

    it('is a Data folder, a single wrapper folder, or both — stray documents beside them do not count', () => {
        expect(findDataRoot(['Data/meshes/a.nif', 'Data/x.esp', 'readme.txt'])).toBe('Data');
        expect(findDataRoot(['MyMod 1.0/textures/a.dds', 'MyMod 1.0/x.esp', 'readme.txt'])).toBe('MyMod 1.0');
        expect(findDataRoot(['Wrap/Data/x.esp', 'Wrap/changelog.txt'])).toBe('Wrap/Data');
        // An installer folder holding only info.xml is not a second folder.
        expect(findDataRoot(['fomod/info.xml', 'Wrap/x.esp'])).toBe('Wrap');
    });

    it('is not guessed between folders that are options — the caller picks one with `root`', () => {
        const files = ['1K/textures/a.dds', '2K/textures/a.dds', 'readme.txt'];
        expect(findDataRoot(files)).toBeUndefined();
        expect(topFolders(files)).toEqual(['1K', '2K']);
        expect(checkRoot(files, '2k')).toBe('2K');
        expect(checkRoot(files, '/2K/')).toBe('2K');
        expect(() => checkRoot(files, '4K')).toThrow(/no folder '4K'.*1K, 2K/);
    });

    it('maps every file under the root to the mod folder, leaving the installer\'s own folder out', () => {
        const files = ['Wrap/x.esp', 'Wrap/meshes/a.nif', 'Wrap/fomod/info.xml', 'readme.txt'];
        expect(plainLayout(files, 'Wrap')).toEqual([
            { from: 'Wrap/x.esp', to: 'x.esp' },
            { from: 'Wrap/meshes/a.nif', to: 'meshes/a.nif' }
        ]);
        expect(plainLayout(['x.esp', 'fomod/info.xml'], '')).toEqual([{ from: 'x.esp', to: 'x.esp' }]);
    });
});

// ---------------------------------------------------------------- what a FOMOD installer asks

describe('what a FOMOD installer asks', () => {
    it('numbers each option by step, group and position, in the installer\'s own order', () => {
        const fomod = installer([], config([
            step('Main', [group('Pick', 'SelectExactlyOne', [option('Zeta'), option('Alpha')])]),
            step('Main', [group('Pick', 'SelectAny', [option('Again')])])
        ]));
        expect(ids(fomod)).toEqual(['1.1.1 Zeta', '1.1.2 Alpha', '2.1.1 Again']);
    });

    it('sorts by name where the installer sets no order — the schema\'s default is ascending', () => {
        const fomod = installer([], config([
            step('B', [group('Pick', 'SelectAny', [option('Zeta'), option('Alpha')], null)]),
            step('A', [group('Pick', 'SelectAny', [option('One')], 'Descending')])
        ], { stepOrder: null }));
        expect(fomod.describe().steps.map(s => s.name)).toEqual(['A', 'B']);
        expect(ids(fomod)).toEqual(['1.1.1 One', '2.1.1 Alpha', '2.1.2 Zeta']);
    });

    it('marks what the installer selects by default, as Mod Organizer does', () => {
        const fomod = installer([], config([step('Main', [
            group('One', 'SelectExactlyOne', [option('A'), option('B', typed('Recommended'))]),
            group('First usable', 'SelectExactlyOne', [option('X', typed('NotUsable')), option('Y'), option('Z')]),
            group('Any', 'SelectAny', [option('R', typed('Required')), option('Rec', typed('Recommended')), option('Opt')]),
            group('All', 'SelectAll', [option('P'), option('Q')])
        ])]));
        const groups = fomod.describe().steps[0].groups;
        const defaults = groups.map(g => g.options.filter(o => o.default).map(o => o.name));
        expect(defaults).toEqual([['B'], ['Y'], ['R', 'Rec'], ['P', 'Q']]);
        expect(groups.map(g => g.choose)).toEqual(['exactly one', 'exactly one', 'any', 'all']);
        expect(groups[1].options[0]).toEqual(expect.objectContaining({ name: 'X', notUsable: true }));
        expect(groups[2].options[0]).toEqual(expect.objectContaining({ name: 'R', required: true }));
    });

    it('decides an option\'s type from the load order where the installer makes it depend on a plugin', () => {
        const recommendedWithSkyUi = option('Patch', {
            type: {
                default: 'Optional',
                patterns: [{ when: { operator: 'And', conditions: [{ file: 'SkyUI_SE.esp', state: 'Active' }] }, type: 'Recommended' }]
            }
        });
        const fomod = (states: Record<string, FileState>) =>
            installer([], config([step('Main', [group('Patches', 'SelectAny', [recommendedWithSkyUi])])]), environment(states));
        expect(fomod({ 'skyui_se.esp': 'Active' }).describe().steps[0].groups[0].options[0].default).toBe(true);
        expect(fomod({}).describe().steps[0].groups[0].options[0].default).toBeUndefined();
    });

    it('leaves out a step the load order hides, and says which choices show one that depends on them', () => {
        const fomod = installer([], config([
            step('Body', [group('Body', 'SelectExactlyOne', [
                option('CBBE', { flags: [{ name: 'body', value: 'cbbe' }] }),
                option('3BA', { flags: [{ name: 'body', value: 'cbbe' }] }),
                option('UNP', { flags: [{ name: 'body', value: 'unp' }] })
            ])]),
            step('CBBE presets', [group('Preset', 'SelectAny', [option('Curvy')])], flagIs('body', 'cbbe')),
            step('SkyUI patch', [group('Patch', 'SelectAny', [option('Yes')])],
                { operator: 'And', conditions: [{ file: 'SkyUI_SE.esp', state: 'Active' }] })
        ]));
        const steps = fomod.describe().steps;
        expect(steps.map(s => s.name)).toEqual(['Body', 'CBBE presets']);
        expect(steps[1].shownWhen).toBe('one of 1.1.1, 1.1.2 is chosen');
        expect(steps[0].shownWhen).toBeUndefined();
    });

    it('names steps, groups and options without the spaces installers leave around them', () => {
        const fomod = installer([], config([step(' Main ', [group('Patches ', 'SelectAny', [option(' Island Hobbit Home')])])]));
        const asked = fomod.describe().steps[0];
        expect([asked.name, asked.groups[0].name, asked.groups[0].options[0].name]).toEqual(['Main', 'Patches', 'Island Hobbit Home']);
        expect(fomod.plan(['1.1.1']).chosen).toEqual([{ step: 'Main', group: 'Patches', options: ['Island Hobbit Home'] }]);
    });

    it('cuts long option descriptions — the mod page has the rest', () => {
        const fomod = installer([], config([step('Main', [group('G', 'SelectAny', [option('A', { description: 'x'.repeat(2000) })])])]));
        expect(fomod.describe().steps[0].groups[0].options[0].description!.length).toBeLessThanOrEqual(301);
    });

    it('asks nothing when it has no steps — the required files are the mod', () => {
        const fomod = installer(['Core/x.esp'], config([], { requiredFiles: [folder('Core', '')] }));
        expect(fomod.asksQuestions).toBe(false);
        expect(destinations(fomod.plan([]))).toEqual(['x.esp']);
    });
});

// ---------------------------------------------------------------- what it installs

describe('what a FOMOD installer installs', () => {
    const archive = [
        'Wrap/00 Core/meshes/a.nif', 'Wrap/00 Core/Core.esp',
        'Wrap/Opt A/A.esp', 'Wrap/Opt B/textures/b.dds', 'Wrap/Opt B/B.esp',
        'Wrap/Patches/SkyUI Patch.esp', 'Wrap/Extra/Extra.esp'
    ];
    const pick = (extra: Partial<FomodOption>[] = []) => step('Main', [group('Pick', 'SelectExactlyOne', [
        option('A', { files: [file('Opt A\\A.esp', 'A.esp')], ...typed('Recommended'), ...extra[0] }),
        option('B', { files: [folder('Opt B', '')], ...extra[1] })
    ])]);
    const at = 'Wrap/fomod/ModuleConfig.xml';

    it('installs the required files and the chosen options\', from paths relative to the installer\'s folder', () => {
        const fomod = installer(archive, config([pick()], { requiredFiles: [folder('00 Core', '')] }), environment(), at);
        expect(destinations(fomod.plan(['1.1.2']))).toEqual(['B.esp', 'Core.esp', 'meshes/a.nif', 'textures/b.dds']);
        expect(fomod.plan(['1.1.2']).files.find(f => f.to === 'B.esp')!.from).toBe('Wrap/Opt B/B.esp');
    });

    it('installs the defaults of every group the choices leave out — none at all installs them all', () => {
        const fomod = installer(archive, config([pick()]), environment(), at);
        const plan = fomod.plan([]);
        expect(destinations(plan)).toEqual(['A.esp']);
        expect(plan.chosen).toEqual([{ step: 'Main', group: 'Pick', options: ['A'] }]);
    });

    it('places files as the schema says: a folder without destination keeps its name, a file without one its path', () => {
        const fomod = installer(archive, config([], {
            requiredFiles: [
                folder('Opt B'),
                file('Patches/SkyUI Patch.esp'),
                file('Extra/Extra.esp', ''),
                file('Opt A/A.esp', 'optional\\')
            ]
        }), environment(), at);
        expect(destinations(fomod.plan([]))).toEqual(
            ['Extra.esp', 'Opt B/B.esp', 'Opt B/textures/b.dds', 'Patches/SkyUI Patch.esp', 'optional/A.esp']);
    });

    it('matches the installer\'s paths without regard to case or slash direction', () => {
        const fomod = installer(archive, config([], { requiredFiles: [file('opt a\\a.ESP', 'A.esp'), folder('OPT B/', 'b')] }), environment(), at);
        expect(destinations(fomod.plan([]))).toEqual(['A.esp', 'b/B.esp', 'b/textures/b.dds']);
    });

    it('refuses an id it does not have, two options in a one-option group, and an option that cannot be chosen', () => {
        const fomod = installer(archive, config([pick([{}, typed('NotUsable')])]), environment(), at);
        expect(() => fomod.plan(['3.1.1'])).toThrow(InstallError);
        expect(() => fomod.plan(['3.1.1'])).toThrow(/no option 3\.1\.1/i);
        expect(() => fomod.plan(['1.1.1', '1.1.2'])).toThrow(/exactly one/);
        expect(() => fomod.plan(['1.1.2'])).toThrow(/1\.1\.2 .*cannot be chosen/);
    });

    it('shows a step when an earlier choice sets its flag, and ignores choices in a step that stays hidden', () => {
        const fomod = installer(archive, config([
            pick([{ flags: [{ name: 'opt', value: 'A' }] }, { flags: [{ name: 'opt', value: 'B' }] }]),
            step('For A', [group('Extra', 'SelectAny', [option('Extra', { files: [file('Extra/Extra.esp', 'Extra.esp')] })])], flagIs('opt', 'A'))
        ]), environment(), at);
        expect(destinations(fomod.plan(['1.1.1', '2.1.1']))).toEqual(['A.esp', 'Extra.esp']);
        const hidden = fomod.plan(['1.1.2', '2.1.1']);
        expect(destinations(hidden)).toEqual(['B.esp', 'textures/b.dds']);
        expect(hidden.ignoredChoices).toEqual(['2.1.1']);
    });

    it('installs conditional files by the flags the choices set, and the plugins the load order has', () => {
        const fomod = installer(archive, config([pick([{ flags: [{ name: 'opt', value: 'A' }] }, {}])], {
            conditionalFiles: [
                { when: flagIs('opt', 'A'), files: [file('Extra/Extra.esp', 'Extra.esp')] },
                { when: { operator: 'And', conditions: [{ file: 'SkyUI_SE.esp', state: 'Active' }] }, files: [file('Patches/SkyUI Patch.esp', 'SkyUI Patch.esp')] }
            ]
        }), environment({ 'SkyUI_SE.esp': 'Active' }), at);
        expect(destinations(fomod.plan(['1.1.1']))).toEqual(['A.esp', 'Extra.esp', 'SkyUI Patch.esp']);
        expect(destinations(fomod.plan(['1.1.2']))).toEqual(['B.esp', 'SkyUI Patch.esp', 'textures/b.dds']);
    });

    it('installs an unchosen option\'s files marked to install always, or whenever usable', () => {
        const fomod = installer(archive, config([step('Main', [group('Any', 'SelectAny', [
            option('Picked', { files: [file('Opt A/A.esp', 'A.esp')] }),
            option('Always', { files: [file('Extra/Extra.esp', 'Extra.esp', { alwaysInstall: true })] }),
            option('Usable', { files: [file('Opt B/B.esp', 'B.esp', { installIfUsable: true })] }),
            option('Unusable', { ...typed('NotUsable'), files: [file('Patches/SkyUI Patch.esp', 'P.esp', { installIfUsable: true })] })
        ])])]), environment(), at);
        expect(destinations(fomod.plan(['1.1.1']))).toEqual(['A.esp', 'B.esp', 'Extra.esp']);
    });

    it('gives a destination two files claim to the higher priority, and between equals to the later one', () => {
        const fomod = installer(archive, config([], {
            requiredFiles: [
                file('Opt A/A.esp', 'Main.esp', { priority: 5 }),
                file('Opt B/B.esp', 'main.esp', { priority: 1 }),
                file('Extra/Extra.esp', 'Second.esp'),
                file('00 Core/Core.esp', 'Second.esp')
            ]
        }), environment(), at);
        const plan = fomod.plan([]);
        expect(plan.files.find(f => f.to.toLowerCase() === 'main.esp')!.from).toBe('Wrap/Opt A/A.esp');
        expect(plan.files.find(f => f.to === 'Second.esp')!.from).toBe('Wrap/00 Core/Core.esp');
    });

    it('spells each folder the way the first file put there spells it', () => {
        const fomod = installer(['Textures/a.dds', 'textures/b.dds', 'Opt/TEXTURES/c.dds'], config([], {
            requiredFiles: [file('Textures/a.dds'), file('textures/b.dds'), folder('Opt', '')]
        }));
        expect(destinations(fomod.plan([]))).toEqual(['Textures/a.dds', 'Textures/b.dds', 'Textures/c.dds']);
    });

    it('installs the rest, and warns, when the installer names a file the archive lacks or a place outside the mod', () => {
        const fomod = installer(archive, config([], {
            requiredFiles: [file('Opt A/A.esp', 'A.esp'), file('Missing/Gone.esp', 'Gone.esp'), file('Extra/Extra.esp', '../../Escape.esp')]
        }), environment(), at);
        const plan = fomod.plan([]);
        expect(destinations(plan)).toEqual(['A.esp']);
        expect(plan.warnings.join(' ')).toMatch(/Missing\/Gone\.esp/);
        expect(plan.warnings.join(' ')).toMatch(/outside the mod folder/);
    });
});

// ---------------------------------------------------------------- the mod's name

describe('the name a mod gets', () => {
    it('is the Nexus mod\'s name for its main file, and names an other file after both', () => {
        expect(defaultModName({ modName: 'SkyUI', name: 'SkyUI_5_2_SE', category: 1 }, 'SkyUI_5_2_SE-12604-5-2SE.7z')).toBe('SkyUI');
        expect(defaultModName({ modName: 'SkyUI', name: 'SkyUI Patch', category: 3 }, 'x.7z')).toBe('SkyUI - SkyUI Patch');
    });

    it('comes from the file name without a record of the download, Nexus\'s number and version left off', () => {
        expect(defaultModName({}, 'Aura\'s Inventory Tweaks-68557-4-5-0-1713935718.zip')).toBe('Aura\'s Inventory Tweaks');
        expect(defaultModName({ modId: 12604 }, 'SkyUI_5_2_SE-12604-5-2SE-1600000000.7z')).toBe('SkyUI_5_2_SE');
        expect(defaultModName({}, 'my_mod.rar')).toBe('my_mod');
        // Nexus's newer scheme: name, mod, version, upload time, a random tail.
        expect(defaultModName({}, 'SSE Display Tweaks 34705 0.5.25 2026-08-29T20-20Z QRde31FV2.zip')).toBe('SSE Display Tweaks');
        expect(defaultModName({ modId: 51073 }, 'powerofthree\'s Tweaks 51073 1.17.1 2026-08-25T00-11Z zYsEpQvXg.7z')).toBe('powerofthree\'s Tweaks');
    });

    it('holds nothing a folder name cannot', () => {
        expect(defaultModName({ modName: 'What: A "Mod"?' }, 'x.7z')).toBe('What_ A _Mod__');
        expect(defaultModName({ modName: 'Trailing. ' }, 'x.7z')).toBe('Trailing');
    });
});

describe('where a mod\'s plugins join the load order', () => {
    const header = (name: string, masters: string[] = ['Skyrim.esm']): PluginHeader => ({ name, masters, master: /\.esm$/i.test(name) });
    const ORDER = ['Skyrim.esm', 'Update.esm', 'Other.esp', 'Needs Cool.esp', 'Last.esp'];

    it('puts a plugin no active plugin needs at the end', () => {
        expect(placeInLoadOrder(ORDER, [header('Cool.esp')], new Map())).toEqual({ before: new Map(), warnings: [] });
    });

    it('puts a plugin right before the first active plugin that needs it as a master, in any letter case', () => {
        const needs = new Map([['needs cool.esp', ['Skyrim.esm', 'cool.ESP']], ['last.esp', ['Cool.esp']]]);
        expect(placeInLoadOrder(ORDER, [header('Cool.esp')], needs)).toEqual({ before: new Map([['cool.esp', 'Needs Cool.esp']]), warnings: [] });
    });

    it('places a mod\'s plugins one after another, each after its own masters', () => {
        const needs = new Map([['needs cool.esp', ['Cool.esm', 'Cool - Extra.esp']]]);
        const placed = placeInLoadOrder(ORDER, [header('Cool.esm'), header('Cool - Extra.esp', ['Cool.esm']), header('Cool - Patch.esp')], needs);
        expect(placed).toEqual({ before: new Map([['cool.esm', 'Needs Cool.esp'], ['cool - extra.esp', 'Needs Cool.esp']]), warnings: [] });
    });

    it('leaves a plugin already in the load order where it is', () => {
        const needs = new Map([['last.esp', ['Other.esp']]]);
        expect(placeInLoadOrder(ORDER, [header('Other.esp')], needs).before.size).toBe(0);
    });

    it('puts a plugin whose own masters load after the plugin needing it at the end, and says so', () => {
        const needs = new Map([['other.esp', ['Cool.esp']]]);
        const placed = placeInLoadOrder(ORDER, [header('Cool.esp', ['Skyrim.esm', 'Last.esp'])], needs);
        expect(placed.before.size).toBe(0);
        expect(placed.warnings).toEqual([expect.stringMatching(/Cool\.esp loads at the end, after Other\.esp, which needs it.*Last\.esp.*LOOT/)]);
    });
});
