import { getDateWindowUTC } from './utils/time.ts';

// --- Types mirroring your API ------------------------------------
export type Note = { id: number; note_text: string; created_at: string };
export type Entry = {
    entry_id: number;
    description: string;
    project_name: string;
    seconds: number;
    start: string;
    notes: Note[];
};
export type CurrentEntry = {
    id: number;
    description: string;
    project_name: string;
    start: string;
    duration: number; // is negative
    project_id: number;
};

export type SyncResult = {
    ok: boolean;
    records_synced: number;
    message: string;
};

// Add to types
export type DailyNote = {
    id: number;
    date: string;
    note_content: string;
    created_at: string;
    updated_at: string;
};

// Add API functions
export const fetchDailyNote = (date: string) =>
    fetchApi<DailyNote | null>(`/daily_notes/${date}`);

export const upsertDailyNote = (date: string, content: string) =>
    fetchApi<DailyNote>(`/daily_notes/${date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_content: content }),
    });

// --- API Helpers ----------------------------------------
const API_BASE = '/api';

// Cloudflare service-token headers (only available in prod build)
const cfHeaders = {
    'Cf-Access-Client-Id': import.meta.env.VITE_CF_ACCESS_CLIENT_ID as string | undefined,
    'Cf-Access-Client-Secret': import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET as string | undefined,
} as Record<string, string>;

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, options);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `HTTP ${response.status} ${response.statusText}: ${errorBody}`
        );
    }
    // Handle cases where response might be empty (e.g., 204 No Content for current entry)
    if (response.status === 204) {
        return null as T;
    }
    return response.json();
}

// --- Component-specific fetchers -------------------------
export const fetchEntriesForDate = (date: Date) => {
    const { startIso, endIso } = getDateWindowUTC(date, 4);
    return fetchApi<Entry[]>(
        `/time_entries?start_iso=${encodeURIComponent(
            startIso
        )}&end_iso=${encodeURIComponent(endIso)}`
    );
};

export const addNote = (entryId: number, text: string) =>
    fetchApi<Note>('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId, note_text: text }),
    });

export const fetchCurrentEntry = () => fetchApi<CurrentEntry | null>('/sync/current');

export const runSync = (type: 'full' | 'recent') =>
    fetchApi<SyncResult>(`/sync/${type}`, {
        method: 'POST',
        headers: cfHeaders,
    }); 