// At the top of api.test.tsx, before any imports
import { beforeAll, afterAll } from 'vitest';

// Store original env values
let originalEnv: Record<string, string | undefined> = {};

beforeAll(() => {
    // Save and clear any existing CF env vars
    originalEnv = {
        VITE_CF_ACCESS_CLIENT_ID: import.meta.env.VITE_CF_ACCESS_CLIENT_ID,
        VITE_CF_ACCESS_CLIENT_SECRET: import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET,
    };

    // Clear them
    delete import.meta.env.VITE_CF_ACCESS_CLIENT_ID;
    delete import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET;
});

afterAll(() => {
    // Restore original values
    if (originalEnv.VITE_CF_ACCESS_CLIENT_ID !== undefined) {
        import.meta.env.VITE_CF_ACCESS_CLIENT_ID = originalEnv.VITE_CF_ACCESS_CLIENT_ID;
    }
    if (originalEnv.VITE_CF_ACCESS_CLIENT_SECRET !== undefined) {
        import.meta.env.VITE_CF_ACCESS_CLIENT_SECRET = originalEnv.VITE_CF_ACCESS_CLIENT_SECRET;
    }
});

// -------------------------------------------------------------
//  api.test.tsx  – unit-tests for the frontend API helper layer
// -------------------------------------------------------------
import {
    beforeEach,
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type {
    Entry,
    CurrentEntry,
    SyncResult,
    DailyNote,
} from './api';

// ------------------------------------------------------------------
// Global fetch mock – every test starts with a clean, happy response
// ------------------------------------------------------------------
global.fetch = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
        text: async () => '',
    });
});

// ------------------------------------------------------------------
// Helper: (re)load the api module after tweaking import.meta.env
// ------------------------------------------------------------------
const loadApi = () => import('./api');

describe('API Client', () => {
    describe('fetchEntriesForDate', () => {
        it('constructs correct URL with date parameters', async () => {
            const { fetchEntriesForDate } = await loadApi();

            const mockEntries: Entry[] = [
                {
                    entry_id: 1,
                    description: 'Test',
                    project_name: 'Project',
                    seconds: 3600,
                    start: '2025-01-15T10:00:00Z',
                    notes: [],
                },
            ];
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                json: async () => mockEntries,
            });

            const date = new Date('2025-01-15T12:00:00Z');
            await fetchEntriesForDate(date);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/time_entries?start_iso='),
            );
            // URL should contain properly encoded timestamps
            const url = (global.fetch as any).mock.calls[0][0] as string;
            expect(url).toMatch(/start_iso=.*Z/);
            expect(url).toMatch(/end_iso=.*Z/);
        });

        it('handles API errors correctly', async () => {
            const { fetchEntriesForDate } = await loadApi();

            (global.fetch as any).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'Database error',
            });

            await expect(fetchEntriesForDate(new Date())).rejects.toThrow(
                'HTTP 500 Internal Server Error: Database error',
            );
        });
    });

    describe('addNote', () => {
        it('sends correct POST request with note data', async () => {
            const { addNote } = await loadApi();

            const mockNote = {
                id: 1,
                note_text: 'Test note',
                created_at: '2025-01-15T10:00:00Z',
            };
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                json: async () => mockNote,
            });

            await addNote(123, 'Test note');

            expect(global.fetch).toHaveBeenCalledWith('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entry_id: 123, note_text: 'Test note' }),
            });
        });
    });

    describe('fetchCurrentEntry', () => {
        it('returns null for 204 No Content response', async () => {
            const { fetchCurrentEntry } = await loadApi();

            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                status: 204,
            });

            const result = await fetchCurrentEntry();
            expect(result).toBeNull();
        });

        it('returns current entry data', async () => {
            const { fetchCurrentEntry } = await loadApi();

            const mockEntry: CurrentEntry = {
                id: 123,
                description: 'Working',
                project_name: 'Project',
                start: '2025-01-15T10:00:00Z',
                duration: -1736935200,
                project_id: 456,
            };
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => mockEntry,
            });

            const result = await fetchCurrentEntry();
            expect(result).toEqual(mockEntry);
        });
    });

    // ------------------------------------------------------------------
    // 2. Cloudflare service-token header logic
    // ------------------------------------------------------------------
    describe('runSync (Cloudflare headers)', () => {
        afterEach(() => {
            // Restore import.meta.env to its original state
            vi.unstubAllEnvs();
            vi.resetModules();
        });

        it('includes CF headers when env vars are present', async () => {
            // Arrange → stub env before (re)importing the module
            vi.stubEnv('VITE_CF_ACCESS_CLIENT_ID', 'test-client-id');
            vi.stubEnv('VITE_CF_ACCESS_CLIENT_SECRET', 'test-client-secret');
            vi.resetModules();  // force api.ts to pick up the stubbed env
            const { runSync } = await loadApi();

            const mockResult: SyncResult = {
                ok: true,
                records_synced: 10,
                message: 'Sync complete',
            };
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult,
            });

            // Act
            await runSync('full');

            // Assert
            expect(global.fetch).toHaveBeenCalledWith('/api/sync/full', {
                method: 'POST',
                headers: {
                    'Cf-Access-Client-Id': 'test-client-id',
                    'Cf-Access-Client-Secret': 'test-client-secret',
                },
            });
        });

        it('omits CF headers when env vars are missing', async () => {
            // Ensure no env vars and reload module
            vi.unstubAllEnvs();
            vi.resetModules();
            const { runSync } = await loadApi();

            const mockResult: SyncResult = {
                ok: true,
                records_synced: 5,
                message: 'Recent sync complete',
            };
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult,
            });

            await runSync('recent');

            expect(global.fetch).toHaveBeenCalledWith('/api/sync/recent', {
                method: 'POST',
                headers: {},               // <-- SHOULD be empty when no env vars
            });
        });
    });

    // ------------------------------------------------------------------
    // 3.  Daily-note helpers
    // ------------------------------------------------------------------
    describe('Daily Note APIs', () => {
        describe('fetchDailyNote', () => {
            it('fetches daily note for a specific date', async () => {
                const { fetchDailyNote } = await loadApi();

                const mockNote: DailyNote = {
                    id: 1,
                    date: '2025-01-15',
                    note_content: '# Daily Notes\n\nTest content',
                    created_at: '2025-01-15T10:00:00Z',
                    updated_at: '2025-01-15T10:00:00Z',
                };
                (global.fetch as any).mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockNote,
                });

                const result = await fetchDailyNote('2025-01-15');

                // Check that fetch was called with just the URL (no second argument)
                expect(global.fetch).toHaveBeenCalledTimes(1);
                expect(global.fetch).toHaveBeenCalledWith('/api/daily_notes/2025-01-15');
                expect(result).toEqual(mockNote);
            });

            it('returns null when note does not exist', async () => {
                const { fetchDailyNote } = await loadApi();

                (global.fetch as any).mockResolvedValueOnce({
                    ok: true,
                    json: async () => null,
                });

                const result = await fetchDailyNote('2025-01-15');
                expect(result).toBeNull();
            });
        });

        describe('upsertDailyNote', () => {
            it('creates or updates daily note', async () => {
                const { upsertDailyNote } = await loadApi();

                const mockNote: DailyNote = {
                    id: 1,
                    date: '2025-01-15',
                    note_content: 'Updated content',
                    created_at: '2025-01-15T10:00:00Z',
                    updated_at: '2025-01-15T11:00:00Z',
                };
                (global.fetch as any).mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockNote,
                });

                const result = await upsertDailyNote('2025-01-15', 'Updated content');

                expect(global.fetch).toHaveBeenCalledWith('/api/daily_notes/2025-01-15', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note_content: 'Updated content' }),
                });
                expect(result).toEqual(mockNote);
            });
        });
    });

    // ------------------------------------------------------------------
    // 4.  Generic error-handling guard rails
    // ------------------------------------------------------------------
    describe('Error Handling', () => {
        it('propagates network errors', async () => {
            const { fetchEntriesForDate } = await loadApi();

            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            await expect(fetchEntriesForDate(new Date())).rejects.toThrow('Network error');
        });

        it('parses non-JSON error responses', async () => {
            const { fetchEntriesForDate } = await loadApi();

            (global.fetch as any).mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => 'Invalid date format',
            });

            await expect(fetchEntriesForDate(new Date())).rejects.toThrow(
                'HTTP 400 Bad Request: Invalid date format',
            );
        });

        it('handles empty error responses', async () => {
            const { fetchEntriesForDate } = await loadApi();

            (global.fetch as any).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => '',
            });

            await expect(fetchEntriesForDate(new Date())).rejects.toThrow(
                'HTTP 500 Internal Server Error: ',
            );
        });
    });
});
