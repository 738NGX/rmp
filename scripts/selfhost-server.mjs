#!/usr/bin/env node
/**
 * Minimal companion server for a private RMP deployment.
 * It deliberately uses Node built-ins only: no database daemon and no runtime
 * dependency installation are required.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
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
const themePresetsPath = resolve(dataDir, 'theme-presets.json');
const MAX_BODY_BYTES = 35 * 1024 * 1024;
const UPSTREAM_ORIGIN = 'https://railmapgen.org';
const proxiedPathPrefixes = ['/styles/', '/fonts/', '/rmg/', '/rmg-palette/', '/rmp-gallery/'];

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

const writeJsonAtomically = async (path, value) => {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value), 'utf8');
    await rename(temporaryPath, path);
};

const readIndex = async () => {
    try {
        const index = JSON.parse(await readFile(indexPath, 'utf8'));
        return Array.isArray(index.saves) ? index : { version: 1, saves: [] };
    } catch (error) {
        if (error?.code === 'ENOENT') return { version: 1, saves: [] };
        throw error;
    }
};

const readThemePresets = async () => {
    try {
        const savedPresets = JSON.parse(await readFile(themePresetsPath, 'utf8'));
        return Array.isArray(savedPresets.presets) ? savedPresets : { version: 1, presets: [] };
    } catch (error) {
        if (error?.code === 'ENOENT') return { version: 1, presets: [] };
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
const findSave = (index, id) => index.saves.find(save => save.id === id);
const isValidId = id => /^[a-zA-Z0-9_-]{8,64}$/.test(id);
const isValidThemePreset = preset =>
    preset &&
    isValidId(preset.id) &&
    validName(preset.name) &&
    Array.isArray(preset.theme) &&
    preset.theme.length === 4 &&
    typeof preset.theme[0] === 'string' &&
    typeof preset.theme[1] === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(preset.theme[2]) &&
    ['#000', '#fff'].includes(preset.theme[3]);

const handleThemePresets = async (request, response) => {
    if (!hasValidCredentials(request)) {
        response.setHeader('WWW-Authenticate', 'Basic realm="RMP self-hosted saves"');
        return sendError(response, 401, 'Authentication failed.');
    }

    if (request.method === 'GET') {
        const savedPresets = await readThemePresets();
        return sendJson(response, 200, { presets: savedPresets.presets });
    }

    if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        if (!Array.isArray(body.presets) || body.presets.length > 100 || !body.presets.every(isValidThemePreset))
            return sendError(response, 400, 'Invalid custom theme presets.');
        if (new Set(body.presets.map(preset => preset.id)).size !== body.presets.length)
            return sendError(response, 400, 'Duplicate custom theme preset ids.');
        const savedPresets = { version: 1, presets: body.presets };
        await writeJsonAtomically(themePresetsPath, savedPresets);
        return sendJson(response, 200, { presets: savedPresets.presets });
    }

    return sendError(response, 405, 'Method not allowed.');
};

const handleApi = async (request, response, url) => {
    if (!hasValidCredentials(request)) {
        response.setHeader('WWW-Authenticate', 'Basic realm="RMP self-hosted saves"');
        sendError(response, 401, 'Authentication failed.');
        return;
    }

    const parts = url.pathname.slice('/api/rmp-saves'.length).split('/').filter(Boolean);
    const id = parts[0];
    if (id && !isValidId(id)) return sendError(response, 400, 'Invalid save id.');
    const index = await readIndex();

    if (request.method === 'GET' && !id) {
        return sendJson(response, 200, {
            saves: [...index.saves].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        });
    }

    if (request.method === 'POST' && !id) {
        const body = await readJsonBody(request);
        if (!validName(body.name) || !validContent(body.content))
            return sendError(response, 400, 'Invalid save name or content.');
        const now = new Date().toISOString();
        const save = {
            id: randomUUID().replaceAll('-', ''),
            name: body.name.trim(),
            createdAt: now,
            updatedAt: now,
            revision: 1,
        };
        await writeFile(contentPath(save.id), body.content, 'utf8');
        index.saves.push(save);
        await writeJsonAtomically(indexPath, index);
        return sendJson(response, 201, { save });
    }

    const save = findSave(index, id);
    if (!save) return sendError(response, 404, 'Save not found.');

    if (request.method === 'GET') {
        return sendJson(response, 200, { save, content: await readFile(contentPath(id), 'utf8') });
    }

    if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        if (!Number.isInteger(body.revision) || !validContent(body.content))
            return sendError(response, 400, 'Invalid save content.');
        if (body.revision !== save.revision) return sendError(response, 409, 'Save changed on another device.');
        if (body.name !== undefined && !validName(body.name)) return sendError(response, 400, 'Invalid save name.');
        if (body.name !== undefined) save.name = body.name.trim();
        save.revision += 1;
        save.updatedAt = new Date().toISOString();
        await writeFile(contentPath(id), body.content, 'utf8');
        await writeJsonAtomically(indexPath, index);
        return sendJson(response, 200, { save });
    }

    if (request.method === 'DELETE') {
        index.saves = index.saves.filter(entry => entry.id !== id);
        await unlink(contentPath(id)).catch(error => {
            if (error?.code !== 'ENOENT') throw error;
        });
        await writeJsonAtomically(indexPath, index);
        return sendJson(response, 200, { ok: true });
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

await mkdir(dataDir, { recursive: true });
createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (url.pathname === '/healthz') return sendJson(response, 200, { ok: true });
        if (url.pathname === '/api/rmp-saves/themes') return await handleThemePresets(request, response);
        if (url.pathname.startsWith('/api/rmp-saves')) return await handleApi(request, response, url);
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
