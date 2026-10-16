#!/usr/bin/env node
/**
 * Measures how well a local model drives this server: a fixed set of modding tasks, run through the
 * BUILT server against the configured instance, with a model served by Ollama.
 *
 *   npm run build
 *   node scripts/eval-ollama.mjs [--model gemma4:26b] [--profile all] [--runs 3] [--tasks find,read]
 *                                [--ctx 131072] [--max-turns 25] [--think true|false] [--out <file>]
 *                                [--with-skills] [--detailed] [--ollama http://localhost:11434]
 *
 * --with-skills runs each authoring task again as `<task>+skill`, the conversation starting with the
 * task's skill already read — a readSkill call the harness makes and puts in as the model's, left out of
 * the counts. The plain task measures whether a model finds a skill, this one what the skill's content
 * does once read. --detailed runs each again as `<task>+detailed`, with a prompt that spells out what a
 * player who knows the game would ask for — stats, the vanilla thing it is like, the level — but no
 * editor IDs; the checks stay the same, so the three compare.
 *
 * It is its own minimal client — Ollama's /api/chat and an agent loop, nothing in between — so what
 * is measured is the server and the model, not a client's prompt. The model gets the server's tools
 * and `instructions`, plus four file tools (list_directory, read_file, write_file, edit_file) confined
 * to a fresh projects folder: the server expects records to be edited with the client's own file
 * tools, the way a filesystem MCP server offers them to ollmcp or oterm.
 *
 * Nothing is deployed. `deployProject` stays listed, so the tool list is the one a client sees, but a
 * call to it is refused and counted. The server's projects folder is a temporary one, emptied before
 * each run; the instance is only read.
 *
 * Every task is checked against the instance itself: the expected FormIDs and values are read through
 * the server at startup, not written into this file. The full record — every call, its arguments and
 * what came back — goes to --out as JSON; a summary is printed, with the entry for the log of every
 * round, docs/research/local-model-evals.md (also saved beside the JSON as .md). After the tasks it
 * measures the model's prompt and generation speed at the same context, for that entry.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: opt } = parseArgs({
    options: {
        model: { type: 'string', default: 'gemma4:26b' },
        profile: { type: 'string', default: 'all' },
        runs: { type: 'string', default: '3' },
        tasks: { type: 'string' },
        ctx: { type: 'string', default: '131072' },
        'max-turns': { type: 'string', default: '25' },
        think: { type: 'string' },
        out: { type: 'string' },
        'with-skills': { type: 'boolean', default: false },
        detailed: { type: 'boolean', default: false },
        ollama: { type: 'string', default: process.env.OLLAMA_HOST || 'localhost' }
    }
});

/**
 * OLLAMA_HOST is often the address Ollama binds to — `0.0.0.0`, no scheme, no port — so it is read
 * the way Ollama's own CLI reads it.
 */
function ollamaUrl(raw) {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `http://${raw}`);
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
    if (!url.port && !/:\d+/.test(raw)) url.port = '11434';
    return url.origin;
}

const RUNS = Number(opt.runs);
const NUM_CTX = Number(opt.ctx);
const MAX_TURNS = Number(opt['max-turns']);
const OLLAMA = ollamaUrl(opt.ollama);
const THINK = opt.think === undefined ? undefined : opt.think === 'true';
/** One model turn may take minutes when the model does not fit the GPU. */
const TURN_TIMEOUT_MS = 20 * 60_000;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.resolve(opt.out ?? path.join(os.tmpdir(), 'skyrim-eval',
    `${stamp}-${opt.model.replace(/[^\w.-]/g, '_')}-${opt.profile}.json`));
fs.mkdirSync(path.dirname(outFile), { recursive: true });

function fail(message) {
    console.error(`eval: ${message}`);
    process.exit(1);
}

if (!fs.existsSync(path.join(root, 'dist', 'index.js'))) fail('dist/index.js is missing — run npm run build first.');

// --- Ollama -------------------------------------------------------------------------------------

async function ollama(route, body) {
    const response = await fetch(`${OLLAMA}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Ollama ${route} answered ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
}

const tags = await ollama('/api/tags').catch(error => fail(`Ollama is not reachable at ${OLLAMA}: ${error.message}`));
if (!tags.models.some(m => m.name === opt.model || m.model === opt.model)) {
    fail(`Ollama has no model '${opt.model}'. Pulled: ${tags.models.map(m => m.name).join(', ')}.`);
}

// --- The server ---------------------------------------------------------------------------------

const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-projects-'));
const serverLog = outFile.replace(/\.json$/, '.server.log');
const logStream = fs.createWriteStream(serverLog);

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'dist', 'index.js')],
    cwd: root,
    // The instance comes from the repository's .env, which the server loads itself; dotenv never
    // overrides what is set here.
    env: { ...process.env, MCP_TRANSPORT: 'stdio', MCP_PROFILE: opt.profile, SKYRIM_PROJECTS_DIR: projectsDir },
    stderr: 'pipe'
});
transport.stderr?.pipe(logStream);
const client = new Client({ name: 'eval-ollama', version: '1.0.0' });
await client.connect(transport);

const instructions = client.getInstructions() ?? '';
const { tools: serverTools } = await client.listTools();
const serverToolNames = new Set(serverTools.map(t => t.name));

/** One call through the server, as text — what a client hands the model. */
async function callServer(name, args) {
    try {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content ?? []).map(part => part.text ?? '').join('');
        let code;
        if (result.isError) {
            try { code = JSON.parse(text).code; } catch { /* not JSON */ }
        }
        return { text, isError: !!result.isError, code };
    } catch (error) {
        return { text: `Error: ${error.message}`, isError: true, code: error.code };
    }
}

async function callServerJson(name, args) {
    const { text, isError } = await callServer(name, args);
    if (isError) throw new Error(`${name} ${JSON.stringify(args)} failed: ${text}`);
    return JSON.parse(text);
}

// --- Ground truth, from the instance ------------------------------------------------------------

function stat(yaml, name) {
    const value = new RegExp(`^\\s+${name}:\\s*([\\d.]+)\\s*$`, 'm').exec(yaml)?.[1];
    if (value === undefined) fail(`could not read ${name} from the record text`);
    return Number(value);
}

async function weapon(editorId) {
    const read = await callServerJson('readRecord', { record: editorId });
    const yaml = read.versions[0].files.map(f => f.text).join('\n');
    return { formId: read.formId, editorId, damage: stat(yaml, 'Damage'), weight: stat(yaml, 'Weight') };
}

console.log(`eval: ${opt.model} @ num_ctx ${NUM_CTX}, profile ${opt.profile}, ${RUNS} run(s) per task`);
console.log('eval: reading the ground truth from the instance (the first lookup builds the index)…');
const truth = {
    ironSword: await weapon('IronSword'),
    steelSword: await weapon('SteelSword'),
    nordRace: (await callServerJson('findRecords', { records: ['NordRace'], limit: 1 })).records[0]?.formId
        ?? fail('the instance has no NordRace')
};

// --- File tools, confined to the projects folder ------------------------------------------------

const FILE_TOOLS = [
    {
        name: 'list_directory',
        description: `List the files and folders in a directory of the projects folder (${projectsDir}).`,
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'An absolute path inside the projects folder, or one relative to it. "." is the projects folder.' } },
            required: ['path']
        }
    },
    {
        name: 'read_file',
        description: 'Read a text file in the projects folder.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'An absolute path inside the projects folder, or one relative to it.' } },
            required: ['path']
        }
    },
    {
        name: 'write_file',
        description: 'Create or overwrite a text file in the projects folder with the given content.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'An absolute path inside the projects folder, or one relative to it.' },
                content: { type: 'string', description: 'The whole new content of the file.' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'edit_file',
        description: 'Replace one exact piece of text in a file in the projects folder. old_text must occur exactly once.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'An absolute path inside the projects folder, or one relative to it.' },
                old_text: { type: 'string', description: 'The text to replace, copied exactly from the file.' },
                new_text: { type: 'string', description: 'What to put in its place.' }
            },
            required: ['path', 'old_text', 'new_text']
        }
    }
];
const fileToolNames = new Set(FILE_TOOLS.map(t => t.name));

function insideProjects(raw) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error("'path' is required.");
    const resolved = path.resolve(projectsDir, raw.trim());
    const relative = path.relative(projectsDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`'${raw}' is outside the projects folder ${projectsDir}.`);
    }
    return resolved;
}

function runFileTool(name, args) {
    const file = insideProjects(args?.path);
    switch (name) {
        case 'list_directory':
            return fs.readdirSync(file, { withFileTypes: true })
                .map(entry => `${entry.isDirectory() ? '[DIR] ' : '[FILE]'} ${entry.name}`).join('\n') || '(empty)';
        case 'read_file':
            return fs.readFileSync(file, 'utf8');
        case 'write_file':
            if (typeof args.content !== 'string') throw new Error("'content' must be a string.");
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, args.content);
            return `Wrote ${Buffer.byteLength(args.content)} bytes to ${file}.`;
        case 'edit_file': {
            const text = fs.readFileSync(file, 'utf8');
            const count = typeof args.old_text === 'string' && args.old_text ? text.split(args.old_text).length - 1 : 0;
            if (count !== 1) throw new Error(`old_text occurs ${count} times in ${file}; it must occur exactly once.`);
            fs.writeFileSync(file, text.replace(args.old_text, () => String(args.new_text ?? '')));
            return `Edited ${file}.`;
        }
    }
}

// --- Tasks --------------------------------------------------------------------------------------

function filesUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(entry => entry.isFile())
        .map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
}

/** The text of the project's copy of a record, found by its FormKey. */
function recordText(project, formId) {
    for (const file of filesUnder(path.join(projectsDir, project, 'plugin'))) {
        if (!file.endsWith('.yaml')) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (text.includes(`FormKey: ${formId}`)) return text;
    }
    return undefined;
}

/**
 * Every record file of a project, with its group folder (`weapons`, `spells`, `npcs`…) and FormKey, and
 * the project's own plugin. After a build, a new record's FormKey names that plugin; an override's
 * names the plugin it comes from.
 */
function projectRecords(project) {
    const pluginDir = path.join(projectsDir, project, 'plugin');
    const header = path.join(pluginDir, 'RecordData.yaml');
    const plugin = fs.existsSync(header) ? /^ModKey:\s*(.+?)\s*$/m.exec(fs.readFileSync(header, 'utf8'))?.[1] : undefined;
    const records = filesUnder(pluginDir).filter(file => file.endsWith('.yaml') && file !== header).map(file => {
        const text = fs.readFileSync(file, 'utf8');
        return { group: path.relative(pluginDir, file).split(path.sep)[0].toLowerCase(), text, formKey: /^FormKey:\s*(\S+)/m.exec(text)?.[1] };
    });
    return { plugin, records };
}

/** The records of one group that the project's own plugin defines — new ones, not overrides. */
function newRecords(project, group) {
    const { plugin, records } = projectRecords(project);
    return records.filter(r => r.group === group && plugin && r.formKey?.toLowerCase().endsWith(`:${plugin.toLowerCase()}`));
}

/**
 * A record's in-game name, as Spriggit writes it (Name → Value), in YAML's flow style
 * (`Name: { TargetLanguage: English, Value: Hilda }`, which the build reads too), or as a plain string.
 */
function nameOf(text) {
    const nested = /^Name:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+Value:[ \t]*(.+?)[ \t]*\r?$/m.exec(text)?.[1];
    const flow = /^Name:[ \t]*\{[^}]*?\bValue:[ \t]*([^,}]+?)[ \t]*[,}]/m.exec(text)?.[1];
    const inline = /^Name:[ \t]*(\S.*?)[ \t]*\r?$/m.exec(text)?.[1];
    return (nested ?? flow ?? inline ?? '').replace(/^['"]|['"]$/g, '');
}

/** Whether a record's flags list one, as a block list (`- Female`) or a flow list (`Flags: [Female, Unique]`). */
const hasFlag = (text, flag) =>
    new RegExp(`^[ \\t]+- ${flag}[ \\t]*\\r?$`, 'm').test(text) || new RegExp(`Flags:[ \\t]*\\[[^\\]]*\\b${flag}\\b`).test(text);

/** The magic effects a spell or an enchantment lists. */
const effectsOf = text => [...text.matchAll(/BaseEffect:[ \t]*([0-9A-Fa-f]{6}:\S+)/g)].map(m => m[1]);

/** A record's text wherever it is: written in the project, or in the load order (read through the server). */
async function recordAnywhere(project, formKey) {
    const own = projectRecords(project).records.find(r => r.formKey?.toLowerCase() === formKey.toLowerCase());
    if (own) return own.text;
    try {
        const read = await callServerJson('readRecord', { record: formKey });
        return read.versions[0].files.map(f => f.text).join('\n');
    } catch {
        return '';
    }
}

/** The magic effects behind a spell or an enchantment, as text, wherever each is. */
async function effectTexts(project, text) {
    return Promise.all(effectsOf(text).map(effect => recordAnywhere(project, effect)));
}

/** Built: buildProject succeeded, and the project's build folder holds a plugin. */
const builtProject = (project, calls) =>
    calls.some(c => c.name === 'buildProject' && !c.isError) &&
    filesUnder(path.join(projectsDir, project, 'build')).some(f => /\.es[pml]$/i.test(f));

/** A number standing on its own: 7 in "damage 7." but not in "012EB7" or "7.5". */
const has = (text, value) => new RegExp(`(^|[^\\w.])${String(value).replace(/\./g, '\\.')}(?![\\w]|\\.\\d)`, 'i').test(text);

/** A FormID's local part however it is written: 012EB7, 00012EB7, 0x00012EB7. */
const hasFormId = (text, formId) =>
    new RegExp(`(^|[^0-9a-f])(0x)?0*${formId.split(':')[0].replace(/^0+/, '')}(?![0-9a-f])`, 'i').test(text);

const TASKS = [
    {
        id: 'find',
        prompt: 'Which plugin defines the Iron Sword, and what is its FormID?',
        check: ({ answer }) => ({
            formId: hasFormId(answer, truth.ironSword.formId),
            plugin: /skyrim\.esm/i.test(answer)
        })
    },
    {
        id: 'read',
        prompt: 'How much damage does the Iron Sword do in my load order, and how much does it weigh?',
        check: ({ answer }) => ({
            damage: has(answer, truth.ironSword.damage),
            weight: has(answer, truth.ironSword.weight)
        })
    },
    {
        id: 'filter',
        prompt: 'List three pieces of armor that Dawnguard.esm adds, each with its FormID.',
        check: async ({ answer }) => {
            const ids = [...new Set([...answer.matchAll(/\b([0-9A-F]{6}):Dawnguard\.esm\b/gi)]
                .map(m => `${m[1].toUpperCase()}:Dawnguard.esm`))];
            let armor = 0;
            if (ids.length) {
                const found = await callServerJson('findRecords', { records: ids, limit: 200 });
                armor = found.records.filter(r => r.signature === 'ARMO' && r.definedIn === 'Dawnguard.esm').length;
            }
            return { threeFormIds: ids.length >= 3, allArmorFromDawnguard: ids.length >= 3 && armor === ids.length };
        }
    },
    {
        id: 'patch',
        prompt: 'Make a patch mod called IronSwordBuff that raises the Iron Sword\'s damage to 12. ' +
            'Leave everything else about the sword as it is. Do not build or deploy it yet.',
        check: () => {
            const text = recordText('IronSwordBuff', truth.ironSword.formId) ?? '';
            return {
                recordInProject: !!text,
                damage12: /^\s+Damage:\s*12\s*$/m.test(text),
                restKept: text.includes('EditorID: IronSword') &&
                    new RegExp(`^\\s+Weight:\\s*${truth.ironSword.weight}\\s*$`, 'm').test(text)
            };
        }
    },
    {
        id: 'build',
        prompt: 'Make a patch mod called SteelSwordLight in which the Steel Sword weighs 5, and build it. Do not deploy it.',
        check: ({ calls }) => {
            const text = recordText('SteelSwordLight', truth.steelSword.formId) ?? '';
            const built = filesUnder(path.join(projectsDir, 'SteelSwordLight', 'build')).some(f => /\.es[pml]$/i.test(f));
            return {
                recordInProject: !!text,
                weight5: /^\s+Weight:\s*5\s*$/m.test(text),
                built: built && calls.some(c => c.name === 'buildProject' && !c.isError)
            };
        }
    },
    // Authoring: new records written by hand into a new project, following vanilla ones, and built.
    {
        id: 'sword',
        skill: 'items-and-crafting',
        prompt: 'Make a new mod called FlameBlade with a new one-handed sword named "Flame Blade" that has a fire ' +
            'damage enchantment, so it burns what it hits. Build it, but do not deploy it.',
        detailed: 'Make a new mod called FlameBlade with a new one-handed sword named "Flame Blade". Make it like the ' +
            'Iron Sword — its model, sounds and weapon type — but with 12 damage, a weight of 10 and a value of 150. Give ' +
            'it a new enchantment of its own, named "Flame Blade Burn", that deals 10 points of fire damage to whatever it ' +
            'hits, with a charge of 500. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const sword = newRecords('FlameBlade', 'weapons').find(r => /^flame blade$/i.test(nameOf(r.text)));
            const enchantment = sword && /^ObjectEffect:[ \t]*(\S+)/m.exec(sword.text)?.[1];
            const effects = enchantment ? await effectTexts('FlameBlade', await recordAnywhere('FlameBlade', enchantment)) : [];
            return {
                newSword: !!sword,
                oneHandedSword: !!sword && (/AnimationType:[ \t]*OneHandSword/.test(sword.text) || sword.text.includes('01E711:Skyrim.esm')),
                fireEnchantment: effects.some(text => /^ResistValue:[ \t]*ResistFire[ \t]*\r?$/m.test(text)),
                built: builtProject('FlameBlade', calls)
            };
        }
    },
    {
        id: 'spell',
        skill: 'magic',
        prompt: 'Make a new mod called StormBolt with a new Destruction spell named "Storm Bolt" that deals shock ' +
            'damage to a target. Build it, but do not deploy it.',
        detailed: 'Make a new mod called StormBolt with a new Destruction spell named "Storm Bolt": an Apprentice-level, ' +
            'fire-and-forget bolt aimed at the target, like Lightning Bolt, that deals 40 points of shock damage and costs ' +
            '60 magicka. No spell tome is needed. Build it, but do not deploy it.',
        check: async ({ calls }) => {
            const spell = newRecords('StormBolt', 'spells').find(r => /^storm bolt$/i.test(nameOf(r.text)));
            const effects = spell ? await effectTexts('StormBolt', spell.text) : [];
            return {
                newSpell: !!spell,
                destruction: effects.some(text => /^MagicSkill:[ \t]*Destruction[ \t]*\r?$/m.test(text)),
                shock: effects.some(text => /^ResistValue:[ \t]*ResistShock[ \t]*\r?$/m.test(text)),
                built: builtProject('StormBolt', calls)
            };
        }
    },
    {
        id: 'npc',
        skill: 'npcs',
        prompt: 'Make a new mod called HildaTheNord with one new NPC: a female Nord named "Hilda". Build it, but do ' +
            'not deploy it.',
        detailed: 'Make a new mod called HildaTheNord with one new NPC: a woman of the Nord race named "Hilda", a ' +
            'one-handed warrior with a Nord woman\'s voice, whose level follows the player\'s between 5 and 30, dressed in ' +
            'iron armor. Build it, but do not deploy it.',
        check: ({ calls }) => {
            const npc = newRecords('HildaTheNord', 'npcs').find(r => /^hilda$/i.test(nameOf(r.text)));
            const race = npc && /^Race:[ \t]*(\S+)/m.exec(npc.text)?.[1];
            return {
                newNpc: !!npc,
                nord: race?.toLowerCase() === truth.nordRace.toLowerCase(),
                female: !!npc && hasFlag(npc.text, 'Female'),
                built: builtProject('HildaTheNord', calls)
            };
        }
    }
];

const wanted = opt.tasks ? opt.tasks.split(',').map(s => s.trim()) : TASKS.map(t => t.id);
const unknownTasks = wanted.filter(id => !TASKS.some(t => t.id === id));
if (unknownTasks.length) fail(`unknown task(s) ${unknownTasks.join(', ')}; the tasks are ${TASKS.map(t => t.id).join(', ')}.`);
const tasks = TASKS.filter(t => wanted.includes(t.id)).flatMap(t => [
    t,
    ...opt['with-skills'] && t.skill ? [{ ...t, id: `${t.id}+skill`, preread: t.skill }] : [],
    ...opt.detailed && t.detailed ? [{ ...t, id: `${t.id}+detailed`, prompt: t.detailed }] : []
]);

// --- The agent loop -----------------------------------------------------------------------------

const ollamaTools = [
    ...serverTools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    ...FILE_TOOLS.map(t => ({ type: 'function', function: t }))
];

const systemPrompt =
    'You are an assistant for Skyrim Special Edition modding. Use the tools to do what the user asks, ' +
    'then answer briefly. Besides the Skyrim server\'s tools you have file tools (list_directory, ' +
    `read_file, write_file, edit_file) for the projects folder ${projectsDir}.\n\n` +
    `Instructions from the Skyrim server:\n${instructions}`;

/** A tool call written into the text instead of made: the call the client never sees. */
function callInText(content) {
    if (!content) return false;
    const names = [...serverToolNames, ...fileToolNames].join('|');
    return new RegExp(`tool_call|"name"\\s*:\\s*"(${names})"|\\b(${names})\\s*[({]`).test(content);
}

function emptyProjects() {
    for (const entry of fs.readdirSync(projectsDir)) fs.rmSync(path.join(projectsDir, entry), { recursive: true, force: true });
}

async function runTask(task, run) {
    emptyProjects();
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: task.prompt }];
    if (task.preread) {
        // The skill read as the model would read it: its call and the server's answer, before the first turn.
        const read = await callServer('readSkill', { skill: task.preread });
        if (read.isError) fail(`readSkill ${task.preread} failed: ${read.text}`);
        messages.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'readSkill', arguments: { skill: task.preread } } }] },
            { role: 'tool', tool_name: 'readSkill', content: read.text });
    }
    const calls = [];
    const turns = [];
    let answer = '';
    let stop = 'maxTurns';
    const started = Date.now();

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        let reply;
        try {
            reply = await ollama('/api/chat', {
                model: opt.model,
                messages,
                tools: ollamaTools,
                stream: false,
                ...(THINK === undefined ? {} : { think: THINK }),
                options: { num_ctx: NUM_CTX, seed: 1000 + run }
            });
        } catch (error) {
            stop = 'ollamaError';
            answer = error.message;
            break;
        }
        const message = reply.message ?? {};
        turns.push({
            promptTokens: reply.prompt_eval_count ?? 0,
            outputTokens: reply.eval_count ?? 0,
            seconds: (reply.total_duration ?? 0) / 1e9,
            thinkingChars: message.thinking?.length ?? 0,
            thinking: message.thinking ?? '',
            calls: message.tool_calls?.length ?? 0,
            doneReason: reply.done_reason
        });
        messages.push(message);

        const toolCalls = message.tool_calls ?? [];
        if (!toolCalls.length) {
            answer = message.content ?? '';
            stop = callInText(answer) ? 'callInText' : 'answered';
            break;
        }

        for (const toolCall of toolCalls) {
            const name = toolCall.function?.name ?? '';
            let args = toolCall.function?.arguments ?? {};
            const argsWereText = typeof args === 'string';
            if (argsWereText) {
                try { args = JSON.parse(args); } catch { /* handed on as it came */ }
            }
            const record = { turn, name, args, argsWereText };
            let text;

            if (fileToolNames.has(name)) {
                try {
                    text = runFileTool(name, args);
                    record.isError = false;
                } catch (error) {
                    text = `Error: ${error.message}`;
                    record.isError = true;
                }
            } else if (name === 'deployProject') {
                text = 'Error: deploying is switched off in this session. Tell the user the project is ready to deploy.';
                record.isError = true;
                record.deployRefused = true;
            } else if (serverToolNames.has(name)) {
                const result = await callServer(name, args);
                text = result.text;
                record.isError = result.isError;
                record.code = result.code;
                try { record.truncated = JSON.parse(text).status === 'truncated'; } catch { /* not JSON */ }
            } else {
                text = `Error: there is no tool named '${name}'.`;
                record.isError = true;
                record.unknownTool = true;
            }
            record.bytes = Buffer.byteLength(text);
            record.result = text.length > 600 ? `${text.slice(0, 600)}…` : text;
            calls.push(record);
            messages.push({ role: 'tool', tool_name: name, content: text });
        }
    }

    const checks = stop === 'answered' || stop === 'callInText' || stop === 'maxTurns'
        ? await task.check({ answer, calls })
        : {};
    const historyBytes = Buffer.byteLength(JSON.stringify(messages));
    return {
        task: task.id,
        run,
        ...(task.preread ? { preread: task.preread } : {}),
        success: Object.keys(checks).length > 0 && Object.values(checks).every(Boolean),
        checks,
        stop,
        turns: turns.length,
        calls: calls.length,
        invalidParams: calls.filter(c => c.code === -32602).length,
        unknownTools: calls.filter(c => c.unknownTool).length,
        otherErrors: calls.filter(c => c.isError && c.code !== -32602 && !c.unknownTool && !c.deployRefused).length,
        deployRefused: calls.filter(c => c.deployRefused).length,
        truncated: calls.filter(c => c.truncated).length,
        argsAsText: calls.filter(c => c.argsWereText).length,
        maxPromptTokens: Math.max(0, ...turns.map(t => t.promptTokens)),
        outputTokens: turns.reduce((sum, t) => sum + t.outputTokens, 0),
        historyBytes,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        answer: answer.length > 1500 ? `${answer.slice(0, 1500)}…` : answer,
        transcript: calls,
        turnStats: turns
    };
}

// --- Run ----------------------------------------------------------------------------------------

const results = [];
const toolListBytes = Buffer.byteLength(JSON.stringify(ollamaTools));
console.log(`eval: ${serverTools.length} server tools + ${FILE_TOOLS.length} file tools, ${toolListBytes} bytes of tool schemas; ` +
    `instructions ${instructions.length} chars`);

try {
    for (const task of tasks) {
        for (let run = 1; run <= RUNS; run++) {
            const result = await runTask(task, run);
            results.push(result);
            const failed = Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name);
            console.log(`  ${task.id} #${run}: ${result.success ? 'PASS' : 'FAIL'} — ${result.stop}, ${result.turns} turns, ` +
                `${result.calls} calls (${result.invalidParams} invalid, ${result.otherErrors} other errors), ` +
                `${result.seconds}s${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
        }
    }
} finally {
    await client.close().catch(() => { });
    fs.rmSync(projectsDir, { recursive: true, force: true });
}

const loaded = await ollama('/api/ps').catch(() => ({ models: [] }));

/**
 * How fast the model reads a prompt and writes an answer on this machine, at this context: the tool
 * reference (~2,300 tokens) to summarise in 300 tokens, three times, the median of each. Measured apart
 * from the tasks, whose turns reuse Ollama's prompt cache and answer in a few dozen tokens — figures
 * taken from them would not compare between rounds. A fresh first line keeps the cache out of it here.
 */
async function measureSpeed() {
    const doc = fs.readFileSync(path.join(root, 'docs', 'Tool-Reference.md'), 'utf8');
    const samples = [];
    for (let i = 0; i < 3; i++) {
        const reply = await ollama('/api/generate', {
            model: opt.model, stream: false, think: false,
            prompt: `Run ${Date.now()}-${i}.\n\n${doc}\n\nSummarise the document above in about 250 words.`,
            options: { num_ctx: NUM_CTX, num_predict: 300, seed: i }
        });
        samples.push({
            promptTokens: reply.prompt_eval_count,
            prompt: reply.prompt_eval_count / (reply.prompt_eval_duration / 1e9),
            generation: reply.eval_count / (reply.eval_duration / 1e9)
        });
    }
    const median = key => samples.map(s => s[key]).sort((a, b) => a - b)[1];
    return { promptTokens: samples[0].promptTokens, promptPerSecond: Math.round(median('prompt')), generationPerSecond: Math.round(median('generation')) };
}

const speed = await measureSpeed().catch(error => {
    console.error(`eval: the speed measurement failed: ${error.message}`);
    return null;
});

/** The build that was measured: the commit, and whether the working tree differed from it. */
function measuredBuild() {
    const git = args => {
        try {
            return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {
            return undefined;
        }
    };
    const commit = git(['rev-parse', '--short', 'HEAD']);
    if (!commit) return 'unknown (no git)';
    return git(['status', '--porcelain', '--untracked-files=no']) ? `${commit} + uncommitted changes` : commit;
}

const allTurns = results.flatMap(r => r.turnStats);
// The session's first turn loads the model; it says nothing about a turn's cost.
const laterTurns = allTurns.slice(1);
const report = {
    model: opt.model,
    profile: opt.profile,
    numCtx: NUM_CTX,
    think: THINK ?? 'model default',
    runs: RUNS,
    when: new Date().toISOString(),
    build: measuredBuild(),
    secondsPerTurn: laterTurns.length
        ? Math.round(laterTurns.reduce((sum, t) => sum + t.seconds, 0) / laterTurns.length * 100) / 100
        : null,
    speed,
    toolListBytes,
    instructionsChars: instructions.length,
    ollama: loaded.models.find(m => m.name === opt.model || m.model === opt.model) ?? null,
    truth,
    summary: tasks.map(task => {
        const mine = results.filter(r => r.task === task.id);
        const mean = key => Math.round(mine.reduce((sum, r) => sum + r[key], 0) / mine.length * 10) / 10;
        return {
            task: task.id,
            passed: `${mine.filter(r => r.success).length}/${mine.length}`,
            turns: mean('turns'),
            calls: mean('calls'),
            invalidParams: mine.reduce((s, r) => s + r.invalidParams, 0),
            unknownTools: mine.reduce((s, r) => s + r.unknownTools, 0),
            otherErrors: mine.reduce((s, r) => s + r.otherErrors, 0),
            maxPromptTokens: Math.max(...mine.map(r => r.maxPromptTokens)),
            seconds: mean('seconds')
        };
    }),
    results
};
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log('');
console.table(report.summary);
const passed = results.filter(r => r.success).length;
console.log(`eval: ${passed}/${results.length} passed. Full record: ${outFile}`);
// A ratio rather than sizes: for gemma4, Ollama 0.40 reports sizes a tenth of the real ones.
const onGpu = report.ollama ? `${Math.round((report.ollama.size_vram ?? 0) / (report.ollama.size || 1) * 100)}%` : '?';
if (report.ollama) console.log(`eval: Ollama ran it with context ${report.ollama.context_length ?? '?'}, ${onGpu} on the GPU`);
const rate = value => value === undefined ? '?' : `~${value.toLocaleString('en-US')} tokens/s`;
if (speed) console.log(`eval: prompt ${rate(speed.promptPerSecond)} (${speed.promptTokens} tokens), generation ${rate(speed.generationPerSecond)}`);

// The entry for docs/research/local-model-evals.md, where every round is recorded.
const entry = [
    `| ${report.when.slice(0, 10)} | ${report.model} | \`${report.profile}\` | ${report.build} | ${passed}/${results.length} | ` +
    `${report.secondsPerTurn ?? '?'} s | ${rate(speed?.promptPerSecond)} | ${rate(speed?.generationPerSecond)} | ${onGpu} |`,
    '',
    '| task | passed | turns | calls | invalid arguments | other errors | largest prompt (tokens) | seconds |',
    '|---|---|---|---|---|---|---|---|',
    ...report.summary.map(s => `| ${s.task} | ${s.passed} | ${s.turns} | ${s.calls} | ${s.invalidParams} | ${s.otherErrors} | ` +
        `${s.maxPromptTokens} | ${s.seconds} |`)
].join('\n');
fs.writeFileSync(outFile.replace(/\.json$/, '.md'), `${entry}\n`);
console.log(`\neval: the entry for docs/research/local-model-evals.md (num_ctx ${NUM_CTX}, think ${report.think}):\n\n${entry}`);
