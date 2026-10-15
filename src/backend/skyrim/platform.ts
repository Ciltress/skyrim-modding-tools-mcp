import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Everything that differs by operating system (docs/adr/0007): the helper's file name, finding a
 * running program, and the Creation Kit's Papyrus compiler, a Windows program. currentPlatform() picks
 * one at startup; nothing else in the server asks which system it runs on.
 *
 * What differs by mod manager is a separate seam — MO2 runs on both systems.
 */
export interface Platform {
    readonly name: 'windows' | 'linux';
    /** The helper's executable as `npm run build:helper` names it on this system. */
    readonly helperFileName: string;
    /** Running processes whose executable is named `fileName`, compared without regard to case. */
    findProcesses(fileName: string): Promise<RunningProcess[]>;
    /** The Creation Kit's Papyrus compiler under `creationKitDir`, if this system can run it at all. */
    creationKitCompiler(creationKitDir: string): string | undefined;
    /** Why the Creation Kit's compiler cannot run right now, or undefined when it can. */
    creationKitCompilerProblem(): Promise<string | undefined>;
}

export interface RunningProcess {
    pid: number;
    /** The executable's full path as the process names it — under Wine, a Windows path. */
    path: string;
}

/** The platform this server runs on. */
export function currentPlatform(): Platform {
    return process.platform === 'win32' ? windowsPlatform() : linuxPlatform();
}

// ---------------------------------------------------------------- Windows

export function windowsPlatform(): Platform {
    let dotNet35: Promise<boolean> | undefined;

    /** Whether .NET Framework 3.5 is installed, from the registry — asking never opens a Windows dialog. */
    const hasDotNet35 = (): Promise<boolean> => {
        dotNet35 ??= run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v3.5', '/v', 'Install'], {
            windowsHide: true, timeout: 15_000
        }).then(({ stdout }) => /Install\s+REG_DWORD\s+0x1\b/i.test(stdout), () => false)
            // A negative answer is not kept: the user may install it while the server runs.
            .then(found => { if (!found) dotNet35 = undefined; return found; });
        return dotNet35;
    };

    return {
        name: 'windows',
        helperFileName: 'SkyrimHelper.exe',

        async findProcesses(fileName) {
            if (!/^[\w .-]+$/.test(fileName)) return [];
            try {
                const { stdout } = await run('powershell.exe', [
                    '-NoProfile', '-NonInteractive', '-Command',
                    `Get-CimInstance Win32_Process -Filter "Name='${fileName}'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`
                ], { windowsHide: true, timeout: 15_000 });
                return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
                    const bar = line.indexOf('|');
                    return { pid: Number(line.slice(0, bar)), path: line.slice(bar + 1) };
                });
            } catch {
                return [];
            }
        },

        creationKitCompiler(creationKitDir) {
            return path.join(creationKitDir, 'Papyrus Compiler', 'PapyrusCompiler.exe');
        },

        // The compiler is a .NET Framework 2.0 program. Without .NET 3.5 it does not fail politely: Windows
        // opens an "install this feature" dialog on the user's screen for every attempt, and the compiler crashes.
        async creationKitCompilerProblem() {
            return (await hasDotNet35())
                ? undefined
                : `The Creation Kit's Papyrus compiler needs .NET Framework 3.5, which is not installed. Turn it on in ` +
                  `Windows Features (".NET Framework 3.5 (includes .NET 2.0 and 3.0)"), then build again.`;
        }
    };
}

// ---------------------------------------------------------------- Linux

/** @param procRoot  Where the process table is mounted; replaced in tests. */
export function linuxPlatform(procRoot = '/proc'): Platform {
    return {
        name: 'linux',
        helperFileName: 'SkyrimHelper',

        async findProcesses(fileName) {
            const wanted = fileName.toLowerCase();
            const found: RunningProcess[] = [];
            let entries: string[];
            try {
                entries = fs.readdirSync(procRoot);
            } catch {
                return [];
            }
            for (const entry of entries) {
                if (!/^\d+$/.test(entry)) continue;
                let argv0: string;
                try {
                    argv0 = fs.readFileSync(path.join(procRoot, entry, 'cmdline'), 'utf8').split('\0')[0];
                } catch {
                    continue; // gone since the listing, or not ours to read
                }
                // Wine rewrites a Windows program's command line to its Windows path: split on both separators.
                if (argv0.split(/[\\/]/).pop()?.toLowerCase() === wanted) found.push({ pid: Number(entry), path: argv0 });
            }
            return found;
        },

        creationKitCompiler() {
            return undefined;
        },

        async creationKitCompilerProblem() {
            return `The Creation Kit's Papyrus compiler is a Windows program. On Linux, set SKYRIM_PAPYRUS_COMPILER to ` +
                `russo-2025's papyrus-compiler (https://github.com/russo-2025/papyrus-compiler/releases).`;
        }
    };
}
