import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NexusCatalogue, NexusError, bbcodeToText } from '../backend/skyrim/nexus';

/**
 * The Nexus Mods catalogue, read through its GraphQL API (v2) without an API key. Nexus is played
 * by a fetch that answers with trimmed copies of what the real API answered on 2026-10-15.
 */

interface SentRequest {
    url: string;
    headers: Record<string, string>;
    query: string;
    variables: Record<string, unknown>;
}

function fakeNexus(answer: (request: SentRequest) => unknown, status = 200) {
    const requests: SentRequest[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const request = { url, headers: init.headers as Record<string, string>, query: body.query, variables: body.variables };
        requests.push(request);
        return new Response(JSON.stringify(answer(request)), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    return { catalogue: new NexusCatalogue({ fetch, appVersion: '0.1.0' }), requests };
}

const skyUiNode = {
    modId: 12604, name: 'SkyUI', version: '6.9', author: 'SkyUI Team', category: 'User Interface',
    summary: 'Elegant, PC-friendly interface mod with many advanced features. Upgraded with full support for all modern game versions.',
    endorsements: 505505, downloads: 26124299, updatedAt: '2026-05-05T22:41:21Z', adultContent: false, uploader: { name: 'schlangster' }
};

describe('searching Nexus Mods', () => {
    it('finds Skyrim SE mods by name, most endorsed first, each with its page', async () => {
        const { catalogue, requests } = fakeNexus(() => ({
            data: { mods: { totalCount: 218, nodes: [skyUiNode, { ...skyUiNode, modId: 20406, name: 'SkyUI SE - Flashing Savegames Fix', adultContent: true }] } }
        }));

        const found = await catalogue.searchMods({ text: 'SkyUI', limit: 2 });

        expect(found.total).toBe(218);
        expect(found.mods[0]).toEqual({
            modId: 12604, name: 'SkyUI', version: '6.9', author: 'SkyUI Team', category: 'User Interface',
            summary: skyUiNode.summary, endorsements: 505505, downloads: 26124299, updated: '2026-05-05',
            url: 'https://www.nexusmods.com/skyrimspecialedition/mods/12604'
        });
        expect(found.mods[1]).toMatchObject({ modId: 20406, adult: true });

        // The text travels as a variable, never spliced into the query; the game and the order are fixed here.
        expect(requests[0].url).toBe('https://api.nexusmods.com/v2/graphql');
        expect(requests[0].variables).toEqual({
            filter: { gameDomainName: [{ value: 'skyrimspecialedition' }], name: [{ value: 'SkyUI', op: 'WILDCARD' }] },
            sort: [{ endorsements: { direction: 'DESC' } }],
            count: 2
        });
        expect(requests[0].headers).toMatchObject({ 'Application-Name': 'skyrim-modding-tools-mcp', 'Application-Version': '0.1.0' });
    });

    it('lists the most downloaded or the latest updated mods when asked', async () => {
        const { catalogue, requests } = fakeNexus(() => ({ data: { mods: { totalCount: 142013, nodes: [skyUiNode] } } }));
        await catalogue.searchMods({ sort: 'updated', limit: 5 });
        expect(requests[0].variables).toEqual({
            filter: { gameDomainName: [{ value: 'skyrimspecialedition' }] },
            sort: [{ updatedAt: { direction: 'DESC' } }],
            count: 5
        });
    });
});

const skyUiMod = {
    data: {
        legacyModsByDomain: {
            nodes: [{
                ...skyUiNode, gameId: 1704,
                description: '[center][img]https://staticdelivery.nexusmods.com/mods/1704/images/172268/x.png[/img][/center]\n<br />' +
                    '[center][color=#444444]Features[/color]\n<br />﻿[/center]\n<br />[list]\n<br />' +
                    '[*]Convenient inventory management.[/*]\n<br />[*]The Mod Configuration Menu (MCM).[/*]\n<br />[/list]',
                modRequirements: {
                    nexusRequirements: {
                        nodes: [
                            { modId: '30379', modName: 'Skyrim Script Extender (SKSE64)', gameId: '1704', notes: '', externalRequirement: false, url: '' },
                            { modId: '0', modName: 'Some Tool &amp; Kit', gameId: '1704', notes: 'for the patcher', externalRequirement: true, url: 'https://example.org/tool' }
                        ]
                    },
                    // Nexus sends some names HTML-escaped, as USSEP's page shows.
                    dlcRequirements: [{ gameExpansion: { name: 'Dawnguard' }, notes: '' }, { gameExpansion: { name: 'Saints &amp; Seducers' }, notes: '' }]
                }
            }]
        },
        modFiles: [
            { fileId: 35169, name: 'SkyUI_5_1_SE', version: '5.1SE', category: 'ARCHIVED', sizeInBytes: '2778523', date: 1506823286, description: '7z archive.', primary: 0, uri: 'SkyUI_5_1_SE-12604-5-1SE.7z' },
            { fileId: 35407, name: 'SkyUI_5_2_SE', version: '5.2SE', category: 'OLD_VERSION', sizeInBytes: '2783417', date: 1507064606, description: '', primary: 0, uri: 'SkyUI_5_2_SE-12604-5-2SE.7z' },
            { fileId: 801234, name: 'SkyUI', version: '6.9', category: 'MAIN', sizeInBytes: '2633757', date: 1778020881, description: '[url=https://www.nexusmods.com/skyrimspecialedition/articles/11836]SkyUI 6 Update[/url]\n<br />Supports 1.5.97 and 1.6.1170', primary: 1, uri: 'SkyUI-12604-6-9-1778020881.zip' },
            { fileId: 801240, name: 'Simplified Chinese Patch', version: '1.0', category: 'OPTIONAL', sizeInBytes: '7844', date: 1778021000, description: '', primary: 0, uri: 'Simplified Chinese Patch-12604-1-0-1778021000.zip' }
        ]
    }
};

describe('reading a Nexus mod', () => {
    it('answers its description as text, its requirements, and the files it offers now', async () => {
        const { catalogue, requests } = fakeNexus(() => skyUiMod);

        const mod = await catalogue.readMod(12604);

        expect(mod).toMatchObject({
            modId: 12604, name: 'SkyUI', version: '6.9', author: 'SkyUI Team', uploader: 'schlangster',
            url: 'https://www.nexusmods.com/skyrimspecialedition/mods/12604',
            description: 'Features\n\n- Convenient inventory management.\n- The Mod Configuration Menu (MCM).'
        });
        expect(mod.requirements).toEqual([
            { modId: 30379, name: 'Skyrim Script Extender (SKSE64)', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/30379' },
            { name: 'Some Tool & Kit', notes: 'for the patcher', url: 'https://example.org/tool' }
        ]);
        expect(mod.dlcRequirements).toEqual(['Dawnguard', 'Saints & Seducers']);
        expect(mod.files).toEqual([
            {
                fileId: 801234, name: 'SkyUI', version: '6.9', category: 'main', fileName: 'SkyUI-12604-6-9-1778020881.zip',
                sizeBytes: 2633757, uploaded: '2026-05-05',
                description: 'SkyUI 6 Update (https://www.nexusmods.com/skyrimspecialedition/articles/11836)\nSupports 1.5.97 and 1.6.1170'
            },
            {
                fileId: 801240, name: 'Simplified Chinese Patch', version: '1.0', category: 'optional',
                fileName: 'Simplified Chinese Patch-12604-1-0-1778021000.zip', sizeBytes: 7844, uploaded: '2026-05-05'
            }
        ]);
        expect(mod.olderFiles).toBe(2);
        expect(requests[0].variables).toEqual({ ids: [{ gameDomain: 'skyrimspecialedition', modId: 12604 }], modId: '12604', gameId: '1704' });
    });

    it('cuts a long description, and says so', async () => {
        const long = structuredClone(skyUiMod);
        long.data.legacyModsByDomain.nodes[0].description = '[b]Changelog[/b]\n<br />' + 'A line about one more fix.\n<br />'.repeat(800);
        const { catalogue } = fakeNexus(() => long);

        const mod = await catalogue.readMod(12604);
        expect(mod.description.length).toBeLessThanOrEqual(6000);
        expect(mod.description.startsWith('Changelog\nA line about one more fix.')).toBe(true);
        expect(mod.descriptionCut).toMatch(/nexusmods\.com\/skyrimspecialedition\/mods\/12604/);
    });

    it('says plainly when there is no such mod', async () => {
        const { catalogue } = fakeNexus(() => ({ data: { legacyModsByDomain: { nodes: [] }, modFiles: [] } }));
        const error = await catalogue.readMod(99999999).catch(e => e);
        expect(error).toBeInstanceOf(NexusError);
        expect(error.code).toBe('notFound');
        expect(error.message).toMatch(/No Nexus mod 99999999 for Skyrim Special Edition.*searchNexus/);
    });
});

describe('when Nexus does not answer as it should', () => {
    it('names Nexus and the cause: unreachable, an HTTP status, or an error in the answer', async () => {
        const unreachable = new NexusCatalogue({
            fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, appVersion: '0.1.0'
        });
        await expect(unreachable.searchMods({ limit: 1 })).rejects.toMatchObject({ code: 'unavailable', message: expect.stringMatching(/Nexus Mods could not be reached.*fetch failed/) });

        const throttled = fakeNexus(() => ({ message: 'Rate limit exceeded' }), 429).catalogue;
        await expect(throttled.searchMods({ limit: 1 })).rejects.toMatchObject({ code: 'unavailable', message: expect.stringMatching(/429/) });

        const broken = fakeNexus(() => ({ errors: [{ message: "Field 'nope' doesn't exist" }] })).catalogue;
        await expect(broken.readMod(1)).rejects.toMatchObject({ code: 'unavailable', message: expect.stringMatching(/Field 'nope'/) });
    });
});

describe('the Nexus account behind NEXUS_API_KEY', () => {
    /** Nexus's v1 users/validate, as it answers a premium key: the key and the e-mail address come back too. */
    function validating(status: number, body: unknown = {}) {
        const requests: { url: string; headers: Record<string, string> }[] = [];
        const fetch = (async (url: string, init: RequestInit) => {
            requests.push({ url, headers: init.headers as Record<string, string> });
            return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof globalThis.fetch;
        return { fetch, requests };
    }
    const premiumUser = {
        user_id: 1234, key: 'the-secret-key', name: 'SomeModder', is_premium: true, is_supporter: true,
        email: 'someone@example.org', profile_url: 'https://www.nexusmods.com/users/1234'
    };

    it('says so when no key is set, without asking Nexus', async () => {
        const nexus = validating(200, premiumUser);
        const catalogue = new NexusCatalogue({ fetch: nexus.fetch, appVersion: '0.1.0' });
        expect(await catalogue.account()).toEqual({ apiKey: false });
        expect(nexus.requests).toHaveLength(0);
    });

    it('names the account and whether it is premium — never the key or the e-mail address — and asks once', async () => {
        const nexus = validating(200, premiumUser);
        const catalogue = new NexusCatalogue({ fetch: nexus.fetch, appVersion: '0.1.0', apiKey: 'the-secret-key' });

        const account = await catalogue.account();
        expect(account).toEqual({ apiKey: true, name: 'SomeModder', premium: true, supporter: true });
        expect(JSON.stringify(account)).not.toMatch(/the-secret-key|someone@example/);
        expect(nexus.requests[0].url).toBe('https://api.nexusmods.com/v1/users/validate.json');
        expect(nexus.requests[0].headers).toMatchObject({ apikey: 'the-secret-key', 'Application-Name': 'skyrim-modding-tools-mcp' });

        await catalogue.account();
        expect(nexus.requests).toHaveLength(1);
    });

    it('reports a key Nexus refuses as refused, with what to do', async () => {
        const nexus = validating(401, { message: 'Please provide a valid API Key' });
        const catalogue = new NexusCatalogue({ fetch: nexus.fetch, appVersion: '0.1.0', apiKey: 'wrong' });
        expect(await catalogue.account()).toEqual({
            apiKey: true, problem: expect.stringMatching(/refused.*NEXUS_API_KEY.*nexusmods\.com\/settings\/api-keys/)
        });
    });

    it('asks again after Nexus could not be reached, and says it could not check', async () => {
        let calls = 0;
        const fetch = (async () => {
            calls++;
            if (calls === 1) throw new TypeError('fetch failed');
            return new Response(JSON.stringify({ ...premiumUser, is_premium: false }), { status: 200 });
        }) as unknown as typeof globalThis.fetch;
        const catalogue = new NexusCatalogue({ fetch, appVersion: '0.1.0', apiKey: 'k' });

        expect(await catalogue.account()).toEqual({ apiKey: true, unchecked: expect.stringMatching(/could not be reached/) });
        expect(await catalogue.account()).toEqual({ apiKey: true, name: 'SomeModder', premium: false, supporter: true });
    });
});

describe('downloading a Nexus file', () => {
    const roots: string[] = [];
    afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
    function downloads(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrim-nexus-downloads-'));
        roots.push(dir);
        return dir;
    }

    const bytes = 'PK\u0003\u0004 a small archive';
    /** Nexus's v1 file details and download links, its GraphQL for the mod's name, and the CDN. */
    function premiumNexus(options: { size?: number; linksStatus?: number; served?: string } = {}) {
        const requests: { url: string; headers: Record<string, string> }[] = [];
        const fetch = (async (url: string, init: RequestInit = {}) => {
            requests.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
            const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
            if (url.endsWith('/files/734848.json')) {
                return json({
                    file_id: 734848, name: 'SkyUI SDK', version: '1.0', category_id: 3, category_name: 'OPTIONAL',
                    file_name: 'SkyUI SDK-12604-1-0-1774393133.zip', size_in_bytes: options.size ?? Buffer.byteLength(bytes), uploaded_timestamp: 1774393133
                });
            }
            if (url.endsWith('/files/734848/download_link.json')) {
                return options.linksStatus
                    ? json({ message: 'You don\'t have permission to get download links from the API without visting nexusmods.com - this is for premium users only.' }, options.linksStatus)
                    : json([{ name: 'Nexus Global Content Delivery Network', short_name: 'Nexus CDN', URI: 'https://cf-files.nexusmods.com/cdn/1704/12604/SkyUI%20SDK.zip?md5=x&expires=1&user_id=1' }]);
            }
            if (url.startsWith('https://cf-files.nexusmods.com/')) return new Response(options.served ?? bytes);
            if (url === 'https://api.nexusmods.com/v2/graphql') return json({ data: { legacyModsByDomain: { nodes: [{ modId: 12604, name: 'SkyUI' }] } } });
            throw new Error(`unexpected request ${url}`);
        }) as unknown as typeof globalThis.fetch;
        return { catalogue: new NexusCatalogue({ fetch, appVersion: '0.1.0', apiKey: 'the-secret-key' }), requests };
    }

    it('fetches the file into the downloads folder, and records it beside it the way Mod Organizer does', async () => {
        const dir = downloads();
        const { catalogue, requests } = premiumNexus();

        const got = await catalogue.downloadFile(12604, 734848, dir);

        const file = path.join(dir, 'SkyUI SDK-12604-1-0-1774393133.zip');
        expect(got).toEqual({
            path: file, modId: 12604, fileId: 734848, modName: 'SkyUI', name: 'SkyUI SDK', version: '1.0',
            category: 'optional', sizeBytes: Buffer.byteLength(bytes)
        });
        expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
        expect(fs.readdirSync(dir).sort()).toEqual(['SkyUI SDK-12604-1-0-1774393133.zip', 'SkyUI SDK-12604-1-0-1774393133.zip.meta']);
        expect(fs.readFileSync(`${file}.meta`, 'utf8').split(/\r?\n/)).toEqual(expect.arrayContaining([
            '[General]', 'gameName=SkyrimSE', 'modID=12604', 'fileID=734848', 'name=SkyUI SDK', 'modName=SkyUI', 'version=1.0',
            'fileCategory=3', 'repository=Nexus', 'installed=false', 'uninstalled=false', 'paused=false', 'removed=false'
        ]));

        // The key goes to Nexus's API only — never to the CDN the file comes from.
        const cdn = requests.find(r => r.url.startsWith('https://cf-files.nexusmods.com/'))!;
        expect(JSON.stringify(cdn.headers)).not.toContain('the-secret-key');
        expect(requests.find(r => r.url.endsWith('download_link.json'))!.headers).toMatchObject({ apikey: 'the-secret-key' });
    });

    it('leaves a file already there with the right size as it is', async () => {
        const dir = downloads();
        fs.writeFileSync(path.join(dir, 'SkyUI SDK-12604-1-0-1774393133.zip'), bytes);
        const { catalogue, requests } = premiumNexus();

        const got = await catalogue.downloadFile(12604, 734848, dir);
        expect(got).toMatchObject({ alreadyThere: true, sizeBytes: Buffer.byteLength(bytes) });
        expect(requests.some(r => r.url.startsWith('https://cf-files.nexusmods.com/'))).toBe(false);
    });

    it('keeps nothing of a download that came out the wrong size', async () => {
        const dir = downloads();
        const { catalogue } = premiumNexus({ served: 'PK cut off' });
        await expect(catalogue.downloadFile(12604, 734848, dir)).rejects.toThrow(new RegExp(`10 of ${Buffer.byteLength(bytes)} bytes.*again`));
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('says what is missing: a key, or a premium account', async () => {
        const dir = downloads();
        const noKey = new NexusCatalogue({ appVersion: '0.1.0', fetch: (async () => { throw new Error('no request expected'); }) as unknown as typeof fetch });
        await expect(noKey.downloadFile(12604, 734848, dir)).rejects.toThrow(/NEXUS_API_KEY/);

        const free = premiumNexus({ linksStatus: 403 }).catalogue;
        await expect(free.downloadFile(12604, 734848, dir)).rejects.toThrow(/premium.*nexusmods\.com\/skyrimspecialedition\/mods\/12604\?tab=files/);
        expect(fs.readdirSync(dir)).toEqual([]);
    });
});

describe('BBCode as text', () => {
    it('keeps the words and the links, and drops the markup and the pictures', () => {
        expect(bbcodeToText('[b]Bold[/b] and [size=4][color=red]big[/color][/size]')).toBe('Bold and big');
        expect(bbcodeToText('See [url=https://example.org/a]the guide[/url] or [url]https://example.org/b[/url].'))
            .toBe('See the guide (https://example.org/a) or https://example.org/b.');
        expect(bbcodeToText('[img]https://example.org/x.png[/img]Text[youtube]abc123[/youtube]')).toBe('Text');
        expect(bbcodeToText('[list][*]One[*]Two[/list]')).toBe('- One\n- Two');
        expect(bbcodeToText('Tom &amp; Jerry&#39;s &quot;mod&quot;<br />next')).toBe('Tom & Jerry\'s "mod"\nnext');
        expect(bbcodeToText('a\n<br />\n<br />\n<br />\n<br />b')).toBe('a\n\nb');
    });
});
