import fs from 'node:fs';
import path from 'node:path';

/**
 * Skyrim and its mod managers ignore letter case in file names; Linux file systems do not
 * (docs/adr/0007). A mod may ship `scripts/source` where another ships `Scripts/Source`.
 *
 * This reads each folder and compares names itself rather than asking the file system, so it does the
 * same on every system — and the Windows test suite covers what only matters on Linux.
 */

/**
 * `relative` under `base`, matched one segment at a time without regard to case, spelled as it is on
 * disk. An exact match wins over one that differs only in case. Undefined when there is none.
 */
export function findCaseInsensitive(base: string, relative: string): string | undefined {
    let current = base;
    for (const segment of relative.split(/[\\/]+/).filter(Boolean)) {
        let entries: string[];
        try {
            entries = fs.readdirSync(current);
        } catch {
            return undefined;
        }
        const wanted = segment.toLowerCase();
        const match = entries.find(entry => entry === segment) ?? entries.find(entry => entry.toLowerCase() === wanted);
        if (match === undefined) return undefined;
        current = path.join(current, match);
    }
    return current;
}
