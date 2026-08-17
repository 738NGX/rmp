#!/usr/bin/env node
/**
 * Minimal companion server for a private RMP deployment.
 * It deliberately uses Node built-ins only: no database daemon and no runtime
 * dependency installation are required.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const configPath = resolve(rootDir, 'rmp-selfhost.config.json');
let config;
try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
    console.error(`Unable to read ${configPath}. Copy rmp-selfhost.config.example.json and configure it.`);
    console.error(error);
    process.exit(1);
}

const password = config.password;
if (typeof password !== 'string' || password.length < 12) {
    console.error('The self-hosted configuration requires a password of at least 12 characters.');
    process.exit(1);
}

const port = Number.isInteger(config.port) && config.port > 0 && config.port < 65536 ? config.port : 4173;
const distDir = resolve(rootDir, config.distDir ?? 'dist');
const dataDir = resolve(rootDir, config.dataDir ?? 'rmp-data');
const indexPath = resolve(dataDir, 'index.json');
const paletteCitiesPath = resolve(dataDir, 'palette-cities.json');
const profilePath = resolve(dataDir, 'profile.json');
const historyRootPath = resolve(dataDir, 'history');
const MAX_BODY_BYTES = 35 * 1024 * 1024;
const LEASE_DURATION_MS = 45_000;
const HISTORY_LIMIT = 3;
const UPSTREAM_ORIGIN = 'https://railmapgen.org';
const proxiedPathPrefixes = ['/styles/', '/fonts/', '/rmg/', '/rmg-palette/', '/rmp-gallery/'];
const leases = new Map();
let mutationQueue = Promise.resolve();

/** Serialize mutations so two simultaneous HTTP requests cannot race on index.json. */
const withMutationLock = operation => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
};

const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const sendJson = (response, status, body) => {
    response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(body));
};

const sendError = (response, status, error) => sendJson(response, status, { error });

/**
 * RMP embeds a small set of companion Rail Map apps (notably rmg-palette for
 * the colour picker). Development uses a Vite proxy for these routes; mirror
 * that behaviour in the standalone server without turning it into an open proxy.
 */
const serveUpstreamCompanion = async (request, response, url) => {
    const upstreamResponse = await fetch(new URL(`${url.pathname}${url.search}`, UPSTREAM_ORIGIN), {
        headers: {
            Accept: request.headers.accept ?? '*/*',
            'Accept-Language': request.headers['accept-language'] ?? '',
        },
    });
    const headers = {
        'Cache-Control': upstreamResponse.headers.get('cache-control') ?? 'public, max-age=3600',
        'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/octet-stream',
    };
    response.writeHead(upstreamResponse.status, headers);
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
};

const fetchUpstreamJson = async pathname => {
    const upstreamResponse = await fetch(new URL(pathname, UPSTREAM_ORIGIN));
    if (!upstreamResponse.ok) throw new Error(`Unable to fetch palette resource (${upstreamResponse.status}).`);
    return await upstreamResponse.json();
};

const hasValidCredentials = request => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Basic ')) return false;
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const supplied = decoded.slice(decoded.indexOf(':') + 1);
        const expectedHash = createHash('sha256').update(password).digest();
        const suppliedHash = createHash('sha256').update(supplied).digest();
        return timingSafeEqual(expectedHash, suppliedHash);
    } catch {
        return false;
    }
};

const readBody = request =>
    new Promise((resolveBody, reject) => {
        let size = 0;
        const chunks = [];
        request.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Save is too large (maximum 35 MB).'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });

const readJsonBody = async request => JSON.parse(await readBody(request));

const writeTextAtomically = async (path, value) => {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, value, 'utf8');
    await rename(temporaryPath, path);
};

const writeJsonAtomically = async (path, value) => writeTextAtomically(path, JSON.stringify(value));

const readIndex = async () => {
    try {
        const index = JSON.parse(await readFile(indexPath, 'utf8'));
        if (!Array.isArray(index.saves)) return { version: 2, saves: [], groups: [] };
        return { version: 2, saves: index.saves, groups: Array.isArray(index.groups) ? index.groups : [] };
    } catch (error) {
        if (error?.code === 'ENOENT') return { version: 2, saves: [], groups: [] };
        throw error;
    }
};

const readProfile = async () => {
    try {
        const profile = JSON.parse(await readFile(profilePath, 'utf8'));
        return typeof profile === 'object' && profile ? { version: 1, language: profile.language } : { version: 1 };
    } catch (error) {
        if (error?.code === 'ENOENT') return { version: 1 };
        throw error;
    }
};

const readPaletteCities = async () => {
    try {
        const savedCities = JSON.parse(await readFile(paletteCitiesPath, 'utf8'));
        return Array.isArray(savedCities.cities) ? savedCities : { version: 1, cities: [] };
    } catch (error) {
        if (error?.code === 'ENOENT') return { version: 1, cities: [] };
        throw error;
    }
};

const validName = name => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 120;
const validContent = content => {
    if (typeof content !== 'string' || content.length > MAX_BODY_BYTES) return false;
    try {
        const value = JSON.parse(content);
        return value && typeof value === 'object' && Number.isInteger(value.version);
    } catch {
        return false;
    }
};
const contentPath = id => resolve(dataDir, `${id}.json`);
const svgPath = id => resolve(dataDir, `${id}.svg`);
const historyDir = id => resolve(historyRootPath, id);
const historyPath = (id, revision) => resolve(historyDir(id), `${revision}.json`);
const findSave = (index, id) => index.saves.find(save => save.id === id);
const isValidId = id => /^[a-zA-Z0-9_-]{8,64}$/.test(id);
const isValidDeviceId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(id);
const validLanguage = language => ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'].includes(language);
const validSvg = svg =>
    typeof svg === 'string' && svg.length > 0 && svg.length <= MAX_BODY_BYTES && /^<svg[\s>]/i.test(svg.trim());

/** Save the version being replaced so an owner can recover recent work. */
const archiveSaveVersion = async (id, save) => {
    let content;
    try {
        content = await readFile(contentPath(id), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    if (!validContent(content)) throw new Error(`Refusing to archive invalid content for save ${id}.`);

    await mkdir(historyDir(id), { recursive: true });
    await writeJsonAtomically(historyPath(id, save.revision), {
        revision: save.revision,
        name: save.name,
        updatedAt: save.updatedAt,
        content,
    });
    const revisions = (await readdir(historyDir(id), { withFileTypes: true }))
        .filter(entry => entry.isFile() && /^\d+\.json$/.test(entry.name))
        .map(entry => Number.parseInt(entry.name, 10))
        .sort((a, b) => b - a);
    await Promise.all(revisions.slice(HISTORY_LIMIT).map(revision => unlink(historyPath(id, revision))));
};

const readSaveHistory = async id => {
    try {
        const entries = await readdir(historyDir(id), { withFileTypes: true });
        const versions = await Promise.all(
            entries
                .filter(entry => entry.isFile() && /^\d+\.json$/.test(entry.name))
                .map(async entry => {
                    try {
                        const version = JSON.parse(await readFile(resolve(historyDir(id), entry.name), 'utf8'));
                        if (
                            !Number.isInteger(version.revision) ||
                            !validName(version.name) ||
                            typeof version.updatedAt !== 'string' ||
                            !validContent(version.content)
                        )
                            return undefined;
                        return version;
                    } catch {
                        return undefined;
                    }
                })
        );
        return versions.filter(Boolean).sort((a, b) => b.revision - a.revision);
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
};
/** Public SVGs are static documents; strip active content before persisting them. */
const sanitizePublicSvg = svg =>
    svg
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s(?:href|xlink:href)\s*=\s*("|')\s*javascript:[\s\S]*?\1/gi, '');
const validTranslation = value =>
    value &&
    typeof value === 'object' &&
    validName(value.en) &&
    Object.entries(value).every(([language, name]) => validLanguage(language) && validName(name));
const isValidPaletteLine = line =>
    line &&
    typeof line.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(line.id) &&
    validTranslation(line.name) &&
    /^#[0-9a-fA-F]{6}$/.test(line.colour) &&
    (line.fg === undefined || ['#000', '#fff'].includes(line.fg));
const isValidPaletteCity = city =>
    city &&
    typeof city.id === 'string' &&
    /^selfhost-[a-zA-Z0-9_-]{8,64}$/.test(city.id) &&
    validTranslation(city.name) &&
    Array.isArray(city.lines) &&
    city.lines.length <= 100 &&
    city.lines.every(isValidPaletteLine) &&
    new Set(city.lines.map(line => line.id)).size === city.lines.length;

const getLease = id => {
    const lease = leases.get(id);
    if (lease && lease.expiresAt <= Date.now()) leases.delete(id);
    return leases.get(id);
};

const acquireLease = (id, deviceId) => {
    const current = getLease(id);
    if (current && current.deviceId !== deviceId) return null;
    const expiresAt = Date.now() + LEASE_DURATION_MS;
    leases.set(id, { deviceId, expiresAt });
    return new Date(expiresAt).toISOString();
};

const hasLease = (id, deviceId) => getLease(id)?.deviceId === deviceId;

const handlePaletteCities = async (request, response) => {
    if (!requireAuthentication(request, response)) return;
    if (request.method === 'GET') {
        const savedCities = await readPaletteCities();
        return sendJson(response, 200, { cities: savedCities.cities });
    }

    if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        if (!Array.isArray(body.cities) || body.cities.length > 30 || !body.cities.every(isValidPaletteCity))
            return sendError(response, 400, 'Invalid self-hosted palette cities.');
        if (new Set(body.cities.map(city => city.id)).size !== body.cities.length)
            return sendError(response, 400, 'Duplicate self-hosted palette city ids.');
        const savedCities = { version: 1, cities: body.cities };
        await withMutationLock(() => writeJsonAtomically(paletteCitiesPath, savedCities));
        return sendJson(response, 200, { cities: savedCities.cities });
    }

    return sendError(response, 405, 'Method not allowed.');
};

const servePaletteResource = async (response, url) => {
    const cities = (await readPaletteCities()).cities;
    if (url.pathname === '/rmg-palette/resources/city-config.compressed.json') {
        const upstreamCities = await fetchUpstreamJson(url.pathname);
        const selfHostedCities = cities.map(city => [
            city.id,
            'selfhost',
            [city.name.en, city.name['zh-Hans'] ?? city.name.en, city.name['zh-Hant'] ?? city.name.en],
            Object.fromEntries(
                Object.entries(city.name).filter(([language]) => !['en', 'zh-Hans', 'zh-Hant'].includes(language))
            ),
        ]);
        return sendJson(response, 200, [...upstreamCities, ...selfHostedCities]);
    }
    if (url.pathname === '/rmg-palette/resources/country-config.compressed.json') {
        const upstreamCountries = await fetchUpstreamJson(url.pathname);
        const selfHostedCountry = [
            'selfhost',
            ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'],
            ['Self-hosted', '自托管', '自託管'],
            { ja: 'セルフホスト', ko: '자체 호스팅' },
        ];
        return sendJson(response, 200, [
            ...upstreamCountries.filter(country => country[0] !== 'selfhost'),
            selfHostedCountry,
        ]);
    }
    const paletteMatch = /^\/rmg-palette\/resources\/palettes\/(selfhost-[a-zA-Z0-9_-]+)\.json$/.exec(url.pathname);
    if (paletteMatch) {
        const city = cities.find(entry => entry.id === paletteMatch[1]);
        if (!city) return sendError(response, 404, 'Palette not found.');
        return sendJson(response, 200, city.lines);
    }
    return false;
};

const requireAuthentication = (request, response) => {
    if (hasValidCredentials(request)) return true;
    response.setHeader('WWW-Authenticate', 'Basic realm="RMP self-hosted saves"');
    sendError(response, 401, 'Authentication failed.');
    return false;
};

const handleGroups = async (request, response, url) => {
    if (!requireAuthentication(request, response)) return;
    const parts = url.pathname.slice('/api/rmp-saves/groups'.length).split('/').filter(Boolean);
    const id = parts[0];
    if (id && !isValidId(id)) return sendError(response, 400, 'Invalid group id.');

    if (request.method === 'GET' && !id) return sendJson(response, 200, { groups: (await readIndex()).groups });
    if (request.method === 'POST' && !id) {
        const body = await readJsonBody(request);
        if (!validName(body.name)) return sendError(response, 400, 'Invalid group name.');
        return withMutationLock(async () => {
            const index = await readIndex();
            const group = {
                id: randomUUID().replaceAll('-', ''),
                name: body.name.trim(),
                createdAt: new Date().toISOString(),
            };
            index.groups.push(group);
            await writeJsonAtomically(indexPath, index);
            return sendJson(response, 201, { group });
        });
    }
    if (request.method === 'DELETE' && id) {
        return withMutationLock(async () => {
            const index = await readIndex();
            if (!index.groups.some(group => group.id === id)) return sendError(response, 404, 'Group not found.');
            index.groups = index.groups.filter(group => group.id !== id);
            index.saves.forEach(save => {
                if (save.groupId === id) delete save.groupId;
            });
            await writeJsonAtomically(indexPath, index);
            return sendJson(response, 200, { ok: true });
        });
    }
    return sendError(response, 405, 'Method not allowed.');
};

const handleProfile = async (request, response) => {
    if (!requireAuthentication(request, response)) return;
    if (request.method === 'GET') {
        const { language } = await readProfile();
        return sendJson(response, 200, { profile: language ? { language } : {} });
    }
    if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        if (body.language !== undefined && !validLanguage(body.language))
            return sendError(response, 400, 'Invalid language.');
        return withMutationLock(async () => {
            const profile = { version: 1, ...(body.language ? { language: body.language } : {}) };
            await writeJsonAtomically(profilePath, profile);
            return sendJson(response, 200, { profile: body.language ? { language: body.language } : {} });
        });
    }
    return sendError(response, 405, 'Method not allowed.');
};

const handleApi = async (request, response, url) => {
    if (!requireAuthentication(request, response)) return;

    const parts = url.pathname.slice('/api/rmp-saves'.length).split('/').filter(Boolean);
    const id = parts[0];
    if (id && !isValidId(id)) return sendError(response, 400, 'Invalid save id.');

    if (request.method === 'GET' && !id) {
        const index = await readIndex();
        return sendJson(response, 200, {
            saves: [...index.saves].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        });
    }

    if (request.method === 'POST' && !id) {
        const body = await readJsonBody(request);
        if (!validName(body.name) || !validContent(body.content))
            return sendError(response, 400, 'Invalid save name or content.');
        return withMutationLock(async () => {
            const index = await readIndex();
            if (body.groupId !== undefined && !index.groups.some(group => group.id === body.groupId))
                return sendError(response, 400, 'Invalid group.');
            const now = new Date().toISOString();
            const save = {
                id: randomUUID().replaceAll('-', ''),
                name: body.name.trim(),
                createdAt: now,
                updatedAt: now,
                revision: 1,
                ...(body.groupId ? { groupId: body.groupId } : {}),
            };
            await writeTextAtomically(contentPath(save.id), body.content);
            index.saves.push(save);
            await writeJsonAtomically(indexPath, index);
            return sendJson(response, 201, { save });
        });
    }

    if (!id) return sendError(response, 405, 'Method not allowed.');

    if (parts[1] === 'lease') {
        const body = await readJsonBody(request);
        if (!isValidDeviceId(body.deviceId)) return sendError(response, 400, 'Invalid device id.');
        const index = await readIndex();
        if (!findSave(index, id)) return sendError(response, 404, 'Save not found.');
        if (request.method === 'POST') {
            const expiresAt = acquireLease(id, body.deviceId);
            if (!expiresAt) return sendError(response, 423, 'This save is currently being edited on another device.');
            return sendJson(response, 200, { expiresAt });
        }
        if (request.method === 'DELETE') {
            if (hasLease(id, body.deviceId)) leases.delete(id);
            return sendJson(response, 200, { ok: true });
        }
        return sendError(response, 405, 'Method not allowed.');
    }

    if (parts[1] === 'duplicate' && request.method === 'POST') {
        return withMutationLock(async () => {
            const index = await readIndex();
            const save = findSave(index, id);
            if (!save) return sendError(response, 404, 'Save not found.');
            const now = new Date().toISOString();
            const copy = {
                id: randomUUID().replaceAll('-', ''),
                name: `${save.name} (copy)`.slice(0, 120),
                createdAt: now,
                updatedAt: now,
                revision: 1,
                ...(save.groupId ? { groupId: save.groupId } : {}),
            };
            await writeTextAtomically(contentPath(copy.id), await readFile(contentPath(id), 'utf8'));
            index.saves.push(copy);
            await writeJsonAtomically(indexPath, index);
            return sendJson(response, 201, { save: copy });
        });
    }

    if (parts[1] === 'force' && request.method === 'POST') {
        const body = await readJsonBody(request);
        if (!validContent(body.content) || !isValidDeviceId(body.deviceId))
            return sendError(response, 400, 'Invalid recovery save content.');
        if (body.name !== undefined && !validName(body.name)) return sendError(response, 400, 'Invalid save name.');
        return withMutationLock(async () => {
            const index = await readIndex();
            const save = findSave(index, id);
            if (!save) return sendError(response, 404, 'Save not found.');
            await archiveSaveVersion(id, save);
            if (body.name !== undefined) save.name = body.name.trim();
            save.revision += 1;
            save.updatedAt = new Date().toISOString();
            await writeTextAtomically(contentPath(id), body.content);
            // A deliberate force save also takes ownership for subsequent autosaves.
            leases.set(id, { deviceId: body.deviceId, expiresAt: Date.now() + LEASE_DURATION_MS });
            await writeJsonAtomically(indexPath, index);
            return sendJson(response, 200, { save });
        });
    }

    if (parts[1] === 'history') {
        if (!parts[2] && request.method === 'GET') {
            const index = await readIndex();
            if (!findSave(index, id)) return sendError(response, 404, 'Save not found.');
            const versions = await readSaveHistory(id);
            return sendJson(response, 200, {
                versions: versions.map(({ revision, name, updatedAt }) => ({ revision, name, updatedAt })),
            });
        }

        if (parts[2] && request.method === 'POST' && /^\d+$/.test(parts[2])) {
            const revision = Number.parseInt(parts[2], 10);
            const body = await readJsonBody(request);
            if (!isValidDeviceId(body.deviceId)) return sendError(response, 400, 'Invalid device id.');
            return withMutationLock(async () => {
                const index = await readIndex();
                const save = findSave(index, id);
                if (!save) return sendError(response, 404, 'Save not found.');
                const version = (await readSaveHistory(id)).find(entry => entry.revision === revision);
                if (!version) return sendError(response, 404, 'Version not found.');
                await archiveSaveVersion(id, save);
                save.revision += 1;
                save.updatedAt = new Date().toISOString();
                await writeTextAtomically(contentPath(id), version.content);
                // Restoring is an owner-requested recovery action, so take the lease too.
                leases.set(id, { deviceId: body.deviceId, expiresAt: Date.now() + LEASE_DURATION_MS });
                await writeJsonAtomically(indexPath, index);
                return sendJson(response, 200, { save });
            });
        }

        return sendError(response, 405, 'Method not allowed.');
    }

    if (parts[1] === 'share') {
        if (request.method === 'POST') {
            return withMutationLock(async () => {
                const index = await readIndex();
                const save = findSave(index, id);
                if (!save) return sendError(response, 404, 'Save not found.');
                save.share ??= {
                    enabled: true,
                    token: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
                    updatedAt: new Date().toISOString(),
                };
                save.share.enabled = true;
                save.share.updatedAt = new Date().toISOString();
                await writeJsonAtomically(indexPath, index);
                return sendJson(response, 200, { save });
            });
        }
        if (request.method === 'DELETE') {
            return withMutationLock(async () => {
                const index = await readIndex();
                const save = findSave(index, id);
                if (!save) return sendError(response, 404, 'Save not found.');
                if (save.share) save.share.enabled = false;
                await unlink(svgPath(id)).catch(error => {
                    if (error?.code !== 'ENOENT') throw error;
                });
                await writeJsonAtomically(indexPath, index);
                return sendJson(response, 200, { save });
            });
        }
        return sendError(response, 405, 'Method not allowed.');
    }

    if (parts[1] === 'svg' && request.method === 'PUT') {
        const body = await readJsonBody(request);
        if (!Number.isInteger(body.revision) || !validSvg(body.svg)) return sendError(response, 400, 'Invalid SVG.');
        return withMutationLock(async () => {
            const index = await readIndex();
            const save = findSave(index, id);
            if (!save) return sendError(response, 404, 'Save not found.');
            if (!save.share?.enabled) return sendError(response, 409, 'Enable sharing before publishing SVG.');
            if (save.revision !== body.revision)
                return sendError(response, 409, 'Save changed before SVG could be published.');
            await writeFile(svgPath(id), sanitizePublicSvg(body.svg), 'utf8');
            save.share.publishedRevision = save.revision;
            save.share.updatedAt = new Date().toISOString();
            await writeJsonAtomically(indexPath, index);
            return sendJson(response, 200, { save });
        });
    }

    if (parts.length > 1) return sendError(response, 404, 'Not found.');

    const index = await readIndex();
    const save = findSave(index, id);
    if (!save) return sendError(response, 404, 'Save not found.');

    if (request.method === 'GET') {
        return sendJson(response, 200, { save, content: await readFile(contentPath(id), 'utf8') });
    }

    if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        if (!Number.isInteger(body.revision) || !validContent(body.content))
            return sendError(response, 400, 'Invalid save content.');
        if (!isValidDeviceId(body.deviceId)) return sendError(response, 400, 'Invalid device id.');
        if (!hasLease(id, body.deviceId))
            return sendError(response, 423, 'Editing lease has expired or belongs to another device.');
        if (body.name !== undefined && !validName(body.name)) return sendError(response, 400, 'Invalid save name.');
        return withMutationLock(async () => {
            const latestIndex = await readIndex();
            const latestSave = findSave(latestIndex, id);
            if (!latestSave) return sendError(response, 404, 'Save not found.');
            if (body.revision !== latestSave.revision)
                return sendError(response, 409, 'Save changed on another device.');
            if (!hasLease(id, body.deviceId))
                return sendError(response, 423, 'Editing lease has expired or belongs to another device.');
            await archiveSaveVersion(id, latestSave);
            if (body.name !== undefined) latestSave.name = body.name.trim();
            latestSave.revision += 1;
            latestSave.updatedAt = new Date().toISOString();
            await writeTextAtomically(contentPath(id), body.content);
            await writeJsonAtomically(indexPath, latestIndex);
            return sendJson(response, 200, { save: latestSave });
        });
    }

    if (request.method === 'PATCH') {
        const body = await readJsonBody(request);
        return withMutationLock(async () => {
            const latestIndex = await readIndex();
            const latestSave = findSave(latestIndex, id);
            if (!latestSave) return sendError(response, 404, 'Save not found.');
            if (
                body.groupId !== undefined &&
                body.groupId !== null &&
                !latestIndex.groups.some(group => group.id === body.groupId)
            )
                return sendError(response, 400, 'Invalid group.');
            if (body.groupId) latestSave.groupId = body.groupId;
            else delete latestSave.groupId;
            await writeJsonAtomically(indexPath, latestIndex);
            return sendJson(response, 200, { save: latestSave });
        });
    }

    if (request.method === 'DELETE') {
        return withMutationLock(async () => {
            const latestIndex = await readIndex();
            if (!findSave(latestIndex, id)) return sendError(response, 404, 'Save not found.');
            latestIndex.saves = latestIndex.saves.filter(entry => entry.id !== id);
            await unlink(contentPath(id)).catch(error => {
                if (error?.code !== 'ENOENT') throw error;
            });
            await unlink(svgPath(id)).catch(error => {
                if (error?.code !== 'ENOENT') throw error;
            });
            await rm(historyDir(id), { recursive: true, force: true });
            leases.delete(id);
            await writeJsonAtomically(indexPath, latestIndex);
            return sendJson(response, 200, { ok: true });
        });
    }

    return sendError(response, 405, 'Method not allowed.');
};

const serveStatic = async (response, url) => {
    let relativePath = decodeURIComponent(url.pathname.slice('/rmp/'.length));
    if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html';
    let filePath = resolve(distDir, relativePath);
    const relativeFilePath = relative(distDir, filePath);
    if (relativeFilePath.startsWith('..') || isAbsolute(relativeFilePath))
        return sendError(response, 403, 'Forbidden.');

    try {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('Not a file');
    } catch {
        // Vite's SPA fallback, while still returning 404 for a missing asset.
        if (extname(relativePath)) return sendError(response, 404, 'Not found.');
        filePath = resolve(distDir, 'index.html');
    }

    const extension = extname(filePath).toLowerCase();
    response.writeHead(200, {
        'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    });
    response.end(await readFile(filePath));
};

const servePublicSvg = async (response, token) => {
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(token)) return sendError(response, 404, 'Not found.');
    const index = await readIndex();
    const save = index.saves.find(
        entry => entry.share?.enabled && entry.share.token === token && entry.share.publishedRevision
    );
    if (!save) return sendError(response, 404, 'Not found.');
    try {
        response.writeHead(200, {
            // A share URL is stable while its SVG may be republished. Clients must
            // therefore revalidate instead of treating the previous revision as fresh.
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'Content-Security-Policy':
                "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data:",
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        });
        response.end(await readFile(svgPath(save.id)));
    } catch (error) {
        if (error?.code === 'ENOENT') return sendError(response, 404, 'Not found.');
        throw error;
    }
};

await mkdir(dataDir, { recursive: true });
createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (url.pathname === '/healthz') return sendJson(response, 200, { ok: true });
        const publicSvg = /^\/share\/([a-zA-Z0-9_-]+)\.svg$/.exec(url.pathname);
        if (request.method === 'GET' && publicSvg) return await servePublicSvg(response, publicSvg[1]);
        if (url.pathname === '/api/rmp-saves/palette-cities') return await handlePaletteCities(request, response);
        if (url.pathname.startsWith('/api/rmp-saves/groups')) return await handleGroups(request, response, url);
        if (url.pathname === '/api/rmp-saves/profile') return await handleProfile(request, response);
        if (url.pathname.startsWith('/api/rmp-saves')) return await handleApi(request, response, url);
        if (url.pathname.startsWith('/rmg-palette/resources/') && (await servePaletteResource(response, url)) !== false)
            return;
        if (proxiedPathPrefixes.some(prefix => url.pathname.startsWith(prefix)))
            return await serveUpstreamCompanion(request, response, url);
        if (url.pathname === '/rmp') {
            response.writeHead(302, { Location: '/rmp/' });
            return response.end();
        }
        if (url.pathname.startsWith('/rmp/')) return await serveStatic(response, url);
        return sendError(response, 404, 'Not found.');
    } catch (error) {
        console.error(error);
        return sendError(response, 500, error instanceof Error ? error.message : 'Internal server error.');
    }
}).listen(port, '0.0.0.0', () => {
    console.log(`RMP self-hosted server is listening on http://0.0.0.0:${port}/rmp/`);
});
