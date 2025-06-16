import { getDateWindowUTC, formatTimeRange } from './time';
import { vi } from 'vitest';

beforeAll(() => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Chicago' });
});

afterAll(() => {
    vi.restoreAllMocks();
});

describe('getDateWindowUTC', () => {
    it('returns correct UTC window for a given date and cutoff', () => {
        // Jan 2, 2025, cutoff 4am local (America/Chicago is UTC-6 in Jan)
        const date = new Date(Date.UTC(2025, 0, 2));
        const { startIso, endIso } = getDateWindowUTC(date, 4);
        // For 2025-01-02T00:00:00Z, local is Jan 1, so window is Jan 1 4am CST (2025-01-01T10:00:00.000Z) to Jan 2 4am CST (2025-01-02T10:00:00.000Z)
        expect(startIso).toBe('2025-01-01T10:00:00.000Z');
        expect(endIso).toBe('2025-01-02T10:00:00.000Z');
    });

    it('assigns 1am entry to previous day when cutoff is 4am', () => {
        // 1:30am local time, America/Chicago, Jan 2, 2025
        const date = new Date('2025-01-02T01:30:00-06:00'); // 1:30am CST
        const { startIso, endIso } = getDateWindowUTC(date, 4);
        // The window should be Jan 1, 4am CST (2025-01-01T10:00:00.000Z) to Jan 2, 4am CST (2025-01-02T10:00:00.000Z)
        expect(startIso).toBe('2025-01-01T10:00:00.000Z');
        expect(endIso).toBe('2025-01-02T10:00:00.000Z');
        // 1:30am CST (2025-01-02T07:30:00.000Z) is within this window
        const entryTime = new Date('2025-01-02T07:30:00.000Z');
        expect(entryTime >= new Date(startIso)).toBe(true);
        expect(entryTime < new Date(endIso)).toBe(true);
    });
});

describe('formatTimeRange', () => {
    it('formats a time range with both start and end', () => {
        const start = '2025-01-02T10:00:00Z'; // 4:00 AM CST
        const end = '2025-01-02T12:30:00Z';   // 6:30 AM CST
        const result = formatTimeRange(start, end);
        expect(result).toMatch(/4:00.* - 6:30.*/);
    });
    it('formats a running time range', () => {
        const start = '2025-01-02T10:00:00Z'; // 4:00 AM CST
        const result = formatTimeRange(start);
        expect(result).toMatch(/4:00.* - running/);
    });
}); 