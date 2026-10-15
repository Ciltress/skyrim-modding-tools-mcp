// Starts the built plugin helper and checks that it answers: its protocol, and a version read from a
// version resource — its own DLL's, since no game is installed where this runs (CI). On Linux,
// FileVersionInfo cannot read one; PeVersion does (docs/adr/0007).
// usage: npm run build && npm run build:helper && npm run check:helper
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { defaultHelperPath } = await import(new URL('../dist/backend/index.js', import.meta.url).href);
const { currentPlatform } = await import(new URL('../dist/backend/skyrim/platform.js', import.meta.url).href);

const executable = defaultHelperPath(currentPlatform());
const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
child.on('error', error => fail(`could not start ${executable}: ${error.message}`));

const pending = new Map();
readline.createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
});
let nextId = 0;
const call = (method, params = {}) => new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
});

function fail(message) {
    console.error(`check-helper failed: ${message}`);
    child.kill();
    process.exit(1);
}

const hello = await call('hello');
if (hello.result?.protocol !== 1) fail(`unexpected hello: ${JSON.stringify(hello)}`);

const own = await call('gameVersion', { exePath: path.join(root, 'helper', 'bin', 'SkyrimHelper.dll') });
if (!/^\d+\.\d+\.\d+\.\d+$/.test(own.result?.version ?? '')) fail(`no version read from SkyrimHelper.dll: ${JSON.stringify(own)}`);

const missing = await call('gameVersion', { exePath: path.join(root, 'no-such-game', 'SkyrimSE.exe') });
if (missing.error?.code !== 'notFound') fail(`a missing exe should be notFound: ${JSON.stringify(missing)}`);

console.log(`check-helper passed: ${hello.result.helper}, protocol ${hello.result.protocol}, read version ${own.result.version}`);
child.stdin.end();
