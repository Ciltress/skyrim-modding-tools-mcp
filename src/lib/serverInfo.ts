import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CORE_GUIDES, resourceScheme, type Product } from 'skyrim-modding-tools-core';

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
 * renamed server does not keep serving the template's URIs.
 */
export const RESOURCE_SCHEME = resourceScheme(SERVER_INFO);

/**
 * This server as the core serves it: whose resource URIs, the version Nexus is
 * told, the folder projects/ and .env are in — and the guides, in the order
 * readServerGuide lists them: the core's two, this server's tool reference
 * (rendered as it serves the tools), and its own two.
 */
export const PRODUCT: Product = {
    ...SERVER_INFO,
    root: PROJECT_ROOT,
    guides: [
        CORE_GUIDES.router,
        {
            id: 'tool-reference',
            title: 'Every tool, with its arguments',
            root: PROJECT_ROOT,
            file: 'docs/Tool-Reference.md',
            description:
                'All tools grouped by family, with argument names, types and which are required — ' +
                'generated from the tool definitions, so it cannot drift from the code. Ask for one ' +
                'family by section rather than reading it whole.'
        },
        CORE_GUIDES.tools,
        {
            id: 'hosting',
            title: 'Running it: stdio and Streamable HTTP',
            root: PROJECT_ROOT,
            file: 'docs/Hosting.md',
            description:
                'The two transports, the per-session bearer token in HTTP mode, the origin and host ' +
                'allow-lists, the rate limit, and why it runs beside the game rather than in a container.'
        },
        {
            id: 'agents',
            title: 'Working on this repository',
            root: PROJECT_ROOT,
            file: 'AGENTS.md',
            description:
                'For agents changing this server rather than using it: layout, conventions, how to test, ' +
                'and how to add a tool.'
        }
    ]
};
