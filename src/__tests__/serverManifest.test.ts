import fs from 'fs';
import path from 'path';
import { REQUIRED_ENV } from '../backend/index';
import { PROJECT_ROOT, RESOURCE_SCHEME, SERVER_INFO } from '../lib/serverInfo';

/**
 * server.json — the MCP registry manifest — held against the code it describes.
 *
 * A manifest nothing checks drifts in both directions: it goes on declaring a
 * variable the code stopped reading (and a client goes on collecting a secret
 * the server cannot use), and it never learns about the ones added since (and
 * nobody can configure them). So the rule is the one `toolDocs.test.ts` applies
 * to the tool reference: what ships has to agree with the code, and disagreeing
 * fails the build rather than reaching a registry.
 */

const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'server.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

const npmPackage = manifest.packages[0];
const declared: Array<{ name: string; isRequired?: boolean; isSecret?: boolean; description?: string }> =
    npmPackage.environmentVariables;
const declaredNames = declared.map(v => v.name);

/**
 * Every environment variable src/ actually reads, tests excluded — they set
 * variables that are inputs to a fixture rather than to the server.
 *
 * The two access shapes are `env.NAME` (an injected NodeJS.ProcessEnv, which is
 * how nearly everything reads) and `process.env.NAME`. Both end in `env.NAME`,
 * so one pattern covers them.
 */
function environmentVariablesReadBySource(): Set<string> {
    const found = new Set<string>();

    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '__tests__') walk(full);
                continue;
            }
            if (!entry.name.endsWith('.ts')) continue;
            for (const match of fs.readFileSync(full, 'utf8').matchAll(/\benv(?:\.|\[["'])([A-Z][A-Z_0-9]{2,})/g)) {
                found.add(match[1]);
            }
        }
    };

    walk(path.join(PROJECT_ROOT, 'src'));
    return found;
}

/**
 * Read by the server but deliberately absent from the manifest. Each entry
 * should carry its reason.
 */
const DELIBERATELY_UNDECLARED: string[] = [
    // Not this server's settings: the system's and Amethyst's own, read only to find Amethyst's files
    // exactly where Amethyst looks for them (src/backend/skyrim/amethyst.ts).
    'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'MOD_MANAGER_PROFILES_DIR'
];

describe('server.json', () => {
    it('identifies the package package.json publishes', () => {
        expect(manifest.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
        // The registry checks this pairing itself, by reading mcpName from npm.
        expect(manifest.name).toBe(packageJson.mcpName);
        expect(manifest.version).toBe(packageJson.version);
        expect(npmPackage.identifier).toBe(packageJson.name);
        expect(npmPackage.version).toBe(packageJson.version);
        expect(npmPackage.transport.type).toBe('stdio');
    });

    it('keeps the description inside the 100 characters the registry schema allows', () => {
        expect(manifest.description.length).toBeGreaterThan(0);
        expect(manifest.description.length).toBeLessThanOrEqual(100);
    });

    it('declares every environment variable the server reads, and no others', () => {
        const read = environmentVariablesReadBySource();

        const undeclared = [...read]
            .filter(name => !declaredNames.includes(name))
            .filter(name => !DELIBERATELY_UNDECLARED.includes(name));
        const unread = declaredNames.filter(name => !read.has(name));

        expect({ undeclared, unread }).toEqual({ undeclared: [], unread: [] });
    });

    it('describes every variable it declares', () => {
        for (const variable of declared) expect(`${variable.name}: ${(variable.description ?? '').length > 20}`)
            .toBe(`${variable.name}: true`);
    });

    it('requires exactly what the server refuses to start without', () => {
        const required = declared.filter(v => v.isRequired).map(v => v.name).sort();
        expect(required).toEqual([...REQUIRED_ENV].sort());
    });

    it('marks every credential secret and optional', () => {
        // isRequired on a secret would make every client collect one, including
        // the setups where there is nothing to collect.
        const credentials = declared.filter(v => /TOKENS?$|SECRET$|PASSWORD$|PASSPHRASE$|KEY$/.test(v.name));
        for (const credential of credentials) {
            expect(`${credential.name} secret: ${credential.isSecret === true}`).toBe(`${credential.name} secret: true`);
            expect(`${credential.name} required: ${!!credential.isRequired}`).toBe(`${credential.name} required: false`);
        }
    });
});

describe('server identity', () => {
    it('comes from package.json, so it cannot drift from what npm ships', () => {
        expect(SERVER_INFO).toEqual({ name: packageJson.name, version: packageJson.version });
    });

    it('derives a valid URI scheme for its resources from the package name', () => {
        expect(RESOURCE_SCHEME).toMatch(/^[a-z][a-z0-9+.-]*$/);
    });
});
