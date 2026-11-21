#!/usr/bin/env node
/**
 * npm run pack:installer: the main file of the Nexus page — the installers alone, as committed — packed at
 * release/skyrim-modding-tools-mcp-installer.zip. It is uploaded once: the installers install the newest version
 * from GitHub themselves, so the zip has no version and is packed again only if installer/ changes. git archive
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
const name = 'skyrim-modding-tools-mcp-installer';
const out = path.join(root, 'release', `${name}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
git('archive', '--format=zip', `--prefix=${name}/`, '-o', out, 'HEAD:installer');
console.log(out);
