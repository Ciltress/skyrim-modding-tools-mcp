/**
 * The eval's second client: Claude Code itself, headless, with the model served by Ollama — the way
 * the extension runs it when ANTHROPIC_BASE_URL points at Ollama. Used by eval-ollama.mjs with
 * `--client claude-code`; the tasks and checks are the same.
 *
 * Claude Code's requests go through a small logging proxy in front of Ollama, which is where the
 * figures come from: the prompt each turn sends (Claude Code's own system prompt and tools included),
 * the time to its first token, and how each answer ended. An answer that stops without Anthropic's
 * `message_stop`, or that Claude Code abandons, is counted — the "stops in the middle" a user sees.
 *
 * The session is set up as the lean workspace recommended for local models: Claude Code's built-in
 * tools that a modding session does not use are denied (they were 85% of a 41,652-token first prompt,
 * 2026-10-16), non-essential traffic is off (no session-title request that waits for the model), and
 * only this server is configured. Files are written in the projects folder, the session's working
 * directory, with edits accepted; deployProject, installMod and downloadNexusFile are not allowed, and
 * a call to one is counted as refused.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/** Claude Code's built-in tools a modding session with this server does not need. */
export const DENIED_BUILT_INS = [
    'Agent', 'Artifact', 'ArtifactComments', 'ArtifactData', 'Bash', 'CronCreate', 'CronDelete', 'CronList',
    'DesignSync', 'EnterWorktree', 'ExitWorktree', 'ListAgents', 'LSP', 'Monitor', 'NotebookEdit', 'PowerShell',
    'PushNotification', 'ReportFindings', 'ScheduleWakeup', 'SendMessage', 'Skill', 'TaskStop', 'WebFetch',
    'WebSearch', 'Workflow'
];

/** Tools that change the instance or download; the eval never lets them run. */
const NOT_ALLOWED = new Set(['deployProject', 'installMod', 'downloadNexusFile']);

const PREFIX = 'mcp__skyrim__';

/**
 * The Claude Code to run: --claude, else the newest one the VS Code extension ships (what the
 * extension itself runs), else `claude` on the PATH.
 */
export function claudeCodeBinary(explicit) {
    if (explicit) return explicit;
    const extensions = path.join(os.homedir(), '.vscode', 'extensions');
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const found = fs.existsSync(extensions)
        ? fs.readdirSync(extensions).filter(d => d.startsWith('anthropic.claude-code-'))
            .map(d => path.join(extensions, d, 'resources', 'native-binary', exe)).filter(f => fs.existsSync(f))
        : [];
    const version = f => (/claude-code-(\d+)\.(\d+)\.(\d+)/.exec(f) ?? []).slice(1).map(Number);
    found.sort((a, b) => {
        const [x, y] = [version(a), version(b)];
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    return found.at(-1) ?? 'claude';
}

/**
 * A pass-through to Ollama on a free local port. Every request and how its answer streamed back is
 * pushed to `log`; `log.length = 0` starts a new run's record.
 */
export async function startProxy(ollama) {
    const target = new URL(ollama);
    const log = [];
    const server = http.createServer((req, res) => {
        const started = Date.now();
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            let body = null;
            try { body = raw.length ? JSON.parse(raw.toString('utf8')) : null; } catch { /* not JSON */ }
            const entry = {
                url: req.url, model: body?.model, tools: body?.tools?.length ?? 0,
                toolsBytes: body?.tools ? Buffer.byteLength(JSON.stringify(body.tools)) : 0,
                systemBytes: body?.system ? Buffer.byteLength(JSON.stringify(body.system)) : 0,
                messages: body?.messages?.length ?? 0, thinking: body?.thinking?.type,
                status: null, firstTokenMs: null, ms: null, stop: null, sawStop: false, abandoned: false, usage: {}
            };
            log.push(entry);
            const upstream = http.request({
                host: target.hostname, port: target.port, method: req.method, path: req.url,
                headers: { ...req.headers, host: target.host }
            }, answer => {
                entry.status = answer.statusCode;
                res.writeHead(answer.statusCode, answer.headers);
                let tail = '';
                answer.on('data', chunk => {
                    res.write(chunk);
                    const lines = (tail + chunk.toString('utf8')).split('\n');
                    tail = lines.pop();
                    for (const line of lines) {
                        if (!line.startsWith('data:')) continue;
                        let event;
                        try { event = JSON.parse(line.slice(5)); } catch { continue; }
                        if (event.type === 'content_block_delta' && entry.firstTokenMs === null) entry.firstTokenMs = Date.now() - started;
                        if (event.type === 'message_start') Object.assign(entry.usage, event.message?.usage);
                        if (event.type === 'message_delta') {
                            entry.stop = event.delta?.stop_reason ?? entry.stop;
                            Object.assign(entry.usage, event.usage);
                        }
                        if (event.type === 'message_stop') entry.sawStop = true;
                    }
                });
                answer.on('end', () => { entry.ms = Date.now() - started; res.end(); });
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
    return { url: `http://127.0.0.1:${server.address().port}`, log, close: () => server.close() };
}

/**
 * The session's files: the settings (Ollama behind the proxy, the model, the denied built-ins) and the
 * MCP configuration naming only this server, started the way eval-ollama.mjs starts its own.
 */
export function writeSessionConfig({ dir, proxyUrl, model, root, serverEnv }) {
    const settings = path.join(dir, 'claude-settings.json');
    const mcp = path.join(dir, 'claude-mcp.json');
    fs.writeFileSync(settings, JSON.stringify({
        model,
        env: {
            ANTHROPIC_BASE_URL: proxyUrl,
            ANTHROPIC_AUTH_TOKEN: 'ollama',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            // Side requests on the loaded model: another one would push it out of the GPU.
            ANTHROPIC_SMALL_FAST_MODEL: model,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: model
        },
        permissions: { deny: DENIED_BUILT_INS }
    }, null, 2));
    fs.writeFileSync(mcp, JSON.stringify({
        mcpServers: { skyrim: { command: process.execPath, args: [path.join(root, 'dist', 'index.js')], env: serverEnv } }
    }, null, 2));
    return { settings, mcp };
}

/** The environment Claude Code starts in: this one, without an API key or another session's markers. */
function childEnv(proxyUrl) {
    const env = { ...process.env, ANTHROPIC_BASE_URL: proxyUrl, ANTHROPIC_AUTH_TOKEN: 'ollama' };
    for (const key of Object.keys(env)) {
        if (key === 'ANTHROPIC_API_KEY' || key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
    }
    return env;
}

const resultText = content => typeof content === 'string'
    ? content
    : (content ?? []).map(part => part.text ?? '').join('');

/**
 * One task through Claude Code. Returns what eval-ollama.mjs's own loop returns — the calls in its
 * record shape, the final answer and how the session ended — plus the proxy's per-request figures.
 */
export async function runClaudeCode({ binary, prompt, model, cwd, config, proxy, serverToolNames, maxTurns, timeoutMs }) {
    proxy.log.length = 0;
    const allowed = [...serverToolNames].filter(name => !NOT_ALLOWED.has(name)).map(name => PREFIX + name);
    const args = [
        '-p', prompt, '--model', model,
        '--settings', config.settings, '--mcp-config', config.mcp, '--strict-mcp-config',
        '--permission-mode', 'acceptEdits', '--allowedTools', allowed.join(','),
        // Not in --help, but taken: without it, 26b called Glob on one folder 672 times in a row (2026-10-17).
        '--max-turns', String(maxTurns),
        '--no-session-persistence', '--output-format', 'stream-json', '--verbose'
    ];
    const child = spawn(binary, args, { cwd, env: childEnv(proxy.url), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const exitCode = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);

    const calls = [];
    const pending = new Map();
    const turnIds = [];
    let result = null;
    for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'assistant') {
            const id = event.message?.id;
            if (id && !turnIds.includes(id)) turnIds.push(id);
            for (const block of event.message?.content ?? []) {
                if (block.type !== 'tool_use') continue;
                const name = block.name.startsWith(PREFIX) ? block.name.slice(PREFIX.length) : block.name;
                const record = { turn: Math.max(0, turnIds.indexOf(id)), name, args: block.input ?? {}, argsWereText: false };
                pending.set(block.id, record);
                calls.push(record);
            }
        } else if (event.type === 'user') {
            for (const block of event.message?.content ?? []) {
                if (block.type !== 'tool_result') continue;
                const record = pending.get(block.tool_use_id);
                if (!record) continue;
                const text = resultText(block.content);
                record.isError = !!block.is_error;
                if (record.isError && serverToolNames.has(record.name)) {
                    try { record.code = JSON.parse(text).code; } catch { /* a refusal of Claude Code's own */ }
                }
                if (record.isError && NOT_ALLOWED.has(record.name)) record.deployRefused = true;
                if (record.isError && /No such tool available/i.test(text)) record.unknownTool = true;
                try { record.truncated = JSON.parse(text).status === 'truncated'; } catch { /* not this server's */ }
                record.bytes = Buffer.byteLength(text);
                record.result = text.length > 600 ? `${text.slice(0, 600)}…` : text;
            }
        } else if (event.type === 'result') {
            result = event;
        }
    }

    // The conversation's own requests carry the tool list; anything else is a side request.
    const main = proxy.log.filter(entry => entry.tools > 0);
    const turnStats = main.map(entry => ({
        promptTokens: (entry.usage.input_tokens ?? 0) + (entry.usage.cache_read_input_tokens ?? 0) +
            (entry.usage.cache_creation_input_tokens ?? 0),
        newPromptTokens: entry.usage.input_tokens ?? 0,
        outputTokens: entry.usage.output_tokens ?? 0,
        seconds: (entry.ms ?? 0) / 1000,
        firstTokenSeconds: entry.firstTokenMs === null ? null : entry.firstTokenMs / 1000,
        stop: entry.stop,
        cut: !entry.sawStop || entry.abandoned || !!entry.error,
        calls: 0
    }));
    const stop = timedOut ? 'timeout'
        : result?.subtype === 'success' ? 'answered'
            : result?.subtype === 'error_max_turns' ? 'maxTurns'
                : `clientError:${result?.subtype ?? `exit ${exitCode}`}`;
    return {
        calls,
        answer: result?.result ?? '',
        stop,
        turnStats,
        client: {
            firstPrompt: main[0] ? { tools: main[0].tools, toolsBytes: main[0].toolsBytes, systemBytes: main[0].systemBytes, thinking: main[0].thinking } : null,
            sideRequests: proxy.log.filter(entry => entry.tools === 0 && entry.model).map(e => ({ model: e.model, status: e.status, ms: e.ms })),
            cutAnswers: turnStats.filter(t => t.cut).length,
            permissionDenials: result?.permission_denials?.length ?? 0,
            stderr: stderr.split('\n').filter(l => l.trim() && !/connectors are disabled|unrecognized_model/.test(l)).slice(0, 5)
        }
    };
}
