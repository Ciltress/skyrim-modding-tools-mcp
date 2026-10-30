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

/** Where the server lives: its repository, and the raw files of its main branch. */
export const REPOSITORY = 'https://github.com/Ciltress/skyrim-modding-tools-mcp';
const RAW = 'https://raw.githubusercontent.com/Ciltress/skyrim-modding-tools-mcp/main';

/**
 * How a client shows this server, beside its name and version: a title, what it does, where it lives, and the
 * mudcrab icon (the user's wish, 2026-10-30). The small icon travels with the server as a data URI, so a client
 * shows it offline and asks no one for it; the large one is the repository's copy. Kept apart from SERVER_INFO,
 * which healthcheck answers with, so no answer carries the image.
 */
export const SERVER_PRESENTATION = {
    title: 'Skyrim Modding Tools',
    description: String(packageJson.description),
    websiteUrl: REPOSITORY,
    icons: [
        {
            src: `data:image/png;base64,${fs.readFileSync(path.join(PROJECT_ROOT, 'assets', 'icon-64.png')).toString('base64')}`,
            mimeType: 'image/png',
            sizes: ['64x64']
        },
        { src: `${RAW}/assets/icon.png`, mimeType: 'image/png', sizes: ['512x512'] }
    ]
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
