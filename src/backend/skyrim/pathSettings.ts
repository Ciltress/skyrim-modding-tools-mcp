import type { Platform } from './platform.js';

/**
 * The settings that name a file or folder, read here and nowhere else — pathSettings.test.ts holds
 * the source to that, so a path setting added later cannot skip this.
 *
 * A value reaches the server as written: dotenv expands nothing in `.env`, and an MCP client's `env`
 * block has no shell behind it. So it is read here the way a POSIX shell reads a word (Shell Command
 * Language §2.6.1–2.6.2), on every system alike:
 *
 * - `~` and `~/…` are the home folder — HOME where it is set, else the system's own (Windows sets none);
 * - `$NAME` and `${NAME}` are that variable, refused when it is not set, as under `set -u`;
 * - `${NAME:-word}`, `${NAME-word}`, `${NAME:?word}`, `${NAME:+word}` and their kin work as there, and
 *   `=` as `-`: a setting never changes the environment;
 * - a relative path is taken from the server's own folder, the one `.env` is in — never from the
 *   folder a client happened to start it in.
 *
 * What a shell would also do is left out on purpose: backslashes and quotes stay as written, because
 * Windows paths and mod names hold them (`C:\Mods\Bob's Armory`); a command, `$(…)` or `` `…` ``, is
 * refused, never run; nothing is split or matched against files.
 */

export const PATH_SETTINGS = [
    'SKYRIM_MO2_INSTANCE',
    'SKYRIM_AMETHYST_DIR',
    'SKYRIM_WINE_PREFIX',
    'SKYRIM_PROJECTS_DIR',
    'SKYRIM_CK_DIR',
    'SKYRIM_PAPYRUS_COMPILER',
    'SKYRIM_HELPER_PATH'
] as const;

export type PathSetting = typeof PATH_SETTINGS[number];

/** Each path setting as an absolute path, or undefined where it is not set. */
export type PathSettings = Record<PathSetting, string | undefined>;

export interface PathContext {
    platform: Platform;
    /** The home folder, for `~` and an unset HOME. */
    home: string;
    /** What a relative path is taken from: the server's folder. */
    base: string;
}

/** Every path setting, resolved. Throws, naming the setting and what to write instead, on one that cannot be read. */
export function readPathSettings(env: NodeJS.ProcessEnv, context: PathContext): PathSettings {
    return Object.fromEntries(PATH_SETTINGS.map(name => [name, pathSetting(env, name, context)])) as PathSettings;
}

/** Whether a path setting has a value at all — before anything in it is expanded. */
export function settingGiven(env: NodeJS.ProcessEnv, name: PathSetting): boolean {
    return Boolean(env[name]?.trim());
}

/** One path setting, resolved: undefined when it is unset, blank, or comes to nothing. */
export function pathSetting(env: NodeJS.ProcessEnv, name: PathSetting, context: PathContext): string | undefined {
    const value = env[name]?.trim();
    if (!value) return undefined;
    const fail = (why: string) => new Error(`${name}='${value}' ${why}`);

    const windowsVariable = /%([A-Za-z_][A-Za-z0-9_]*)%/.exec(value);
    if (windowsVariable) {
        throw fail(`uses %${windowsVariable[1]}%, Windows' way to name a variable, which a setting does not read: ` +
            `write \${${windowsVariable[1]}} instead (~ is your home folder).`);
    }
    const expanded = expandWord(value, { env, context, fail });
    if (!expanded) return undefined;
    const foreign = context.platform.foreignPath(expanded);
    if (foreign) throw fail(foreign);
    return context.platform.path.resolve(context.base, expanded);
}

// ---------------------------------------------------------------- expansion

interface Scope {
    env: NodeJS.ProcessEnv;
    context: PathContext;
    fail: (why: string) => Error;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

const NEVER_RUN = 'would run a command. A setting never runs anything: write the path itself.';

/** A variable's value; HOME falls back to the home folder, so `$HOME` means on Windows what it means on Linux. */
function variable(name: string, scope: Scope): string | undefined {
    const value = scope.env[name];
    return value === undefined && name === 'HOME' ? scope.context.home : value;
}

/** A word with its tilde prefix and its parameters expanded. */
function expandWord(word: string, scope: Scope): string {
    let out = '';
    let i = 0;
    if (word.startsWith('~')) {
        // The tilde prefix runs to the first separator: `/`, and on Windows `\` too.
        const separators = new Set(['/', scope.context.platform.path.sep]);
        let end = 1;
        while (end < word.length && !separators.has(word[end])) end++;
        const login = word.slice(1, end);
        if (login) {
            throw scope.fail(`starts with ~${login}, another user's home folder, which is not looked up: ` +
                `write ~ for your own, or the full path.`);
        }
        out = variable('HOME', scope) || scope.context.home;
        i = end;
    }
    while (i < word.length) {
        const c = word[i];
        if (c === '`' || word.startsWith('$(', i)) throw scope.fail(NEVER_RUN);
        if (c !== '$') {
            out += c;
            i++;
        } else if (word[i + 1] === '{') {
            const close = closingBrace(word, i + 2);
            if (close < 0) throw scope.fail('has a ${ with no } to close it.');
            out += expandBraced(word.slice(i + 2, close), scope);
            i = close + 1;
        } else {
            const name = NAME.exec(word.slice(i + 1))?.[0];
            // A $ that starts no name is a $.
            out += name ? required(name, scope) : '$';
            i += 1 + (name?.length ?? 0);
        }
    }
    return out;
}

/** Where the `}` closing a `${` is, counting the `${` nested in it; -1 when there is none. */
function closingBrace(word: string, from: number): number {
    let depth = 0;
    for (let i = from; i < word.length; i++) {
        if (word.startsWith('${', i)) {
            depth++;
            i++;
        } else if (word[i] === '}') {
            if (depth === 0) return i;
            depth--;
        }
    }
    return -1;
}

function required(name: string, scope: Scope): string {
    const value = variable(name, scope);
    if (value === undefined) throw scope.fail(`uses $${name}, which is not set. Set ${name} as well, or write the path without it.`);
    return value;
}

/** What is between `${` and `}`: a name, and an operator with its word, which is expanded only when used. */
function expandBraced(inner: string, scope: Scope): string {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?)([-=?+])([\s\S]*))?$/.exec(inner);
    if (!match) {
        throw scope.fail(`uses \${${inner}}, which says no path. Write \${NAME}, or \${NAME:-default} for a default.`);
    }
    const [, name, colon, operator, word] = match;
    if (!operator) return required(name, scope);
    const value = variable(name, scope);
    const missing = value === undefined || (colon === ':' && value === '');
    switch (operator) {
        case '-':
        case '=':
            return missing ? expandWord(word, scope) : value!;
        case '+':
            return missing ? '' : expandWord(word, scope);
        default: {
            if (!missing) return value!;
            const message = expandWord(word, scope);
            throw scope.fail(`stops: ${name} ${value === undefined ? 'is not set' : 'is empty'}${message ? ` — ${message}` : '.'}`);
        }
    }
}
