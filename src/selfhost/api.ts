import { Theme } from '../constants/constants';
import { SELFHOST_API_PATH } from './config';

export interface SelfHostedSaveSummary {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface SelfHostedThemePreset {
    id: string;
    name: string;
    theme: Theme;
}

export class SelfHostedApiError extends Error {
    constructor(
        message: string,
        readonly status: number
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
        throw new SelfHostedApiError(body.error ?? `Request failed (${response.status})`, response.status);
    }
    return (await response.json()) as T;
};

export const listSelfHostedSaves = async (password: string) =>
    request<{ saves: SelfHostedSaveSummary[] }>('', password);

export const createSelfHostedSave = async (password: string, name: string, content: string) =>
    request<{ save: SelfHostedSaveSummary }>('', password, {
        method: 'POST',
        body: JSON.stringify({ name, content }),
    });

export const getSelfHostedSave = async (password: string, id: string) =>
    request<{ save: SelfHostedSaveSummary; content: string }>(`/${encodeURIComponent(id)}`, password);

export const updateSelfHostedSave = async (
    password: string,
    id: string,
    revision: number,
    content: string,
    name?: string
) =>
    request<{ save: SelfHostedSaveSummary }>(`/${encodeURIComponent(id)}`, password, {
        method: 'PUT',
        body: JSON.stringify({ revision, content, name }),
    });

export const deleteSelfHostedSave = async (password: string, id: string) =>
    request<{ ok: true }>(`/${encodeURIComponent(id)}`, password, { method: 'DELETE' });

export const listSelfHostedThemePresets = async (password: string) =>
    request<{ presets: SelfHostedThemePreset[] }>('/themes', password);

export const replaceSelfHostedThemePresets = async (password: string, presets: SelfHostedThemePreset[]) =>
    request<{ presets: SelfHostedThemePreset[] }>('/themes', password, {
        method: 'PUT',
        body: JSON.stringify({ presets }),
    });
