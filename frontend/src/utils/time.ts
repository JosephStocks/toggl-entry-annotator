// src/utils/time.ts
import { fromZonedTime } from 'date-fns-tz';
import { addDays } from 'date-fns';

/**
 * Get UTC window for today with configurable cutoff hour
 * @param cutoff Hour of day when the "day" starts (default 4 AM)
 */
export function todayWindowUTC(cutoff = 4) {
    return getDateWindowUTC(new Date(), cutoff);
}

/**
 * Get UTC window for any specific date with configurable cutoff hour
 * @param date The date to get the window for
 * @param cutoff Hour of day when the "day" starts (default 4 AM)
 */
export function getDateWindowUTC(date: Date, cutoff = 4) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Create local start time (e.g., 4 AM on the given date)
    const localStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        cutoff
    );

    // End time is cutoff hour of the next day
    const localEnd = addDays(localStart, 1);

    return {
        startIso: fromZonedTime(localStart, tz).toISOString(),
        endIso: fromZonedTime(localEnd, tz).toISOString(),
    };
}

/**
 * Helper to format time ranges for display
 */
export function formatTimeRange(startIso: string, endIso?: string): string {
    const start = new Date(startIso);
    const startTime = start.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
    });

    if (!endIso) {
        return `${startTime} - running`;
    }

    const end = new Date(endIso);
    const endTime = end.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
    });

    return `${startTime} - ${endTime}`;
}