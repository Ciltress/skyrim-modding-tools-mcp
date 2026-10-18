/**
 * The eval's second client: OpenClaw itself, headless (`openclaw agent exec`), with the model served by
 * Ollama — the way a user of OpenClaw with a local model drives this server. Used by eval-ollama.mjs
 * with `--client openclaw`; the tasks and checks are the same.
 *
 * The session is the user's own OpenClaw configuration (`~/.openclaw/openclaw.json`, or
 * --openclaw-config), changed only where a measurement needs it: one agent is kept — --openclaw-agent,
 * else `skyrim`, the one setup writes, else the only one — working in the eval's fresh projects folder;
 * the Ollama provider points at a logging proxy; the only MCP server is this one, without deployProject,
 * installMod and downloadNexusFile (they write into the instance or download); the shell (`exec`,
 * `process`) and the tools that reach a paired device (`nodes`, the file tools) are denied, since nobody
 * watches the run; the agent's workspace files (AGENTS.md, SOUL.md, USER.md…) are copied into each run's
 * folder and put into the prompt, as a gateway does — `agent exec` makes its folder the workspace and
 * leaves them out unless told; the model under test is configured — with the
 * settings of the configuration's first Ollama model when it has no entry of its own — and allowed; the
 * gateway section is left out. Everything else is the user's — Tool Search, the thinking level, the tool
 * profile, the context — so what is measured is what they get.
 *
 * Everything is read at the proxy: the prompt each turn sends (OpenClaw's system prompt and tools, the
 * num_ctx and thinking it asks for), the time to the first token, how each answer ended, and the calls —
 * each answer's tool calls, and what came back for them in the next request. A call made through Tool
 * Search (`openclaw_tool_call` with this server's tool as its id) is recorded as the server's tool.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** Tools that change the instance or download: left out of OpenClaw's catalog. */
const NOT_ALLOWED = ['deployProject', 'installMod', 'downloadNexusFile'];

/**
 * Denied, since an eval runs unwatched: OpenClaw's shell, and the tools that reach a paired device — on
 * the user's machine, the PC itself, through its node.
 */
const DENIED_TOOLS = ['exec', 'process', 'nodes', 'dir_fetch', 'dir_list', 'file_fetch', 'file_write'];

/** The files of an agent's workspace OpenClaw puts into its prompt. */
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md'];

const SERVER = 'skyrim';
const PREFIX = `${SERVER}__`;

/** The configuration a user's OpenClaw reads: --openclaw-config, else OPENCLAW_CONFIG_PATH, else the default. */
export function openClawConfigFile(explicit) {
    return path.resolve(explicit ?? process.env.OPENCLAW_CONFIG_PATH ?? path.join(os.homedir(), '.openclaw', 'openclaw.json'));
}

/** OpenClaw's entry script: --openclaw, else the one npm installed globally. */
export function openClawEntry(explicit) {
    if (explicit) return path.resolve(explicit);
    try {
        // Through a shell: npm is a .cmd on Windows.
        const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const entry = path.join(root, 'openclaw', 'openclaw.mjs');
        if (fs.existsSync(entry)) return entry;
    } catch { /* npm not on the PATH */ }
    return undefined;
}

export function openClawVersion(entry) {
    return execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim();
}

/**
 * A pass-through to Ollama on a free local port. Every request, and how its answer streamed back, is
 * pushed to `log`; `log.length = 0` starts a new run's record. A conversation request past `limit` is
 * refused and `onLimit` called — the eval's turn limit, which OpenClaw has no flag for.
 */
export async function startProxy(ollama) {
    const target = new URL(ollama);
    const proxy = { url: '', log: [], limit: Infinity, onLimit: null, close: null };
    const server = http.createServer((req, res) => {
        const started = Date.now();
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            let body = null;
            try { body = raw.length ? JSON.parse(raw.toString('utf8')) : null; } catch { /* not JSON */ }
            const system = (body?.messages ?? []).filter(m => m.role === 'system').map(m => m.content ?? '').join('');
            const entry = {
                url: req.url, model: body?.model, body,
                tools: body?.tools?.length ?? 0,
                toolNames: (body?.tools ?? []).map(t => t.function?.name),
                toolsBytes: body?.tools ? Buffer.byteLength(JSON.stringify(body.tools)) : 0,
                systemChars: system.length,
                think: body?.think, numCtx: body?.options?.num_ctx,
                status: null, firstTokenMs: null, ms: null, done: false, doneReason: null, abandoned: false,
                promptTokens: null, cachedTokens: null, outputTokens: null,
                content: '', thinking: '', toolCalls: []
            };
            proxy.log.push(entry);
            if (entry.tools > 0 && proxy.log.filter(e => e.tools > 0).length > proxy.limit) {
                entry.refused = true;
                res.writeHead(503, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'the eval\'s turn limit was reached' }));
                proxy.onLimit?.();
                return;
            }
            const upstream = http.request({
                host: target.hostname, port: target.port, method: req.method, path: req.url,
                headers: { ...req.headers, host: target.host }
            }, answer => {
                entry.status = answer.statusCode;
                res.writeHead(answer.statusCode, answer.headers);
                // Ollama streams one JSON object a line; unstreamed, the whole answer is one.
                const decoder = new StringDecoder('utf8');
                let tail = '';
                const take = line => {
                    if (!line.trim()) return;
                    let event;
                    try { event = JSON.parse(line); } catch { return; }
                    const message = event.message;
                    if (message) {
                        if ((message.content || message.thinking || message.tool_calls) && entry.firstTokenMs === null) {
                            entry.firstTokenMs = Date.now() - started;
                        }
                        entry.content += message.content ?? '';
                        entry.thinking += message.thinking ?? '';
                        if (message.tool_calls) entry.toolCalls.push(...message.tool_calls);
                    }
                    if (event.error) entry.error = event.error;
                    if (event.done) {
                        entry.done = true;
                        entry.doneReason = event.done_reason;
                        entry.promptTokens = event.prompt_eval_count ?? 0;
                        entry.cachedTokens = event.prompt_eval_cached_count ?? 0;
                        entry.outputTokens = event.eval_count ?? 0;
                    }
                };
                answer.on('data', chunk => {
                    res.write(chunk);
                    const lines = (tail + decoder.write(chunk)).split('\n');
                    tail = lines.pop();
                    lines.forEach(take);
                });
                answer.on('end', () => {
                    take(tail + decoder.end());
                    entry.ms = Date.now() - started;
                    res.end();
                });
            });
            upstream.on('error', error => {
                entry.error = error.message;
                if (!res.headersSent) res.writeHead(502);
                res.end();
            });
            res.on('close', () => { if (!res.writableEnded) entry.abandoned = true; });
            upstream.end(raw);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    proxy.url = `http://127.0.0.1:${server.address().port}`;
    proxy.close = () => server.close();
    return proxy;
}

/**
 * The session's configuration: the user's, with the changes the header names. Returns its file and
 * what the run will use of it: the context OpenClaw asks Ollama for, and the model entry copied when
 * the model had none.
 */
export function writeSessionConfig({ dir, configFile, proxyUrl, model, root, serverEnv, projectsDir, agent }) {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (error) {
        throw new Error(`OpenClaw's configuration ${configFile} could not be read as JSON (${error.message}); ` +
            'pass --openclaw-config with a plain JSON copy of it');
    }
    if (JSON.stringify(config).includes('"$include"')) {
        throw new Error(`OpenClaw's configuration ${configFile} includes other files; pass --openclaw-config with one file that holds it all`);
    }
    delete config.gateway;

    const providers = ((config.models ??= {}).providers ??= {});
    const provider = (providers.ollama ??= { api: 'ollama', apiKey: 'ollama-local', models: [] });
    provider.baseUrl = proxyUrl;
    provider.models ??= [];
    let entry = provider.models.find(m => m.id === model);
    const copiedFrom = entry ? undefined : provider.models[0]?.id;
    if (!entry) {
        entry = { ...structuredClone(provider.models[0] ?? {}), id: model, name: model };
        provider.models.push(entry);
    }

    // The agent measured — --openclaw-agent, else `skyrim`, else the only one — kept alone, so the run
    // resolves it without the --agent flag `agent exec` does not have, and working in the eval's folder.
    const agents = (config.agents ??= {});
    const entries = agents.entries ?? {};
    const ids = Object.keys(entries);
    const agentId = agent ?? (entries.skyrim ? 'skyrim' : ids.length === 1 ? ids[0] : undefined);
    if (agent && !entries[agent]) {
        throw new Error(`OpenClaw's configuration has no agent '${agent}'; it has ${ids.join(', ') || 'none'}`);
    }
    if (!agentId && ids.length > 0) {
        throw new Error(`OpenClaw's configuration has the agents ${ids.join(', ')}: name the one to measure with --openclaw-agent`);
    }
    // The agent's workspace files, as its gateway runs read them: from its own workspace, else the default one —
    // read once, so every run measures the same files, whatever happens to the workspace meanwhile.
    const workspace = agentId && (entries[agentId].workspace ?? (ids.length === 1 ? agents.defaults?.workspace : undefined));
    const workspaceFiles = workspace
        ? WORKSPACE_FILES.map(name => path.join(workspace.replace(/^~(?=$|[\\/])/, os.homedir()), name)).filter(file => fs.existsSync(file))
            .map(file => ({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') }))
        : [];
    if (agentId) {
        agents.entries = {
            [agentId]: {
                ...entries[agentId], workspace: projectsDir, cwd: projectsDir,
                ...(workspaceFiles.length && !entries[agentId].contextInjection ? { contextInjection: 'always' } : {})
            }
        };
        // What names an agent left out — the heartbeat's, the system agent's, talk's — names the kept one,
        // or OpenClaw refuses the whole configuration.
        const removed = new Set(ids.filter(id => id !== agentId));
        (function retarget(node) {
            if (!node || typeof node !== 'object' || node === agents.entries) return;
            for (const [key, value] of Object.entries(node)) {
                if (typeof value === 'string' && /agentId$/i.test(key) && removed.has(value)) node[key] = agentId;
                else if (Array.isArray(value) && /(agents|agentIds)$/i.test(key) && value.some(v => removed.has(v))) {
                    node[key] = [...new Set(value.map(v => removed.has(v) ? agentId : v))];
                } else retarget(value);
            }
        })(config);
    }

    // The model under test is the primary one, allowed and set up wherever another Ollama model is.
    const ref = `ollama/${model}`;
    const defaults = (agents.defaults ??= {});
    defaults.model = { primary: ref };
    const likeOllama = models => models && !models[ref]
        ? Object.keys(models).find(key => key.startsWith('ollama/'))
        : undefined;
    const copyEntry = models => {
        const like = likeOllama(models);
        if (like) models[ref] = structuredClone(models[like]);
    };
    copyEntry(defaults.models);
    for (const kept of Object.values(agents.entries ?? {})) {
        if (typeof kept.model === 'string') kept.model = ref;
        else if (kept.model) kept.model = { ...kept.model, primary: ref, fallbacks: [] };
        if (kept.modelPolicy?.allow && !kept.modelPolicy.allow.includes(ref)) kept.modelPolicy.allow.push(ref);
        copyEntry(kept.models);
    }

    config.mcp = {
        ...config.mcp,
        servers: {
            [SERVER]: {
                command: process.execPath, args: [path.join(root, 'dist', 'index.js')], env: serverEnv,
                toolFilter: { exclude: NOT_ALLOWED }
            }
        }
    };
    config.tools ??= {};
    config.tools.deny = [...new Set([...(config.tools.deny ?? []), ...DENIED_TOOLS])];

    const file = path.join(dir, 'openclaw.json');
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    const numCtx = Number(entry.params?.num_ctx) > 0 ? Number(entry.params.num_ctx)
        : Number(entry.contextTokens) > 0 ? Number(entry.contextTokens) : undefined;
    return { file, numCtx, copiedFrom, agentId, workspaceFiles };
}

/** Ends a process and what it started — the server and its helper — which Windows leaves running. */
function killTree(child) {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    } else {
        child.kill();
    }
}

/** One answer's tool call in the record's shape; a call through Tool Search as the tool it reached. */
function callRecord(toolCall, turn) {
    const name = toolCall.function?.name ?? '';
    let args = toolCall.function?.arguments ?? {};
    const argsWereText = typeof args === 'string';
    if (argsWereText) {
        try { args = JSON.parse(args); } catch { /* recorded as it came */ }
    }
    const record = { turn, name, args, argsWereText };
    if (name.startsWith(PREFIX)) {
        record.name = name.slice(PREFIX.length);
    } else if (name === 'openclaw_tool_call' || name === 'tool_call') {
        const target = new RegExp(`(?:^|:)${PREFIX}(\\w+)$`).exec(String(args?.id ?? ''))?.[1];
        if (target) Object.assign(record, { name: target, args: args.args ?? {}, via: name });
    }
    return record;
}

/** The tool results a request carries for the answer before it: the tool messages after its last assistant message. */
function toolResults(body) {
    const messages = body?.messages ?? [];
    let last = messages.length - 1;
    while (last >= 0 && messages[last].role !== 'assistant') last--;
    return messages.slice(last + 1).filter(m => m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
}

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * One task through OpenClaw. Returns what eval-ollama.mjs's own loop returns — the calls in its record
 * shape, the final answer and how the session ended — plus the proxy's per-request figures.
 */
export async function runOpenClaw({ entry, prompt, model, cwd, configFile, workspaceFiles = [], proxy, serverToolNames, maxTurns, timeoutMs, thinking }) {
    proxy.log.length = 0;
    for (const file of workspaceFiles) fs.writeFileSync(path.join(cwd, file.name), file.text);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-eval-openclaw-run-'));
    // A state folder of the run's own: OpenClaw's temporary one fails to delete on Windows (a SQLite
    // file still open, EBUSY), and the run's answer is lost with it.
    const stateDir = path.join(dir, 'state');
    fs.mkdirSync(stateDir);
    const promptFile = path.join(dir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt);
    const args = [
        entry, 'agent', 'exec', '--config', configFile, '--cwd', cwd, '--state-dir', stateDir,
        '--model', `ollama/${model}`, '--message-file', promptFile, '--json',
        '--timeout', String(Math.ceil(timeoutMs / 1000)),
        ...(thinking ? ['--thinking', thinking] : [])
    ];
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    let overTurns = false;
    let timedOut = false;
    proxy.limit = maxTurns;
    proxy.onLimit = () => { overTurns = true; killTree(child); };
    // OpenClaw's own --timeout ends the run first; this is for a run that does not end.
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs + 60_000);
    const exitCode = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    proxy.limit = Infinity;
    proxy.onLimit = null;
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* left in the temp folder */ }

    let envelope = null;
    try { envelope = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch { /* no envelope */ }

    // The conversation's own requests carry the tool list; anything else is a side request.
    const main = proxy.log.filter(e => e.tools > 0 && !e.refused);
    const calls = [];
    main.forEach((request, turn) => {
        const results = toolResults(main[turn + 1]?.body);
        request.toolCalls.forEach((toolCall, i) => {
            const record = callRecord(toolCall, turn);
            const text = results[i];
            if (text !== undefined) {
                const server = serverToolNames.has(record.name);
                const code = /\\*"code\\*"\s*:\s*(-32\d{3})/.exec(text)?.[1];
                record.isError = /^\s*\[tool error\]/.test(text) || (server && code !== undefined && /\\*"error\\*"\s*:/.test(text));
                if (record.isError && server && code !== undefined) record.code = Number(code);
                if (record.isError && /Tool \S+ not found|Unknown tool id/i.test(text)) record.unknownTool = true;
                if (NOT_ALLOWED.includes(record.name)) record.deployRefused = true;
                record.truncated = /\\*"status\\*"\s*:\s*\\*"truncated/.test(text);
                record.bytes = Buffer.byteLength(text);
                record.result = text.length > 600 ? `${text.slice(0, 600)}…` : text;
            }
            calls.push(record);
        });
    });

    const last = main.at(-1);
    const onlyCleanupFailed = envelope?.status === 'error' && /cleanup failed/i.test(envelope.error?.message ?? '');
    const stop = overTurns ? 'maxTurns'
        : timedOut || envelope?.status === 'timeout' ? 'timeout'
            : envelope?.status === 'ok' || (onlyCleanupFailed && last?.done && !last.toolCalls.length) ? 'answered'
                : `clientError:${envelope?.error?.kind ?? `exit ${exitCode}`}`;
    const turnStats = main.map(e => ({
        promptTokens: e.promptTokens ?? 0,
        newPromptTokens: (e.promptTokens ?? 0) - (e.cachedTokens ?? 0),
        outputTokens: e.outputTokens ?? 0,
        seconds: (e.ms ?? 0) / 1000,
        firstTokenSeconds: e.firstTokenMs === null ? null : e.firstTokenMs / 1000,
        thinkingChars: e.thinking.length,
        thinking: e.thinking,
        calls: e.toolCalls.length,
        doneReason: e.doneReason,
        cut: !e.done || e.abandoned || !!e.error
    }));
    const first = main[0];
    // The workspace files OpenClaw put into the prompt: those whose first line the system prompt holds.
    const system = (first?.body?.messages ?? []).filter(m => m.role === 'system').map(m => m.content ?? '').join('\n');
    const inPrompt = workspaceFiles.filter(file => {
        const heading = file.text.split('\n').find(line => line.trim());
        return heading && system.includes(heading.trim());
    }).map(file => file.name);
    return {
        calls,
        answer: envelope?.final || last?.content || '',
        stop,
        turnStats,
        client: {
            firstPrompt: first ? {
                tools: first.tools, toolsBytes: first.toolsBytes, systemChars: first.systemChars,
                toolSearch: first.toolNames.includes('tool_search'),
                serverToolsListed: first.toolNames.filter(n => n?.startsWith(PREFIX)).length,
                toolNames: first.toolNames,
                workspaceFilesInPrompt: inPrompt,
                think: first.think, numCtx: first.numCtx
            } : null,
            sideRequests: proxy.log.filter(e => e.tools === 0 && e.model).map(e => ({ url: e.url, model: e.model, status: e.status, ms: e.ms })),
            cutAnswers: turnStats.filter(t => t.cut).length,
            toolSummary: envelope?.toolSummary ?? null,
            ...(stop.startsWith('clientError') ? { error: envelope?.error ?? null } : {}),
            stderr: stderr.replace(ANSI, '').split('\n')
                .filter(l => l.trim() && !/^\[(agent\/embedded|agents\/agent-command|state\/agent-db)\]/.test(l.trim()))
                .slice(0, 5)
        }
    };
}
