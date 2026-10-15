#!/usr/bin/env node
/**
 * Drives the BUILT server over real stdio, the way a client does, and fails on
 * anything a unit test cannot see:
 *
 *   - a line on stdout that is not a JSON-RPC frame — a stray console.log, or a
 *     dependency announcing itself — which corrupts the stream for every tool;
 *   - a server that does not start, or does not answer initialize, tools/list,
 *     resources/list, healthcheck and readServerGuide;
 *   - a tool on the wire without all four annotation hints.
 *
 *   npm run build && npm run smoke
 *
 * Deliberately written against the raw protocol rather than the SDK client: the
 * client would skip a malformed line, and finding one is the point.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 20_000;

const child = spawn(process.execPath, [path.join(root, 'dist', 'index.js')], {
    cwd: root,
    // stdio forced, whatever .env says: this checks the stdio transport. dotenv
    // never overrides a variable that is already set.
    env: { ...process.env, MCP_TRANSPORT: 'stdio' },
    stdio: ['pipe', 'pipe', 'pipe']
});

const failures = [];
const responses = new Map();
let stdoutBuffer = '';
let stderr = '';

child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        let frame;
        try {
            frame = JSON.parse(line);
        } catch {
            failures.push(`stdout carried a line that is not JSON: ${JSON.stringify(line.slice(0, 200))}`);
            continue;
        }
        if (frame?.jsonrpc !== '2.0') {
            failures.push(`stdout carried JSON that is not a JSON-RPC frame: ${line.slice(0, 200)}`);
            continue;
        }
        if (frame.id !== undefined) responses.get(frame.id)?.(frame);
    }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr += chunk; });

let nextId = 1;
function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} got no answer within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
        responses.set(id, frame => {
            clearTimeout(timer);
            if (frame.error) reject(new Error(`${method} failed: ${frame.error.message}`));
            else resolve(frame.result);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
}
const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);

function check(condition, message) {
    if (!condition) failures.push(message);
}

const exited = new Promise(resolve => child.on('exit', code => resolve(code)));

try {
    const init = await Promise.race([
        request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '1.0.0' }
        }),
        exited.then(code => { throw new Error(`the server exited with code ${code} before answering`); })
    ]);
    notify('notifications/initialized');
    check(init?.serverInfo?.name, 'initialize named no server');
    check(typeof init?.instructions === 'string' && init.instructions.length > 0, 'initialize carried no instructions');

    const { tools } = await request('tools/list');
    check(tools.some(t => t.name === 'healthcheck'), 'tools/list has no healthcheck');
    for (const tool of tools) {
        const missing = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']
            .filter(hint => typeof tool.annotations?.[hint] !== 'boolean');
        check(!missing.length, `${tool.name} is missing ${missing.join(', ')}`);
    }

    const { resources } = await request('resources/list');
    check(resources.length > 0, 'resources/list is empty — are docs/ and skills/ beside dist/?');

    const health = await request('tools/call', { name: 'healthcheck', arguments: {} });
    check(!health.isError, `healthcheck failed: ${health.content?.[0]?.text}`);

    const guide = await request('tools/call', { name: 'readServerGuide', arguments: {} });
    check(!guide.isError, `readServerGuide failed: ${guide.content?.[0]?.text}`);

    console.log(`${init.serverInfo.name} ${init.serverInfo.version}: ${tools.length} tools, ` +
        `${resources.length} resources, healthcheck ${JSON.parse(health.content[0].text).status}`);
} catch (error) {
    failures.push(error.message);
} finally {
    child.stdin.end();
    child.kill();
}

if (failures.length) {
    console.error('smoke test FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    if (stderr.trim()) console.error(`\nserver stderr:\n${stderr.trim().split('\n').slice(-20).join('\n')}`);
    process.exit(1);
}
console.log('smoke test passed: stdout carried only JSON-RPC frames');
