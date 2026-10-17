/**
 * The server's `.env`, changed the way a person would change it: a value set on its own line — the one
 * that holds it, or the commented-out line `.env.example` has for it — and every other line, comment and
 * value left as it was, so a second run of setup changes only what it was told.
 */

/** `.env`'s text with each of `values` set. */
export function setEnvValues(text: string, values: Readonly<Record<string, string>>): string {
    const lines = text.length > 0 ? text.split(/\r?\n/) : [];
    const added: string[] = [];
    for (const [name, value] of Object.entries(values)) {
        const line = `${name}=${envValue(value)}`;
        const active = lines.findIndex(l => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l));
        const commented = lines.findIndex(l => new RegExp(`^\\s*#\\s*${name}\\s*=`).test(l));
        if (active >= 0) lines[active] = line;
        else if (commented >= 0) lines[commented] = line;
        else added.push(line);
    }
    if (added.length > 0) {
        while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        lines.push(...added, '');
    }
    return lines.join('\n');
}

/**
 * A value as `.env` holds it so dotenv reads it back as given: bare — a Windows path's backslashes are
 * letters there — unless a ` #` would start a comment, spaces around it would be dropped, or it is
 * quoted itself; then in the quotes it does not hold.
 */
export function envValue(value: string): string {
    if (!/\s#|^\s|\s$|^["'`]/.test(value)) return value;
    const quote = !value.includes("'") ? "'" : !value.includes('"') ? '"' : '`';
    return `${quote}${value}${quote}`;
}
