// src/utils/time.ts
import { fromZonedTime } from 'date-fns-tz';          // timezone conversion :contentReference[oaicite:4]{index=4}
import { addDays } from 'date-fns';

export function todayWindowUTC(cutoff = 4) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const localStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cutoff);
    const localEnd = addDays(localStart, 1);
    return {
        startIso: fromZonedTime(localStart, tz).toISOString(),
        endIso: fromZonedTime(localEnd, tz).toISOString(),
    };
}
