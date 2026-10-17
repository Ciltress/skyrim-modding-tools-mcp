import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SetupSystem } from './system.js';

/**
 * russo-2025's Papyrus compiler for Linux, pinned to one release with its checksum: a program from the
 * internet runs on the modder's machine, so a download that differs from the one reviewed here is
 * refused, never unpacked. A newer release is a change to these three lines.
 */
export const PAPYRUS_COMPILER = {
    release: '2026.03.15',
    url: 'https://github.com/russo-2025/papyrus-compiler/releases/download/2026.03.15/papyrus-compiler-ubuntu.tar.gz',
    sha256: 'd5e72c393ef85a3cd4f839b5bbda52b08bfb358832c36686043e61f5408f736e',
    /** Where the tarball puts its executable, relative to the folder it is unpacked into. */
    executable: path.join('papyrus-compiler', 'papyrus')
} as const;

export function checksumMatches(bytes: Uint8Array, sha256: string): boolean {
    return crypto.createHash('sha256').update(bytes).digest('hex') === sha256.toLowerCase();
}

/**
 * Downloads the compiler into `toolsDir` — the server's tools folder, the first place the server looks
 * — and answers its executable. Throws, leaving nothing behind, on a failed download or a wrong checksum.
 */
export async function downloadCompiler(toolsDir: string, system: SetupSystem, fetchImpl: typeof fetch = fetch): Promise<string> {
    const response = await fetchImpl(PAPYRUS_COMPILER.url);
    if (!response.ok) throw new Error(`The download of the Papyrus compiler failed: HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!checksumMatches(bytes, PAPYRUS_COMPILER.sha256)) {
        throw new Error('The downloaded Papyrus compiler is not the release this setup was written for (its checksum differs), so it was not unpacked.');
    }
    fs.mkdirSync(toolsDir, { recursive: true });
    const archive = path.join(toolsDir, 'papyrus-compiler-ubuntu.tar.gz');
    fs.writeFileSync(archive, bytes);
    try {
        const { code } = await system.run('tar', ['-xzf', archive, '-C', toolsDir], { capture: true });
        if (code !== 0) throw new Error(`tar could not unpack ${archive} (exit ${code}).`);
    } finally {
        fs.rmSync(archive, { force: true });
    }
    return path.join(toolsDir, PAPYRUS_COMPILER.executable);
}
