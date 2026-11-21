import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../lib/serverInfo';

/**
 * The installers in installer/ — the file on the Nexus page — held against the server they install. They are
 * scripts nothing else runs before a modder does, so what they must agree on is checked here: the repository
 * they clone, and the Node.js the server needs (package.json's engines).
 */

const read = (file: string) => fs.readFileSync(path.join(PROJECT_ROOT, 'installer', file), 'utf8');
const linux = read('install-linux.sh');
const windows = read('install-windows.ps1');
const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'server.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

describe('the installers', () => {
    it('clone the repository server.json names', () => {
        const repo = `${manifest.repository.url}.git`;
        expect(linux).toContain(`REPO=${repo}\n`);
        expect(windows).toContain(`$Repo = '${repo}'`);
    });

    it('ask for the Node.js package.json asks for', () => {
        const min = String(packageJson.engines.node).replace(/^>=/, '');
        expect(linux).toContain(`NODE_MIN=${min}\n`);
        expect(windows).toContain(`$NodeMin = [version]'${min}'`);
        // The Node.js the Linux one downloads is of the same major version.
        expect(linux).toContain(`NODE_LINE=latest-v${min.split('.')[0]}.x\n`);
    });

    it('stay plain ASCII where Windows reads them: PowerShell 5.1 reads a script without a BOM in the ANSI code page', () => {
        for (const file of ['install-windows.ps1', 'Install on Windows.cmd', 'README.txt']) {
            expect(read(file).match(/[^\x00-\x7f]/g) ?? [], file).toEqual([]);
        }
    });

    it.skipIf(process.platform === 'win32')('is a shell script bash reads', () => {
        expect(() => execFileSync('bash', ['-n', path.join(PROJECT_ROOT, 'installer', 'install-linux.sh')])).not.toThrow();
    });
});
