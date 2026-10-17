import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Instance, ModEntry } from './modManager.js';
import { findCaseInsensitive } from './paths.js';
import type { Platform } from './platform.js';

const run = promisify(execFile);

/** Papyrus and git, the two outside programs a project build and pull rely on. */

/** A script did not compile — something to fix in the project's sources. */
export class ScriptCompileError extends Error { }

/** The compiler cannot run on this machine — something to install, not something in the project. */
export class CompilerUnavailableError extends Error { }

/** Where the vanilla script sources can be: the Creation Kit unpacks them to the first. */
export const SOURCE_FOLDERS = ['Data/Source/Scripts', 'Data/Scripts/Source'];
const MOD_SOURCE_FOLDERS = ['Source/Scripts', 'Scripts/Source'];

export interface CompileOptions {
    platform: Platform;
    /** SKYRIM_PAPYRUS_COMPILER, when set. */
    compiler?: string;
    /** Where a compiler is looked for without one — Platform.papyrusCompilerCandidates. */
    searched?: readonly string[];
    creationKitDir: string;
    scriptsDir: string;
    outputDir: string;
    instance: Instance;
    mods: readonly ModEntry[];
}

/**
 * Compiles a project's Papyrus sources into `outputDir`. Returns how many there were; none is no
 * work, and needs no compiler.
 */
export async function compileScripts(options: CompileOptions): Promise<number> {
    const { scriptsDir } = options;
    const sources = fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir).filter(f => f.toLowerCase().endsWith('.psc')) : [];
    if (sources.length === 0) return 0;

    const { executable, args } = await papyrusCommand(options);
    fs.mkdirSync(options.outputDir, { recursive: true });
    try {
        await run(executable, args, { windowsHide: true, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
    } catch (error: any) {
        // The compiler reports problems as `<file>(line,col): message`, then a summary.
        const lines = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const problems = lines.filter(line => /\(\d+,\d+\):|failed|unable/i.test(line));
        throw new ScriptCompileError(
            `Papyrus compilation failed:\n${(problems.length ? problems : lines).slice(0, 25).join('\n') || error?.message}`);
    }
    return sources.length;
}

/**
 * The compiler command for a project's scripts: the compiler `SKYRIM_PAPYRUS_COMPILER` names, else
 * the Creation Kit's where the platform can run it. Two command lines are spoken, told apart by the
 * executable's name: the Creation Kit's `PapyrusCompiler.exe`, and russo-2025's `papyrus-compiler`,
 * which runs on Linux (docs/research/2026-10-15-linux-mo2-and-platform.md §7).
 *
 * Imports, in order of precedence: the project's own sources, every enabled mod's script sources
 * (SKSE's among them, when installed as a mod), then the vanilla sources the Creation Kit unpacked.
 */
export async function papyrusCommand(options: CompileOptions): Promise<{ executable: string; args: string[] }> {
    const { platform, creationKitDir, scriptsDir, outputDir, instance, mods } = options;
    const compiler = options.compiler || platform.creationKitCompiler(creationKitDir) || options.searched?.find(file => fs.existsSync(file));
    if (!compiler) throw new CompilerUnavailableError((await platform.creationKitCompilerProblem())!);
    const vanilla = SOURCE_FOLDERS.map(folder => findCaseInsensitive(creationKitDir, folder)).find(Boolean);
    if (!fs.existsSync(compiler) || !vanilla) {
        throw new CompilerUnavailableError(
            `The project has Papyrus scripts, but ${!fs.existsSync(compiler) ? `there is no Papyrus compiler at '${compiler}'` :
                `the vanilla script sources are not in '${creationKitDir}'`}. Install the Creation Kit (Steam) and open it ` +
            `once so it unpacks Scripts.zip, or set SKYRIM_CK_DIR to its folder` +
            `${options.compiler ? '' : ', or SKYRIM_PAPYRUS_COMPILER to a compiler'}.`);
    }

    const modSources = mods
        .filter(mod => mod.enabled && mod.managed)
        .flatMap(mod => MOD_SOURCE_FOLDERS.map(folder => findCaseInsensitive(path.join(instance.modsDir, mod.name), folder)))
        .filter((dir): dir is string => !!dir);

    if (/^papyruscompiler(\.exe)?$/i.test(path.basename(compiler))) {
        const problem = await platform.creationKitCompilerProblem();
        if (problem) throw new CompilerUnavailableError(problem);
        const flags = findCaseInsensitive(vanilla, 'TESV_Papyrus_Flags.flg');
        if (!flags) throw new CompilerUnavailableError(`No TESV_Papyrus_Flags.flg in '${vanilla}': open the Creation Kit once so it unpacks Scripts.zip.`);
        return {
            executable: compiler,
            args: [scriptsDir, '-all', `-f=${flags}`, `-i=${[scriptsDir, ...modSources, vanilla].join(';')}`, `-o=${outputDir}`, '-quiet']
        };
    }
    // russo-2025's compiler: the project's sources are the input, everything else is read as headers.
    return {
        executable: compiler,
        args: ['compile', '-nocache', '-i', scriptsDir, '-o', outputDir, ...[...modSources, vanilla].flatMap(dir => ['-h', dir])]
    };
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
