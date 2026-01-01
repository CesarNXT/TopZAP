
import { addDays, addMinutes, differenceInMilliseconds } from 'date-fns';

// --- TIMEZONE HELPERS (BRASÍLIA HARDCODED) ---

/**
 * Returns the current date/time components in America/Sao_Paulo timezone.
 * This is robust regardless of server timezone (UTC, etc).
 */
export function getBrasiliaComponents(date: Date) {
    // Format: "MM/DD/YYYY, HH:mm:ss"
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });
    
    const parts = fmt.formatToParts(date);
    const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0');
    
    return {
        year: getPart('year'),
        month: getPart('month'), // 1-12
        day: getPart('day'),
        hour: getPart('hour'),
        minute: getPart('minute'),
        second: getPart('second')
    };
}

/**
 * Creates a UTC Date object corresponding to a specific time in Brasília.
 * Example: Input (2024, 1, 1, 8, 0) -> Returns Timestamp for 2024-01-01 08:00 BRT
 */
export function createDateFromBrasilia(year: number, month: number, day: number, hour: number, minute: number): Date {
    // We create a string in ISO format roughly, then force interpret as BRT? No, simpler:
    // We construct a date string that Date.parse can handle with offset, OR we iterate.
    // Easiest robust way without heavy libs:
    // Create a UTC date with these components, then adjust by offset.
    // BUT offset changes (DST).
    // Better: Use the string constructor with explicit offset? No, BRT offset varies (-03 or -02).
    // Best native way:
    // 1. Guess UTC equivalent (Time + 3h)
    // 2. Check what time that is in Brasilia.
    // 3. Adjust diff.
    
    // Initial guess: Input is BRT. UTC is roughly Input + 3h.
    const guess = new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
    
    // Refine loop (usually 1-2 iterations)
    for (let i = 0; i < 3; i++) {
        const brt = getBrasiliaComponents(guess);
        const diffHours = (brt.hour - hour);
        const diffMinutes = (brt.minute - minute);
        
        // If match, return
        if (diffHours === 0 && diffMinutes === 0) return guess;
        
        // Adjust guess
        // If we are at 08:00 BRT but guess gave 09:00 BRT, we need to subtract 1h from guess.
        // Watch out for day wrap (diffHours could be -23).
        let totalDiffMin = (diffHours * 60) + diffMinutes;
        
        // Simple heuristic for day wrap
        if (totalDiffMin > 720) totalDiffMin -= 1440;
        if (totalDiffMin < -720) totalDiffMin += 1440;
        
        guess.setTime(guess.getTime() - (totalDiffMin * 60000));
    }
    return guess;
}

/**
 * Adds minutes to a date, respecting Brasilia time continuity.
 */
function addMinutesBrasilia(date: Date, minutes: number): Date {
    return new Date(date.getTime() + (minutes * 60000));
}

// ---------------------------------------------

export interface WorkingHours {
    start: string; // "08:00"
    end: string;   // "19:00"
}

export interface ScheduleRule {
    date: string; // "YYYY-MM-DD"
    start?: string;
    end?: string;
    active: boolean; // If false, skip this day
}

export interface BatchPreview {
    id: string; // Unique ID for UI keys
    date: Date;
    startTime: Date;
    endTime: Date;
    count: number;
    isCustom: boolean; // If this specific day has a manual rule
}

export interface SpeedConfig {
    minDelay: number;
    maxDelay: number;
}

/**
 * Calculates the campaign schedule based on contacts, speed, and rules.
 * FORCE BRASILIA TIMEZONE (UTC-3) logic.
 */
export function calculateCampaignSchedule(
    totalContacts: number,
    speedConfig: SpeedConfig,
    startDate: Date,
    defaultWorkingHours: WorkingHours | undefined,
    rules: ScheduleRule[]
): BatchPreview[] {
    const batches: BatchPreview[] = [];
    const avgDelaySeconds = (speedConfig.minDelay + speedConfig.maxDelay) / 2;
    
    let contactsRemaining = totalContacts;
    
    // Ensure start date is valid
    let currentPointer = new Date(startDate);
    const now = new Date();
    if (currentPointer < now) currentPointer = now;

    // Safety break
    let loops = 0;
    const MAX_LOOPS = 365;

    while (contactsRemaining > 0 && loops < MAX_LOOPS) {
        loops++;
        
        // Get Brasilia components for the current pointer
        const brt = getBrasiliaComponents(currentPointer);
        
        // Format YYYY-MM-DD for rule lookup
        const dateStr = `${brt.year}-${String(brt.month).padStart(2, '0')}-${String(brt.day).padStart(2, '0')}`;
        
        const rule = rules.find(r => r.date === dateStr);
        
        // Determine window for this day
        let startStr = defaultWorkingHours?.start || "00:00";
        let endStr = defaultWorkingHours?.end || "23:59";
        let isActive = true;

        if (rule) {
            isActive = rule.active;
            if (rule.start) startStr = rule.start;
            if (rule.end) endStr = rule.end;
        }

        if (!isActive) {
            // Skip this day completely. Move to next day 00:00 BRT.
            // Create date for Tomorrow 00:00 BRT
            // We use Date.UTC logic + 3h roughly, or our helper
            // Simpler: Just add 24h and reset? No, DST issues.
            // Use helper:
            // Next day:
            const nextDay = new Date(currentPointer);
            nextDay.setDate(nextDay.getDate() + 1); // This shifts day in UTC, safe enough for "next day" intent usually
            const nextBrt = getBrasiliaComponents(nextDay);
            currentPointer = createDateFromBrasilia(nextBrt.year, nextBrt.month, nextBrt.day, 0, 0);
            continue;
        }

        // Parse window boundaries for this specific date in BRT
        const [startH, startM] = startStr.split(':').map(Number);
        const [endH, endM] = endStr.split(':').map(Number);
        
        const windowStart = createDateFromBrasilia(brt.year, brt.month, brt.day, startH, startM);
        const windowEnd = createDateFromBrasilia(brt.year, brt.month, brt.day, endH, endM);

        // Adjust currentPointer if it's before the window start
        if (currentPointer < windowStart) {
            currentPointer = windowStart;
        }

        // If currentPointer is already past window end, move to next day
        if (currentPointer > windowEnd) {
            const nextDay = new Date(currentPointer);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextBrt = getBrasiliaComponents(nextDay);
            currentPointer = createDateFromBrasilia(nextBrt.year, nextBrt.month, nextBrt.day, 0, 0);
            continue;
        }

        // Calculate available time in this window
        const availableSeconds = (windowEnd.getTime() - currentPointer.getTime()) / 1000;
        
        if (availableSeconds <= 0) {
            const nextDay = new Date(currentPointer);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextBrt = getBrasiliaComponents(nextDay);
            currentPointer = createDateFromBrasilia(nextBrt.year, nextBrt.month, nextBrt.day, 0, 0);
            continue;
        }

        // Calculate how many contacts fit
        const capacity = Math.floor(availableSeconds / avgDelaySeconds);
        const countForBatch = Math.min(capacity, contactsRemaining);
        
        if (countForBatch <= 0) {
            const nextDay = new Date(currentPointer);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextBrt = getBrasiliaComponents(nextDay);
            currentPointer = createDateFromBrasilia(nextBrt.year, nextBrt.month, nextBrt.day, 0, 0);
            continue;
        }

        // Calculate actual end time for this batch
        const batchDurationSeconds = countForBatch * avgDelaySeconds;
        const batchEndTime = new Date(currentPointer.getTime() + (batchDurationSeconds * 1000));

        batches.push({
            id: dateStr,
            date: currentPointer, 
            startTime: currentPointer,
            endTime: batchEndTime,
            count: countForBatch,
            isCustom: !!rule
        });

        contactsRemaining -= countForBatch;
        
        // Prepare for next loop (start where we left off)
        currentPointer = batchEndTime;
        
        // Small buffer to prevent stuck at boundary?
        // If we filled the window exactly, next loop will detect "past window end" and move day.
    }

    return batches;
}

/**
 * Helper to find the next valid execution time given the rules.
 * Used by the backend worker to schedule individual messages.
 * NOW FORCE BRASILIA TIME.
 */
export function getNextValidTime(
    proposedTime: Date,
    defaultWorkingHours: WorkingHours | undefined,
    rules: ScheduleRule[]
): Date {
    let pointer = new Date(proposedTime);
    let loops = 0;
    const MAX_LOOPS = 365;

    // Ensure we don't return a time in the past relative to "now"
    // But this function is often called with "future" pointer.
    
    while (loops < MAX_LOOPS) {
        loops++;
        
        const brt = getBrasiliaComponents(pointer);
        const dateStr = `${brt.year}-${String(brt.month).padStart(2, '0')}-${String(brt.day).padStart(2, '0')}`;
        
        const rule = rules.find(r => r.date === dateStr);

        let startStr = defaultWorkingHours?.start || "00:00";
        let endStr = defaultWorkingHours?.end || "23:59";
        let isActive = true;

        if (rule) {
            isActive = rule.active;
            if (rule.start) startStr = rule.start;
            if (rule.end) endStr = rule.end;
        }

        if (!isActive) {
            // Day is skipped, move to next day 00:00 BRT
            const nextDay = new Date(pointer);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextBrt = getBrasiliaComponents(nextDay);
            pointer = createDateFromBrasilia(nextBrt.year, nextBrt.month, nextBrt.day, 0, 0);
            continue;
        }

        const [startH, startM] = startStr.split(':').map(Number);
        const [endH, endM] = endStr.split(':').map(Number);
        
        const windowStart = createDateFromBrasilia(brt.year, brt.month, brt.day, startH, startM);
        const windowEnd = createDateFromBrasilia(brt.year, brt.month, brt.day, endH, endM);

        // Case 1: Before window
        if (pointer < windowStart) {
            return windowStart;
        }

        // Case 2: Inside window
        if (pointer <= windowEnd) {
            return pointer;
        }

        // Case 3: After window -> Move to next day
        const nextDay = new Date(pointer);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextBrt = getBrasiliaComponents(nextDay);
        pointer = createDateFromBrasilia(nextBrt.year, nextBrt.month, nextBrt.day, 0, 0);
    }
    
    return pointer;
}
