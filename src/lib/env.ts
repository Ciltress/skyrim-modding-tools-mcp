/** A comma- or whitespace-separated environment list, emptied of blanks. */
export function parseList(value: string | undefined): string[] {
    return String(value ?? '')
        .split(/[,\s]+/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

/** `1`, `true`, `yes` and `on`, in any case, are true; anything else is false. */
export function parseFlag(value: string | undefined): boolean {
    return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}
