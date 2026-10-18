import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * What differs by operating system for setup — its own seam beside the server's Platform
 * (docs/adr/0007), picked once by setupSystem(): how a program is started, which package manager
 * installs what is missing, where Claude Desktop and Mod Organizer keep their files.
 */
export interface SetupSystem {
    readonly name: 'windows' | 'linux';
    /** Runs a program found on PATH — on Windows a `.cmd` too — with its output shown, or captured. */
    run(program: string, args: readonly string[], options?: { capture?: boolean; cwd?: string }): Promise<RunResult>;
    /** Whether a program is on PATH. */
    has(program: string): Promise<boolean>;
    /** Unpacks a zip into `dest`, keeping files already there; false when it could not. */
    extractZip(zip: string, dest: string): Promise<boolean>;
    /** The package manager that installs the SDK and git-lfs here, if there is one setup knows. */
    packageManager(): Promise<PackageManager | undefined>;
    /** Claude Desktop's config file, where its folder exists: Desktop installed. */
    claudeDesktopConfig(home: string, env: NodeJS.ProcessEnv): string | undefined;
    /** Where Mod Organizer keeps its global instances, if this system has such a place. */
    mo2InstancesDir(env: NodeJS.ProcessEnv): string | undefined;
}

export interface RunResult {
    code: number;
    stdout: string;
    /** What the program said on stderr; empty unless captured. */
    stderr: string;
}

export type PackageManager = 'pacman' | 'apt-get' | 'dnf' | 'winget';
export type Prerequisite = 'dotnet' | 'git-lfs';

const PACKAGES: Record<PackageManager, Record<Prerequisite, string>> = {
    pacman: { dotnet: 'dotnet-sdk', 'git-lfs': 'git-lfs' },
    'apt-get': { dotnet: 'dotnet-sdk-10.0', 'git-lfs': 'git-lfs' },
    dnf: { dotnet: 'dotnet-sdk-10.0', 'git-lfs': 'git-lfs' },
    winget: { dotnet: 'Microsoft.DotNet.SDK.10', 'git-lfs': 'GitHub.GitLFS' }
};

/** The command that installs `missing` with `manager` — winget takes one package per command, so the first. */
export function installCommand(manager: PackageManager, missing: readonly Prerequisite[]): string[] {
    const packages = missing.map(p => PACKAGES[manager][p]);
    switch (manager) {
        case 'pacman': return ['sudo', 'pacman', '-S', '--needed', '--noconfirm', ...packages];
        case 'apt-get': return ['sudo', 'apt-get', 'install', '-y', ...packages];
        case 'dnf': return ['sudo', 'dnf', 'install', '-y', ...packages];
        case 'winget': return ['winget', 'install', '--exact', '--id', packages[0], '--accept-package-agreements', '--accept-source-agreements'];
    }
}

/**
 * A command line as cmd.exe runs it and the program splits it again (the Microsoft C runtime's rules):
 * an argument with a space or a quote is quoted, its quotes escaped, and the backslashes before a quote
 * doubled. cmd.exe is needed at all because `code` and an npm-installed `claude` are `.cmd` files.
 */
export function windowsCommandLine(program: string, args: readonly string[]): string {
    const quote = (arg: string) => !/[\s"&|<>^]/.test(arg) && arg.length > 0
        ? arg
        : `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
    return [program, ...args.map(quote)].join(' ');
}

function runWith(command: string, args: readonly string[], shell: boolean, options: { capture?: boolean; cwd?: string } = {}): Promise<RunResult> {
    return new Promise(resolve => {
        const child = shell
            ? spawn(windowsCommandLine(command, args), { shell: true, cwd: options.cwd, stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true })
            : spawn(command, args, { cwd: options.cwd, stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
        child.stderr?.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
        child.on('error', () => resolve({ code: 127, stdout, stderr }));
        child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

export function windowsSetup(): SetupSystem {
    const system: SetupSystem = {
        name: 'windows',
        run: (program, args, options) => runWith(program, args, true, options),
        has: async program => (await system.run('where', [program], { capture: true })).code === 0,
        // Windows' own tar is bsdtar, which reads a zip; -k keeps what is there.
        extractZip: async (zip, dest) => (await system.run('tar', ['-xkf', zip, '-C', dest], { capture: true })).code === 0,
        async packageManager() {
            return await system.has('winget') ? 'winget' : undefined;
        },
        // Installed from the Microsoft Store, Desktop keeps its files in its package's folder instead.
        claudeDesktopConfig(home, env) {
            const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
            const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
            const packages = path.join(local, 'Packages');
            const store = safeList(packages).filter(name => /^Claude_/i.test(name))
                .map(name => path.join(packages, name, 'LocalCache', 'Roaming', 'Claude'));
            const dir = [path.join(appData, 'Claude'), ...store].find(d => fs.existsSync(d));
            return dir && path.join(dir, 'claude_desktop_config.json');
        },
        mo2InstancesDir(env) {
            return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'ModOrganizer') : undefined;
        }
    };
    return system;
}

export function linuxSetup(): SetupSystem {
    const system: SetupSystem = {
        name: 'linux',
        run: (program, args, options) => runWith(program, args, false, options),
        has: async program => (await system.run('sh', ['-c', 'command -v "$1"', 'sh', program], { capture: true })).code === 0,
        // GNU tar reads no zip; -n keeps what is there.
        extractZip: async (zip, dest) => (await system.run('unzip', ['-n', '-q', zip, '-d', dest], { capture: true })).code === 0,
        async packageManager() {
            for (const manager of ['pacman', 'apt-get', 'dnf'] as const) if (await system.has(manager)) return manager;
            return undefined;
        },
        // No official Linux build; the community's keep Desktop's folder where the Windows one has it in AppData.
        claudeDesktopConfig(home, env) {
            const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude');
            return fs.existsSync(dir) ? path.join(dir, 'claude_desktop_config.json') : undefined;
        },
        // Under Proton, Mod Organizer's global instances are inside a Wine prefix: a folder is pasted instead.
        mo2InstancesDir() {
            return undefined;
        }
    };
    return system;
}

/** The system setup runs on, from the server's own platform — so this, too, asks only once. */
export function setupSystem(platformName: 'windows' | 'linux'): SetupSystem {
    return platformName === 'windows' ? windowsSetup() : linuxSetup();
}

function safeList(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}
