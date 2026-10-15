import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Who this server is, read from package.json — the one place a name and a
 * version are written down.
 *
 * Hard-coding them in the Server constructor is how a server ends up announcing
 * 0.1.0 to every client while npm ships 0.4.2: nothing fails when the two drift,
 * so nothing notices.
 */

/**
 * Repository root. This file compiles to dist/lib/serverInfo.js and runs from
 * src/lib under vitest, both two levels below the root, so the same relative hop
 * works either way. import.meta.url rather than __dirname because the build
 * emits ESM.
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

export const SERVER_INFO: { name: string; version: string } = {
    name: String(packageJson.name),
    version: String(packageJson.version)
};

/**
 * The URI scheme of this server's resources — `<scheme>://guides/<id>` and
 * `<scheme>://skills/<collection>/<name>`. Derived from the package name, so a
 * renamed server does not keep serving the template's URIs. A scoped name loses
 * its `@` and its `/`, which a scheme cannot contain.
 */
export const RESOURCE_SCHEME = SERVER_INFO.name
    .replace(/^@/, '')
    .replace(/[^a-z0-9+.-]/gi, '-')
    .toLowerCase();
