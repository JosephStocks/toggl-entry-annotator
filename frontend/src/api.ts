// --------------------------------------------------------
//  src/api.ts – Toggl API client & helper layer
// --------------------------------------------------------

import { getDateWindowUTC } from "./utils/time";

export type Entry = {
    entry_id: number;
    description: string;
    project_name: string | null;
    seconds: number;
    start: string;
    notes: Note[];
};

/**
 *  A note that belongs to a Toggl time-entry.
 *  `entry_id` is absent while we’re holding the optimistic note client-side,
 *  then filled in once the server saves and echoes it back.
 */
export type Note = {
    id: number;
    entry_id?: number;
    note_text: string;
    created_at: string;
};

export type CurrentEntry = {
    id: number;
    description: string;
    project_name: string | null;
    start: string;
    duration: number;
    project_id: number | null;
};

export type SyncResult = {
    ok: boolean;
    records_synced: number;
    message?: string | null;
};

export type DailyNote = {
    id: number;
    date: string;
    note_content: string;
    created_at: string;
    updated_at: string;
};

// --------------------------------------------------------
// Cloudflare Access Service Token Headers
// Only included in production when env vars are present
// --------------------------------------------------------

function buildCfHeaders(): Record<string, string> {
    const id = import.meta.env.VITE_CF_ACCESS_CLIENT_ID;
    const secret = import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET;

    return id && secret
        ? {
            'Cf-Access-Client-Id': id,
            'Cf-Access-Client-Secret': secret,
        }
        : {}; // local dev: skip headers
}

function makeOpts(init: RequestInit = {}): RequestInit {
    return {
        ...init,
        headers: {
            ...(init.headers || {}),
            ...buildCfHeaders(),
        },
    };
}

// --------------------------------------------------------
// Generic error helper – covers text vs JSON vs empty
// --------------------------------------------------------

async function handleResponse(resp: Response) {
    if (resp.ok) {
        if (resp.status === 204) return null;
        return await resp.json();
    } else {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${errText}`);
    }
}

// --------------------------------------------------------
// Core API helpers
// --------------------------------------------------------

export async function fetchEntriesForDate(date: Date): Promise<Entry[]> {
    const { startIso, endIso } = getDateWindowUTC(date, 4);
    const url = `/api/time_entries?start_iso=${encodeURIComponent(
        startIso,
    )}&end_iso=${encodeURIComponent(endIso)}`;

    const resp = await fetch(url);
    return handleResponse(resp);
}

export async function addNote(entryId: number, note: string): Promise<Note> {
    const resp = await fetch(
        '/api/notes',
        makeOpts({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry_id: entryId, note_text: note }),
        }),
    );
    return handleResponse(resp);
}

export async function fetchCurrentEntry(): Promise<CurrentEntry | null> {
    const resp = await fetch('/api/sync/current');
    return handleResponse(resp);
}

export async function runSync(kind: 'full' | 'recent'): Promise<SyncResult> {
    const resp = await fetch(`/api/sync/${kind}`, makeOpts({ method: 'POST' }));
    return handleResponse(resp);
}

// --------------------------------------------------------
// Daily Note APIs
// --------------------------------------------------------

export async function fetchDailyNote(date: string): Promise<DailyNote | null> {
    const resp = await fetch(`/api/daily_notes/${date}`);
    return handleResponse(resp);
}

export async function upsertDailyNote(
    date: string,
    content: string,
): Promise<DailyNote> {
    const resp = await fetch(
        `/api/daily_notes/${date}`,
        makeOpts({
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_content: content }),
        }),
    );
    return handleResponse(resp);
}
