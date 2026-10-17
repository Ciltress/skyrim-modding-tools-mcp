import fs from 'node:fs';
import path from 'node:path';
import { parseIni } from '../backend/skyrim/mo2.js';

/**
 * Mod Organizer's global instances that manage Skyrim Special Edition: each a folder of its own under
 * MO2's instances folder with a ModOrganizer.ini naming the game. A portable instance can be anywhere,
 * so setup offers these and takes a pasted folder besides.
 */
export function skyrimInstances(instancesDir: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(instancesDir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(instancesDir, entry.name))
        .filter(dir => {
            try {
                return parseIni(fs.readFileSync(path.join(dir, 'ModOrganizer.ini'), 'utf8')).get('General')?.get('gameName') === 'Skyrim Special Edition';
            } catch {
                return false;
            }
        })
        .sort((a, b) => a.localeCompare(b));
}
