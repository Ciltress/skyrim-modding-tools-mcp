import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type {
    NexusAccount, NexusDownload, NexusFileInfo, NexusMod, NexusModSummary, NexusRequirement, NexusSearchQuery,
    NexusSearchResult, NexusSort
} from './SkyrimBackend.js';

/**
 * The Nexus Mods catalogue for Skyrim Special Edition, read through Nexus's GraphQL API (v2), which
 * answers searches and mod pages without an API key
 * (docs/research/2026-10-15-nexus-mo2-crashlogs-prior-art.md §1). Every request names this
 * application, as Nexus's acceptable-use policy asks; user text travels as GraphQL variables.
 *
 * The user's own API key, from NEXUS_API_KEY, is used only for what needs one — the account check and
 * downloading, through v1 — goes to Nexus's API only, never to the CDN a file comes from, and never
 * appears in an answer or a log.
 */

export const NEXUS_GAME = { domain: 'skyrimspecialedition', id: 1704, name: 'Skyrim Special Edition', shortName: 'SkyrimSE' } as const;

const ENDPOINT = 'https://api.nexusmods.com/v2/graphql';
const V1 = 'https://api.nexusmods.com/v1';
/** v1's key check; Nexus does not count it against the rate limit. */
const VALIDATE_ENDPOINT = `${V1}/users/validate.json`;
const KEY_PAGE = 'https://www.nexusmods.com/settings/api-keys';
const APPLICATION_NAME = 'skyrim-modding-tools-mcp';
const TIMEOUT_MS = 30_000;
/** A whole download; a large texture pack on a slow line takes a while. */
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;

/** How much of a mod page's description an answer carries; the page has the rest. */
const DESCRIPTION_LIMIT = 6000;

/** The file categories a mod page offers as current; the rest are old versions, archived or removed. */
const CURRENT_FILES = new Set(['MAIN', 'UPDATE', 'OPTIONAL', 'MISCELLANEOUS']);

const SORT_FIELDS: Record<NexusSort, string> = { endorsements: 'endorsements', downloads: 'downloads', updated: 'updatedAt' };

/**
 * `notFound`: the request names something Nexus does not have — the client is asked to fix it.
 * `unavailable`: Nexus could not be reached or refused the query — nothing the request can fix.
 */
export class NexusError extends Error {
    constructor(readonly code: 'notFound' | 'unavailable', message: string) {
        super(message);
    }
}

export interface NexusCatalogueOptions {
    /** Replaced in tests. */
    fetch?: typeof fetch;
    /** This server's version, sent with every request. */
    appVersion: string;
    /** The user's personal API key (NEXUS_API_KEY), if set. */
    apiKey?: string;
}

const MOD_FIELDS = 'modId name version author category summary endorsements downloads updatedAt adultContent';

const SEARCH_QUERY =
    `query Search($filter: ModsFilter, $sort: [ModsSort!], $count: Int) { mods(filter: $filter, sort: $sort, count: $count) ` +
    `{ totalCount nodes { ${MOD_FIELDS} } } }`;

const MOD_QUERY =
    `query Mod($ids: [CompositeDomainWithIdInput!]!, $modId: ID!, $gameId: ID!) { ` +
    `legacyModsByDomain(ids: $ids) { nodes { ${MOD_FIELDS} description uploader { name } modRequirements { ` +
    `nexusRequirements { nodes { modId modName gameId notes externalRequirement url } } ` +
    `dlcRequirements { gameExpansion { name } notes } } } } ` +
    `modFiles(modId: $modId, gameId: $gameId) { fileId name version category sizeInBytes date description uri } }`;

interface ModNode {
    modId: number;
    name: string;
    version: string;
    author: string;
    category: string;
    summary: string;
    endorsements: number;
    downloads: number;
    updatedAt: string;
    adultContent: boolean;
}

interface FullModNode extends ModNode {
    description: string;
    uploader?: { name: string };
    modRequirements?: {
        nexusRequirements?: { nodes: { modId: string; modName: string; gameId: string; notes: string; externalRequirement: boolean; url: string }[] };
        dlcRequirements?: { gameExpansion?: { name: string }; notes: string }[];
    };
}

/** v1's details of one file. */
interface V1File {
    file_id: number;
    name: string;
    version: string;
    category_id: number;
    category_name: string | null;
    file_name: string;
    size_in_bytes: number;
}

interface FileNode {
    fileId: number;
    name: string;
    version: string;
    category: string;
    sizeInBytes: string;
    date: number;
    description: string;
    uri: string;
}

export class NexusCatalogue {
    private checkedAccount?: Promise<NexusAccount>;

    constructor(private readonly options: NexusCatalogueOptions) { }

    /**
     * The account behind the key. Checked once; a check Nexus could not answer is made again next time.
     * Its name and standing only — validate also answers the key and the e-mail address, which stay here.
     */
    async account(): Promise<NexusAccount> {
        if (!this.options.apiKey) return { apiKey: false };
        this.checkedAccount ??= this.validateKey().then(account => {
            if ('unchecked' in account) this.checkedAccount = undefined;
            return account;
        });
        return this.checkedAccount;
    }

    private async validateKey(): Promise<NexusAccount> {
        let response: Response;
        try {
            response = await (this.options.fetch ?? fetch)(VALIDATE_ENDPOINT, {
                headers: { ...this.identity(), apikey: this.options.apiKey! },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
        } catch (error) {
            return { apiKey: true, unchecked: `Nexus Mods could not be reached (${(error as Error).message}), so the key was not checked.` };
        }
        if (response.status === 401 || response.status === 403) {
            return {
                apiKey: true,
                problem: `Nexus Mods refused the key in NEXUS_API_KEY. Copy your personal API key from ${KEY_PAGE} into it, then restart the server.`
            };
        }
        if (!response.ok) return { apiKey: true, unchecked: `Nexus Mods answered HTTP ${response.status}, so the key was not checked.` };
        const user = await response.json().catch(() => ({})) as { name?: unknown; is_premium?: unknown; is_supporter?: unknown };
        return { apiKey: true, name: String(user.name ?? ''), premium: user.is_premium === true, supporter: user.is_supporter === true };
    }

    /**
     * Downloads one file of a mod into `downloadsDir` through v1 — download links come to premium
     * accounts only — and records it beside the file as Mod Organizer records its own downloads
     * (`<file>.meta`), so the mod manager and installMod know which mod and file it is. Written as
     * `<file>.part` and renamed once its size is right; a file already there with that size is kept.
     */
    async downloadFile(modId: number, fileId: number, downloadsDir: string): Promise<NexusDownload> {
        if (!this.options.apiKey) {
            throw new NexusError('unavailable',
                `Downloading through Nexus's API needs the personal API key of a premium account in NEXUS_API_KEY (${KEY_PAGE}).`);
        }
        const files = `/games/${NEXUS_GAME.domain}/mods/${modId}/files/${fileId}`;
        const details = await this.v1<V1File>(`${files}.json`, modId, fileId);
        const target = path.join(downloadsDir, safeFileName(details.file_name));
        const download: NexusDownload = {
            path: target, modId, fileId, modName: '', name: plain(details.name), version: details.version,
            category: String(details.category_name ?? '').toLowerCase(), sizeBytes: details.size_in_bytes
        };

        const there = fs.existsSync(target) && fs.statSync(target).size === details.size_in_bytes;
        if (!there) {
            const links = await this.v1<{ URI: string }[]>(`${files}/download_link.json`, modId, fileId);
            if (!links[0]?.URI) throw new NexusError('unavailable', `Nexus Mods offered no download link for file ${fileId}. Try again later.`);
            await this.fetchToFile(links[0].URI, target, details.size_in_bytes);
        }
        download.modName = await this.modName(modId);
        if (!there || !fs.existsSync(`${target}.meta`)) writeDownloadMeta(target, download, details.category_id);
        return there ? { ...download, alreadyThere: true } : download;
    }

    /** The file from the CDN, with no key: the signed link is all it takes. */
    private async fetchToFile(url: string, target: string, expectedBytes: number): Promise<void> {
        const part = `${target}.part`;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try {
            let response: Response;
            try {
                response = await (this.options.fetch ?? fetch)(url, { headers: this.identity(), signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
            } catch (error) {
                throw new NexusError('unavailable', `The download from Nexus's CDN failed (${(error as Error).message}). Try again.`);
            }
            if (!response.ok || !response.body) {
                throw new NexusError('unavailable', `Nexus's CDN answered HTTP ${response.status}. Try again later.`);
            }
            await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), fs.createWriteStream(part));
            const got = fs.statSync(part).size;
            if (got !== expectedBytes) {
                throw new NexusError('unavailable',
                    `The download of ${path.basename(target)} came out ${got} of ${expectedBytes} bytes; nothing was kept. Try again.`);
            }
            fs.renameSync(part, target);
        } finally {
            fs.rmSync(part, { force: true });
        }
    }

    /** The mod's name, for the download's record; a download is not failed for want of it. */
    private async modName(modId: number): Promise<string> {
        try {
            const data = await this.graphql<{ legacyModsByDomain: { nodes: { name: string }[] } }>(
                'query Name($ids: [CompositeDomainWithIdInput!]!) { legacyModsByDomain(ids: $ids) { nodes { name } } }',
                { ids: [{ gameDomain: NEXUS_GAME.domain, modId }] });
            return plain(data.legacyModsByDomain.nodes[0]?.name ?? '');
        } catch {
            return '';
        }
    }

    /** A v1 call with the key, its refusals said in words: the key, the account, the file, the limit. */
    private async v1<T>(route: string, modId: number, fileId: number): Promise<T> {
        let response: Response;
        try {
            response = await (this.options.fetch ?? fetch)(`${V1}${route}`, {
                headers: { ...this.identity(), apikey: this.options.apiKey! },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
        } catch (error) {
            throw new NexusError('unavailable', `Nexus Mods could not be reached (${(error as Error).message}). Check the internet connection, then try again.`);
        }
        switch (response.status) {
            case 401:
                throw new NexusError('unavailable', `Nexus Mods refused the key in NEXUS_API_KEY. Copy your personal API key from ${KEY_PAGE} into it, then restart the server.`);
            case 403:
                throw new NexusError('unavailable',
                    `Nexus Mods gives download links through its API to premium accounts only, and the key in NEXUS_API_KEY is not one. ` +
                    `Download the file on ${modUrl(modId)}?tab=files instead.`);
            case 404:
                throw new NexusError('notFound', `Nexus mod ${modId} has no file ${fileId}. Take modId and fileId from readNexusMod's files.`);
            case 429:
                throw new NexusError('unavailable', 'Nexus Mods answered HTTP 429 — its rate limit; wait a while before asking again.');
        }
        if (!response.ok) throw new NexusError('unavailable', `Nexus Mods answered HTTP ${response.status}. Try again later.`);
        return await response.json() as T;
    }

    /** Who is asking, as Nexus's acceptable-use policy wants every request to say. */
    private identity(): Record<string, string> {
        return {
            'Application-Name': APPLICATION_NAME,
            'Application-Version': this.options.appVersion,
            'User-Agent': `${APPLICATION_NAME}/${this.options.appVersion} (${process.platform}; ${process.arch})`
        };
    }

    async searchMods(query: NexusSearchQuery): Promise<NexusSearchResult> {
        const filter: Record<string, unknown> = { gameDomainName: [{ value: NEXUS_GAME.domain }] };
        if (query.text?.trim()) filter.name = [{ value: query.text.trim(), op: 'WILDCARD' }];
        const data = await this.graphql<{ mods: { totalCount: number; nodes: ModNode[] } }>(SEARCH_QUERY, {
            filter,
            sort: [{ [SORT_FIELDS[query.sort ?? 'endorsements']]: { direction: 'DESC' } }],
            count: query.limit
        });
        return { total: data.mods.totalCount, mods: data.mods.nodes.map(summary) };
    }

    async readMod(modId: number): Promise<NexusMod> {
        const data = await this.graphql<{ legacyModsByDomain: { nodes: FullModNode[] }; modFiles: FileNode[] }>(MOD_QUERY, {
            ids: [{ gameDomain: NEXUS_GAME.domain, modId }],
            modId: String(modId),
            gameId: String(NEXUS_GAME.id)
        });
        const node = data.legacyModsByDomain.nodes[0];
        if (!node) {
            throw new NexusError('notFound',
                `No Nexus mod ${modId} for ${NEXUS_GAME.name}. The number is the one in the mod page's address ` +
                `(…/skyrimspecialedition/mods/<number>); find it with searchNexus.`);
        }
        const base = summary(node);
        const text = bbcodeToText(node.description ?? '');
        const cut = text.length > DESCRIPTION_LIMIT;
        const files = data.modFiles ?? [];
        return {
            ...base,
            uploader: node.uploader?.name ?? '',
            description: cut ? cutAtLine(text, DESCRIPTION_LIMIT) : text,
            ...(cut ? { descriptionCut: `The description was cut at ${DESCRIPTION_LIMIT} characters; the rest is on ${base.url}.` } : {}),
            requirements: (node.modRequirements?.nexusRequirements?.nodes ?? []).map(requirement),
            dlcRequirements: (node.modRequirements?.dlcRequirements ?? []).map(dlc => plain(dlc.gameExpansion?.name ?? '')).filter(Boolean),
            files: files.filter(file => CURRENT_FILES.has(file.category)).map(fileInfo),
            olderFiles: files.filter(file => !CURRENT_FILES.has(file.category)).length
        };
    }

    private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const fetcher = this.options.fetch ?? fetch;
        let response: Response;
        try {
            response = await fetcher(ENDPOINT, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...this.identity() },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
        } catch (error) {
            throw new NexusError('unavailable',
                `Nexus Mods could not be reached (${(error as Error).message}). Check the internet connection, then try again.`);
        }
        if (!response.ok) {
            throw new NexusError('unavailable',
                `Nexus Mods answered HTTP ${response.status}` +
                (response.status === 429 ? ' — its rate limit; wait a while before asking again.' : '. Try again later.'));
        }
        let body: { data?: T; errors?: { message: string }[] };
        try {
            body = await response.json() as typeof body;
        } catch {
            throw new NexusError('unavailable', 'Nexus Mods answered with something that is not JSON. Try again later.');
        }
        if (body.errors?.length || !body.data) {
            throw new NexusError('unavailable',
                `Nexus Mods refused the query: ${(body.errors ?? []).map(e => e.message).join('; ') || 'no data'}.`);
        }
        return body.data;
    }
}

function modUrl(modId: number | string): string {
    return `https://www.nexusmods.com/${NEXUS_GAME.domain}/mods/${modId}`;
}

function summary(node: ModNode): NexusModSummary {
    return {
        modId: node.modId,
        name: plain(node.name),
        version: node.version,
        author: plain(node.author ?? ''),
        category: plain(node.category ?? ''),
        summary: plain(node.summary ?? ''),
        endorsements: node.endorsements,
        downloads: node.downloads,
        updated: String(node.updatedAt ?? '').slice(0, 10),
        url: modUrl(node.modId),
        ...(node.adultContent ? { adult: true as const } : {})
    };
}

function requirement(node: { modId: string; modName: string; gameId: string; notes: string; externalRequirement: boolean; url: string }): NexusRequirement {
    const notes = plain(node.notes ?? '').trim();
    const name = plain(node.modName);
    if (node.externalRequirement) {
        return { name, ...(notes ? { notes } : {}), ...(node.url ? { url: node.url } : {}) };
    }
    const modId = Number(node.modId);
    const sameGame = String(node.gameId) === String(NEXUS_GAME.id);
    return { modId, name, ...(notes ? { notes } : {}), ...(sameGame ? { url: modUrl(modId) } : {}) };
}

function fileInfo(node: FileNode): NexusFileInfo {
    const description = bbcodeToText(node.description ?? '');
    return {
        fileId: node.fileId,
        name: plain(node.name),
        version: node.version,
        category: node.category.toLowerCase(),
        fileName: node.uri,
        sizeBytes: Number(node.sizeInBytes),
        uploaded: new Date(node.date * 1000).toISOString().slice(0, 10),
        ...(description ? { description } : {})
    };
}

/** A name Nexus gives a file, as a file name on any system: no folders, nothing a file system refuses. */
function safeFileName(name: string): string {
    return path.basename(String(name).replace(/\\/g, '/')).replace(/[<>:"|?*\u0000-\u001f]/g, '_');
}

/**
 * Mod Organizer's record of a download, `<file>.meta`, with the keys its download manager reads and
 * writes (modorganizer src/downloadmanager.cpp) — a finished download, not yet installed.
 */
function writeDownloadMeta(file: string, download: NexusDownload, fileCategory: number): void {
    const entries: [string, string | number | boolean][] = [
        ['gameName', NEXUS_GAME.shortName], ['modID', download.modId], ['fileID', download.fileId],
        ['name', download.name], ['modName', download.modName], ['version', download.version],
        ['fileCategory', fileCategory], ['repository', 'Nexus'],
        ['installed', false], ['uninstalled', false], ['paused', false], ['removed', false]
    ];
    const lines = ['[General]', ...entries.map(([key, value]) => `${key}=${qtIniValue(String(value))}`)];
    fs.writeFileSync(`${file}.meta`, `${lines.join('\r\n')}\r\n`, 'utf8');
}

/** A string as Qt's ini format writes one: quoted when a comma would make it a list, or when it holds quotes. */
function qtIniValue(value: string): string {
    return /[,;="\\]|^\s|\s$/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}

/** The text up to the last line break within `limit` characters, so it never ends mid-sentence. */
function cutAtLine(text: string, limit: number): string {
    const head = text.slice(0, limit);
    const lastBreak = head.lastIndexOf('\n');
    return (lastBreak > limit / 2 ? head.slice(0, lastBreak) : head).trimEnd();
}

// ---------------------------------------------------------------- BBCode

/** The BBCode tags Nexus pages use. Anything else in brackets — `[SE]`, `[1.6.1170]` — is text. */
const TAGS = 'b|i|u|s|strike|size|color|font|center|left|right|justify|quote|spoiler|code|heading|line|hr|' +
    'list|ol|ul|li|table|tr|td|th|sup|sub|indent|email|url|img|youtube|\\*';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };

/** Text Nexus sends HTML-escaped in places — `Saints &amp; Seducers` — as the words it stands for. */
export function plain(text: string): string {
    return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
        if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
        if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
        return ENTITIES[name.toLowerCase()] ?? entity;
    });
}

/**
 * A Nexus page's BBCode as plain text: the words and the links stay, markup and pictures go. Nexus
 * writes each line break as a newline plus `<br />`.
 */
export function bbcodeToText(bbcode: string): string {
    let text = bbcode
        .replace(/[﻿​]/g, '')
        .replace(/\r?\n?<br\s*\/?>/gi, '\n')
        .replace(/\[(img|youtube)(=[^\]]*)?\][\s\S]*?\[\/\1\]/gi, '')
        .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, url: string, label: string) => {
            const target = url.trim().replace(/^["']|["']$/g, '');
            const words = label.trim();
            return !words || words === target ? target : `${words} (${target})`;
        })
        .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1')
        .replace(/\[\*\]/g, '\n- ')
        .replace(/\[\/?(list|ol|ul|line|hr|heading|quote|spoiler|table|tr)(=[^\]]*)?\]/gi, '\n\n')
        .replace(new RegExp(`\\[\\/?(${TAGS})(=[^\\]]*)?\\]`, 'gi'), '')
        .replace(/<[^>]+>/g, '');
    text = plain(text);

    // One blank line between paragraphs at most, and none between the items of a list.
    const lines = text.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim());
    const kept: string[] = [];
    lines.forEach((line, i) => {
        if (line) return void kept.push(line);
        const previous = kept[kept.length - 1];
        const next = lines.slice(i + 1).find(Boolean);
        if (previous === undefined || previous === '' || next === undefined) return;
        if (previous.startsWith('- ') && next.startsWith('- ')) return;
        kept.push('');
    });
    text = kept.join('\n');
    return text.trim();
}
