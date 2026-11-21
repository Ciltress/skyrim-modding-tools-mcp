#!/usr/bin/env node
/**
 * npm run pack:installer: the main file of the Nexus page — the installers alone, as committed, which fetch the
 * newest version from GitHub — packed at release/skyrim-modding-tools-mcp-installer-<version>.zip. git archive
 * gives each file the line ends installer/.gitattributes names (CRLF for what Windows runs) and the Linux script
 * its executable bit.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const changed = git('status', '--porcelain', '--', 'installer');
if (changed.trim()) {
    console.error(`The zip holds the committed installers; these are not committed yet:\n${changed}`);
    process.exit(1);
}
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = 'skyrim-modding-tools-mcp-installer';
const out = path.join(root, 'release', `${name}-${version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
git('archive', '--format=zip', `--prefix=${name}/`, '-o', out, 'HEAD:installer');
console.log(out);
