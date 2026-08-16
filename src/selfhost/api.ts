import { SELFHOST_API_PATH } from './config';

export interface SelfHostedSaveSummary {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    groupId?: string;
    share?: SelfHostedShare;
}

export interface SelfHostedGroup {
    id: string;
    name: string;
    createdAt: string;
}

export interface SelfHostedShare {
    enabled: boolean;
    token: string;
    publishedRevision?: number;
    updatedAt: string;
}

export interface SelfHostedProfile {
    language?: string;
}

export interface SelfHostedPaletteLine {
    id: string;
    name: Record<string, string>;
    colour: `#${string}`;
    fg?: '#000' | '#fff';
}

export interface SelfHostedPaletteCity {
    id: string;
    name: Record<string, string>;
    lines: SelfHostedPaletteLine[];
}

export class SelfHostedApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly details?: Record<string, unknown>
    ) {
        super(message);
    }
}

const request = async <T>(path: string, password: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const credentials = new TextEncoder().encode(`rmp:${password}`);
    let binaryCredentials = '';
    credentials.forEach(byte => (binaryCredentials += String.fromCharCode(byte)));
    headers.set('Authorization', `Basic ${btoa(binaryCredentials)}`);
    if (init.body) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${SELFHOST_API_PATH}${path}`, { ...init, headers });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new SelfHostedApiError(body.error ?? `Request failed (${response.status})`, response.status, body);
    }
    return (await response.json()) as T;
};

export const listSelfHostedSaves = async (password: string) =>
    request<{ saves: SelfHostedSaveSummary[] }>('', password);

export const createSelfHostedSave = async (password: string, name: string, content: string, groupId?: string) =>
    request<{ save: SelfHostedSaveSummary }>('', password, {
        method: 'POST',
        body: JSON.stringify({ name, content, groupId }),
    });

export const getSelfHostedSave = async (password: string, id: string) =>
    request<{ save: SelfHostedSaveSummary; content: string }>(`/${encodeURIComponent(id)}`, password);

export const updateSelfHostedSave = async (
    password: string,
    id: string,
    revision: number,
    content: string,
    name?: string,
    deviceId?: string
) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}`, password, {
        method: 'PUT',
        body: JSON.stringify({ revision, content, name, deviceId }),
    });

/** Explicit owner-requested recovery save; intentionally bypasses revision and lease checks. */
export const forceSelfHostedSave = async (
    password: string,
    id: string,
    content: string,
    deviceId: string,
    name?: string
) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}/force`, password, {
        method: 'POST',
        body: JSON.stringify({ content, deviceId, name }),
    });

export const deleteSelfHostedSave = async (password: string, id: string) =>
    request<{ ok: true }>(`/${encodeURIComponent(id)}`, password, { method: 'DELETE' });

export const duplicateSelfHostedSave = async (password: string, id: string) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}/duplicate`, password, { method: 'POST' });

export const updateSelfHostedSaveMetadata = async (password: string, id: string, groupId?: string) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}`, password, {
        method: 'PATCH',
        body: JSON.stringify({ groupId }),
    });

export const acquireSelfHostedSaveLease = async (password: string, id: string, deviceId: string) =>
    request<{ expiresAt: string }>(`/${encodeURIComponent(id)}/lease`, password, {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
    });

export const releaseSelfHostedSaveLease = async (password: string, id: string, deviceId: string) =>
    request<{ ok: true }>(`/${encodeURIComponent(id)}/lease`, password, {
        method: 'DELETE',
        body: JSON.stringify({ deviceId }),
    });

export const listSelfHostedGroups = async (password: string) =>
    request<{ groups: SelfHostedGroup[] }>('/groups', password);

export const createSelfHostedGroup = async (password: string, name: string) =>
    request<{ group: SelfHostedGroup }>('/groups', password, { method: 'POST', body: JSON.stringify({ name }) });

export const deleteSelfHostedGroup = async (password: string, id: string) =>
    request<{ ok: true }>(`/groups/${encodeURIComponent(id)}`, password, { method: 'DELETE' });

export const getSelfHostedProfile = async (password: string) =>
    request<{ profile: SelfHostedProfile }>('/profile', password);

export const updateSelfHostedProfile = async (password: string, profile: SelfHostedProfile) =>
    request<{ profile: SelfHostedProfile }>('/profile', password, { method: 'PUT', body: JSON.stringify(profile) });

export const enableSelfHostedShare = async (password: string, id: string) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}/share`, password, { method: 'POST' });

export const disableSelfHostedShare = async (password: string, id: string) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}/share`, password, { method: 'DELETE' });

export const publishSelfHostedSvg = async (password: string, id: string, revision: number, svg: string) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}/svg`, password, {
        method: 'PUT',
        body: JSON.stringify({ revision, svg }),
    });

export const listSelfHostedPaletteCities = async (password: string) =>
    request<{ cities: SelfHostedPaletteCity[] }>('/palette-cities', password);

export const replaceSelfHostedPaletteCities = async (password: string, cities: SelfHostedPaletteCity[]) =>
    request<{ cities: SelfHostedPaletteCity[] }>('/palette-cities', password, {
        method: 'PUT',
        body: JSON.stringify({ cities }),
    });
