import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Mo2Instance, ModEntry } from './mo2.js';

const run = promisify(execFile);

/** Papyrus and git, the two outside programs a project build and pull rely on. */

/** A script did not compile — something to fix in the project's sources. */
export class ScriptCompileError extends Error { }

/** The compiler cannot run on this machine — something to install, not something in the project. */
export class CompilerUnavailableError extends Error { }

/**
 * Compiles a project's Papyrus sources with the Creation Kit's compiler into `outputDir`.
 *
 * Imports, in the compiler's order of precedence: the project's own sources, every enabled mod's
 * script sources (SKSE's among them, when installed as a mod), then the vanilla sources the
 * Creation Kit unpacked into its Data folder.
 */
export async function compileScripts(options: {
    creationKitDir: string;
    scriptsDir: string;
    outputDir: string;
    instance: Mo2Instance;
    mods: readonly ModEntry[];
}): Promise<number> {
    const { creationKitDir, scriptsDir, outputDir, instance, mods } = options;
    const sources = fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir).filter(f => f.toLowerCase().endsWith('.psc')) : [];
    if (sources.length === 0) return 0;

    const compiler = path.join(creationKitDir, 'Papyrus Compiler', 'PapyrusCompiler.exe');
    const vanilla = path.join(creationKitDir, 'Data', 'Source', 'Scripts');
    const flags = path.join(vanilla, 'TESV_Papyrus_Flags.flg');
    if (!fs.existsSync(compiler) || !fs.existsSync(flags)) {
        throw new CompilerUnavailableError(
            `The project has Papyrus scripts, but there is no Papyrus compiler with vanilla sources in '${creationKitDir}'. ` +
            `Install the Creation Kit (Steam), open it once so it unpacks Scripts.zip, or set SKYRIM_CK_DIR to its folder.`);
    }
    // The compiler is a .NET Framework 2.0 program. Without .NET 3.5 it does not fail politely: Windows
    // opens an "install this feature" dialog on the user's screen for every attempt, and the compiler crashes.
    if (!(await hasDotNet35())) {
        throw new CompilerUnavailableError(
            `The Creation Kit's Papyrus compiler needs .NET Framework 3.5, which is not installed. Turn it on in ` +
            `Windows Features (".NET Framework 3.5 (includes .NET 2.0 and 3.0)"), then build again.`);
    }

    const modSources = mods
        .filter(mod => mod.enabled && mod.managed)
        .flatMap(mod => ['Source/Scripts', 'Scripts/Source'].map(sub => path.join(instance.modsDir, mod.name, sub)))
        .filter(dir => fs.existsSync(dir));
    const imports = [scriptsDir, ...modSources, vanilla].join(';');

    fs.mkdirSync(outputDir, { recursive: true });
    try {
        await run(compiler, [scriptsDir, '-all', `-f=${flags}`, `-i=${imports}`, `-o=${outputDir}`, '-quiet'], {
            windowsHide: true, timeout: 300_000, maxBuffer: 10 * 1024 * 1024
        });
    } catch (error: any) {
        // The compiler reports problems as `<file>(line,col): message`, then a summary.
        const lines = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const problems = lines.filter(line => /\(\d+,\d+\):|failed|unable/i.test(line));
        throw new ScriptCompileError(
            `Papyrus compilation failed:\n${(problems.length ? problems : lines).slice(0, 25).join('\n') || error?.message}`);
    }
    return sources.length;
}

let dotNet35: Promise<boolean> | undefined;

/** Whether .NET Framework 3.5 is installed, from the registry — asking never opens a Windows dialog. */
function hasDotNet35(): Promise<boolean> {
    dotNet35 ??= run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v3.5', '/v', 'Install'], {
        windowsHide: true, timeout: 15_000
    }).then(({ stdout }) => /Install\s+REG_DWORD\s+0x1\b/i.test(stdout), () => false)
        // A negative answer is not kept: the user may install it while the server runs.
        .then(found => { if (!found) dotNet35 = undefined; return found; });
    return dotNet35;
}

/**
 * Whether a folder has uncommitted changes, by git's own account. `undefined` when git cannot say —
 * not installed, or the folder is not in a repository.
 */
export async function hasUncommittedChanges(dir: string): Promise<boolean | undefined> {
    try {
        const { stdout } = await run('git', ['status', '--porcelain', '--', '.'], { cwd: dir, windowsHide: true, timeout: 30_000 });
        return stdout.trim().length > 0;
    } catch {
        return undefined;
    }
}
